import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mappings = require('../extension/services/keyword-mappings.js');
const shortcutTabs = require('../extension/services/shortcut-tabs.js');
const library = require('../extension/views/shortcut-library-view.js');

/** 回归旧数据、多别名及备份的严格校验、合并、幂等与失败隔离。 */
async function testBackupAndAliases() {
  let values = { keywordPageMappings: [{ id: 'old', keyword: '看板', title: 'ARGALL', url: 'https://example.test/a?x=1#view' }] };
  let failWrite = false;
  let sequence = 0;
  const storage = {
    /** 返回无共享引用的本地存储快照。 */
    async get() { return structuredClone(values); },
    /** 模拟原子写入及配额失败。 */
    async set(next) { if (failWrite) throw new Error('quota'); values = structuredClone(next); },
  };
  const service = mappings.createService(storage, () => `new-${++sequence}`);
  assert.deepEqual((await service.list())[0].aliases, []);
  const old = (await service.list())[0];
  await service.save({ ...old, aliases: ['ag', '  主链路  ', 'AG'] });
  assert.deepEqual((await service.list())[0].aliases, ['ag', '主链路']);
  assert.equal(mappings.findMappings(await service.list(), 'AG').length, 1);
  assert.equal(mappings.findMappings(await service.list(), '链路').length, 1);
  await assert.rejects(service.save({ ...old, aliases: 'ag' }), /keywordInvalidAliases/);
  const backup = await service.exportBackup();
  assert.equal(JSON.parse(backup).format, 'xiaoyu-tab-manager-shortcuts');
  assert.equal(JSON.parse(backup).version, 1);
  assert.equal('id' in JSON.parse(backup).mappings[0], false);
  assert.deepEqual(mappings.parseBackup(backup)[0].aliases, ['ag', '主链路']);
  const incoming = JSON.stringify({ format: 'xiaoyu-tab-manager-shortcuts', version: 1, mappings: [
    { keyword: '看板', title: '不能覆盖本机名', url: old.url, aliases: ['AG', '链路入口'] },
    { keyword: 'tce', title: 'ARGALL 服务', url: 'https://service.test/?module=instance', aliases: ['服务'] },
    { keyword: 'TCE', title: '重复项', url: 'https://service.test/?module=instance', aliases: ['实例'] },
  ] });
  const beforePreview = structuredClone(values);
  assert.deepEqual(await service.previewImport(incoming), { added: 1, existing: 1, aliasesAdded: 1, total: 2 });
  assert.deepEqual(values, beforePreview);
  assert.deepEqual(await service.importBackup(incoming), { added: 1, existing: 1, aliasesAdded: 1, total: 2 });
  const rows = await service.list();
  assert.equal(rows[0].id, 'old');
  assert.equal(rows[0].title, 'ARGALL');
  assert.deepEqual(rows[0].aliases, ['ag', '主链路', '链路入口']);
  assert.deepEqual(rows[1].aliases, ['服务', '实例']);
  assert.deepEqual(await service.importBackup(incoming), { added: 0, existing: 2, aliasesAdded: 0, total: 2 });
  const snapshot = structuredClone(values);
  for (const invalid of ['{}', '{', JSON.stringify({ format: 'xiaoyu-tab-manager-shortcuts', version: 999, mappings: [] }),
    JSON.stringify({ format: 'xiaoyu-tab-manager-shortcuts', version: 1, mappings: [{ keyword: 'x', title: 'x', url: 'javascript:alert(1)' }] }),
    JSON.stringify({ format: 'xiaoyu-tab-manager-shortcuts', version: 1, mappings: [{ keyword: 'x', title: 'x', url: 'https://a.test', aliases: [7] }] }),
    ' '.repeat(mappings.MAX_BACKUP_BYTES + 1)]) {
    await assert.rejects(service.importBackup(invalid), /keywordBackup/);
    assert.deepEqual(values, snapshot);
  }
  const tooMany = JSON.stringify({ format: 'xiaoyu-tab-manager-shortcuts', version: 1,
    mappings: Array.from({ length: 5001 }, () => ({ keyword: 'x', title: 'x', url: 'https://a.test' })) });
  await assert.rejects(service.importBackup(tooMany), /keywordBackupTooLarge/);
  assert.deepEqual(values, snapshot);
  values.keywordPageMappings[0].aliases = null;
  await assert.rejects(service.list(), /keywordDataError/);
  await assert.rejects(service.importBackup(incoming), /keywordDataError/);
  values = structuredClone(snapshot);
  failWrite = true;
  await assert.rejects(service.importBackup(incoming), /quota/);
  assert.deepEqual(values, snapshot);
}

/** 构造只读快照、激活与新建可审计的浏览器接口，不提供删除 API。 */
function fakeBrowser() {
  const windows = [
    { id: 1, type: 'normal', tabs: [{ id: 11, windowId: 1, url: 'https://example.test/?a=1#x', lastAccessed: 1 }] },
    { id: 2, type: 'normal', tabs: [{ id: 22, windowId: 2, url: 'https://example.test/?a=1#x', lastAccessed: 9 }] },
    { id: 3, type: 'normal', incognito: true, tabs: [{ id: 33, windowId: 3, url: 'https://private.test/' }] },
  ];
  const actions = [];
  let getChanged = false;
  let focusFails = false;
  const api = {
    windows: {
      /** 查询同一 profile 的普通窗口。 */
      async getAll() { return structuredClone(windows); },
      /** 当前仪表盘属于窗口一。 */
      async getCurrent() { return { id: 1 }; },
      /** 记录窗口聚焦。 */
      async update(id, patch) { actions.push(['window', id, patch]); },
    },
    tabs: {
      /** 在点击时再次核验目标是否仍是同一完整网址。 */
      async get(id) {
        const tab = windows.flatMap(window => window.tabs).find(item => item.id === id);
        return { ...tab, ...(getChanged ? { url: 'https://changed.test/' } : {}) };
      },
      /** 记录精确标签激活并支持失败注入。 */
      async update(id, patch) { if (focusFails) throw new Error('focus denied'); actions.push(['tab', id, patch]); return { id }; },
      /** 记录新建，不允许任何隐含删除。 */
      async create(patch) { actions.push(['create', patch]); return { id: 99, ...patch }; },
    },
  };
  return { api, windows, actions,
    /** 模拟目标标签恰好发生变址。 */
    changeTarget() { getChanged = true; },
    /** 模拟浏览器拒绝激活标签。 */
    failFocus() { focusFails = true; },
  };
}

/** 回归完整 URL、跨窗口优先级、状态变化与显式副本，保证不按域名兜底。 */
async function testExactOpen() {
  const browser = fakeBrowser();
  const service = shortcutTabs.createService(browser.api);
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.windows.length, 2);
  assert.equal(shortcutTabs.selectExactTab(snapshot, 'https://example.test/?a=1#x').id, 11);
  assert.equal(shortcutTabs.selectExactTab(snapshot, 'https://example.test/?a=2#x'), null);
  assert.equal(shortcutTabs.selectExactTab(snapshot, 'https://example.test/?a=1#y'), null);
  assert.equal(shortcutTabs.selectExactTab(snapshot, 'https://private.test/'), null);
  assert.equal((await service.open('https://example.test/?a=1#x')).reused, true);
  assert.deepEqual(browser.actions, [['tab', 11, { active: true }], ['window', 1, { focused: true }]]);
  browser.actions.length = 0;
  assert.equal((await service.open('https://example.test/?a=1#x', { newCopy: true })).reused, false);
  assert.deepEqual(browser.actions, [['create', { url: 'https://example.test/?a=1#x', active: true }]]);
  browser.actions.length = 0;
  await service.open('https://example.test/?a=2#x');
  assert.equal(browser.actions[0][0], 'create');
  browser.actions.length = 0;
  browser.windows[0].tabs[0].pendingUrl = 'https://moving.test/';
  assert.equal((await service.open('https://example.test/?a=1#x')).reused, true);
  assert.equal(browser.actions[0][1], 22);
  browser.changeTarget();
  browser.actions.length = 0;
  await assert.rejects(service.open('https://example.test/?a=1#x'), /shortcutTargetChanged/);
  assert.deepEqual(browser.actions, []);
  const failed = fakeBrowser();
  failed.failFocus();
  await assert.rejects(shortcutTabs.createService(failed.api).open('https://example.test/?a=1#x'), /focus denied/);
  assert.equal(failed.actions.some(action => action[0] === 'create'), false);
  await assert.rejects(service.open('javascript:alert(1)'), /keywordInvalidUrl/);
  const unavailable = fakeBrowser();
  unavailable.api.windows.getAll = async () => { throw new Error('query failed'); };
  await assert.rejects(shortcutTabs.createService(unavailable.api).open('https://a.test/'), /query failed/);
  assert.deepEqual(unavailable.actions, []);
  const disappeared = fakeBrowser();
  disappeared.api.tabs.get = async () => { throw new Error('No tab'); };
  await assert.rejects(shortcutTabs.createService(disappeared.api).open('https://example.test/?a=1#x'), /No tab/);
  assert.deepEqual(disappeared.actions, []);
  assert.equal(shortcutTabs.selectExactTab({ ...snapshot, tabs: [{ ...snapshot.tabs[0], pinned: true, discarded: true }] }, 'https://example.test/?a=1#x').id, 11);
}

/** 验证卡片不会把映射名称解释为 HTML，且空态、错误态及状态未知均可见。 */
function testLibraryRendering() {
  const translate = key => key;
  const html = library.render({ rows: [{ id: '"<x>', keyword: '<script>group', title: '<img src=x>', url: 'https://a.test/?x="' }], translate });
  assert.match(html, /&lt;script&gt;group/);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /data-mapping-id="&quot;&lt;x&gt;"/);
  assert.match(html, /shortcutStatusUnknown/);
  assert.match(html, /class="keyword-group-swatch"/);
  assert.match(html, /data-action="color-shortcut-group" data-keyword="&lt;script&gt;group"/);
  assert.match(html, /data-action="edit-shortcut-group" data-keyword="&lt;script&gt;group"/);
  assert.match(library.render({ rows: [{ id: 'color', keyword: 'tce', title: 'project', url: 'https://a.test/' }],
    groupColors: { tce: '#123456' }, translate }), /background-color: #123456/);
  assert.match(library.render({ translate }), /keywordEmpty/);
  assert.match(library.render({ loadError: true, translate }), /keywordLoadError/);
}

/** 执行快捷库的持久数据和浏览器操作单元回归。 */
export async function testShortcutLibrary() {
  await testBackupAndAliases();
  await testExactOpen();
  testLibraryRendering();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await testShortcutLibrary();
  console.log('Shortcut library tests passed.');
}

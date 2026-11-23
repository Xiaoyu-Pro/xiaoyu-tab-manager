import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createController, ENABLED_KEY, SESSION_KEY } = require('../extension/services/dashboard-cleanup.js');
const DASHBOARD = 'chrome-extension://xiaoyu/index.html';

/** 构造独立普通窗口及受保护页，所有关闭均可检查，不访问真实浏览器。 */
function fixture(enabled = true) {
  const local = { [ENABLED_KEY]: enabled };
  const session = {};
  const calls = [];
  const state = { failWrite: false, failRemove: false, beforeGet: null };
  const windows = new Map([[1, { type: 'normal' }], [2, { type: 'normal' }],
    [3, { type: 'normal', incognito: true }], [4, { type: 'popup' }]]);
  const tabs = new Map([
    [1, { id: 1, windowId: 1, url: DASHBOARD }],
    [2, { id: 2, windowId: 2, url: DASHBOARD }],
    [3, { id: 3, windowId: 1, url: 'https://example.test/work' }],
    [4, { id: 4, windowId: 1, url: 'chrome-extension://xiaoyu/tools.html' }],
    [5, { id: 5, windowId: 1, url: 'chrome-extension://blue/index.html' }],
    [6, { id: 6, windowId: 1, url: DASHBOARD, pinned: true }],
    [7, { id: 7, windowId: 3, url: DASHBOARD, incognito: true }],
    [8, { id: 8, windowId: 4, url: DASHBOARD }],
    [9, { id: 9, windowId: 1, url: DASHBOARD, pendingUrl: 'https://example.test/new' }],
  ]);
  const api = {
    runtime: { id: 'xiaoyu', getURL: path => `chrome-extension://xiaoyu/${path}` },
    storage: {
      local: { get: async key => ({ [key]: local[key] }) },
      session: {
        get: async key => ({ [key]: structuredClone(session[key]) }),
        set: async values => { if (state.failWrite) throw new Error('session unavailable'); Object.assign(session, structuredClone(values)); },
      },
    },
    tabs: {
      query: async () => [...tabs.values()].filter(tab => windows.get(tab.windowId)?.type === 'normal').map(tab => ({ ...tab })),
      get: async id => { state.beforeGet?.(id); if (!tabs.has(id)) throw new Error('Missing tab'); return { ...tabs.get(id) }; },
      remove: async id => { if (state.failRemove) throw new Error('remove denied'); assert.ok(tabs.has(id)); calls.push(id); tabs.delete(id); },
    },
    windows: { get: async id => ({ ...windows.get(id) }) },
  };
  const logs = [];
  const logger = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
  return { api, tabs, windows, local, session, calls, state, logs, run: createController(api, { log: logger }) };
}

/** 为真实仪表盘构造不可由普通网页伪造的扩展消息来源。 */
function sender(id, url = DASHBOARD) { return { id: 'xiaoyu', url, tab: { id } }; }

/** 验证关闭模式兼容、纯开关不关页和跨窗口安全目标范围。 */
async function testModesAndScope() {
  for (const value of [undefined, false, 'true']) {
    const f = fixture(value);
    delete f.local[ENABLED_KEY];
    if (value !== undefined) f.local[ENABLED_KEY] = value;
    assert.equal((await f.run.onReady(sender(2))).enabled, false);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  await f.run.onCreated({ ...f.tabs.get(1) });
  await f.run.onCreated({ ...f.tabs.get(2) });
  assert.deepEqual(f.calls, []);
  const result = await f.run.onReady(sender(2));
  assert.equal(result.ok, true);
  assert.equal(result.closed, 1);
  assert.deepEqual(f.calls, [1]);
  assert.equal(f.tabs.has(2), true);
  assert.equal(f.tabs.size, 8);
  assert.doesNotMatch(JSON.stringify(f.session), /https?:|chrome-extension:|example\.test/);
  assert.doesNotMatch(JSON.stringify(f.logs), /https?:|chrome-extension:|example\.test/);
  for (const untrusted of [sender(2, 'https://example.test/'), sender(2, 'chrome-extension://blue/index.html'),
    { ...sender(2), id: 'other' }, { ...sender(2), tab: undefined }]) {
    assert.equal((await fixture().run.onReady(untrusted)).ok, false);
  }
}

/** 较新页尚未就绪时不删除它；旧页晚到及 worker 重启不改变创建优先级。 */
async function testOrdering() {
  const f = fixture();
  await f.run.onCreated(f.tabs.get(1));
  await f.run.onCreated(f.tabs.get(2));
  await f.run.onReady(sender(1));
  assert.deepEqual(f.calls, []);
  f.state.failRemove = true;
  assert.equal((await f.run.onReady(sender(2))).ok, false);
  f.state.failRemove = false;
  const resumed = createController(f.api, { log: { info() {}, warn() {} } });
  await resumed.onReady(sender(1));
  assert.deepEqual(f.calls, [1]);
  assert.equal(f.tabs.has(2), true);
}

/** 校验通用新标签必须有来源证明，导航后旧证明失效。 */
async function testPlaceholderProof() {
  const f = fixture(false);
  f.tabs.get(1).url = 'chrome://newtab/';
  f.tabs.get(3).url = 'chrome://newtab/';
  await f.run.onReady(sender(1));
  f.local[ENABLED_KEY] = true;
  await f.run.onCreated(f.tabs.get(2));
  await f.run.onReady(sender(2));
  assert.deepEqual(f.calls, [1]);
  assert.equal(f.tabs.has(3), true);
  const g = fixture(false);
  g.tabs.get(1).url = 'chrome://newtab/';
  await g.run.onReady(sender(1));
  await g.run.onUpdated(1, { status: 'loading' });
  g.local[ENABLED_KEY] = true;
  await g.run.onCreated(g.tabs.get(2));
  await g.run.onReady(sender(2));
  assert.deepEqual(g.calls, []);
}

/** 存储、目标、开关和保留页变更时不冒险继续关闭。 */
async function testFailureAndRechecks() {
  for (const scenario of ['write', 'invalid-state', 'keeper-gone', 'keeper-gone-late', 'target-navigated', 'target-pinned', 'target-popup', 'disabled']) {
    const f = fixture();
    await f.run.onCreated(f.tabs.get(1));
    await f.run.onCreated(f.tabs.get(2));
    if (scenario === 'write') f.state.failWrite = true;
    if (scenario === 'invalid-state') f.session[SESSION_KEY] = { version: 9 };
    f.state.beforeGet = id => {
      if (scenario === 'keeper-gone' && id === 2) f.tabs.delete(2);
      if (id !== 1) return;
      if (scenario === 'keeper-gone-late') f.tabs.delete(2);
      if (scenario === 'target-navigated') f.tabs.get(1).url = 'https://example.test/editor';
      if (scenario === 'target-pinned') f.tabs.get(1).pinned = true;
      if (scenario === 'target-popup') f.tabs.get(1).windowId = 4;
      if (scenario === 'disabled') f.local[ENABLED_KEY] = false;
    };
    await f.run.onReady(sender(2));
    assert.deepEqual(f.calls, [], scenario);
  }
}

/** 新页在旧轮查询期间创建时，中断旧删除，再由新页完成合并。 */
async function testConcurrentCreation() {
  const f = fixture();
  await f.run.onCreated(f.tabs.get(1));
  await f.run.onCreated(f.tabs.get(2));
  let pendingCreate;
  f.state.beforeGet = id => {
    if (id !== 1 || pendingCreate) return;
    const latest = { id: 10, windowId: 2, url: DASHBOARD };
    f.tabs.set(10, latest);
    pendingCreate = f.run.onCreated(latest);
  };
  await f.run.onReady(sender(2));
  assert.deepEqual(f.calls, []);
  await pendingCreate;
  f.state.beforeGet = null;
  await f.run.onReady(sender(10));
  assert.deepEqual(f.calls, [2, 1]);
  assert.equal(f.tabs.has(10), true);
}

/** 运行本功能的后台边界、并发、恢复与错误路径测试。 */
export async function testDashboardCleanup() {
  await testModesAndScope();
  await testOrdering();
  await testPlaceholderProof();
  await testFailureAndRechecks();
  await testConcurrentCreation();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await testDashboardCleanup();
  console.log('Dashboard cleanup tests passed.');
}

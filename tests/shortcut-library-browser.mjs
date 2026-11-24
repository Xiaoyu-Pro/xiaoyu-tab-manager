import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 从真实输入框搜索，保留其键盘和候选行为。 */
async function search(page, query) {
  await page.evaluate(`(() => { const input = document.querySelector('#keywordSearchInput');
    input.focus(); input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}

/** 发送真实浏览器按键，支持 Shift+Enter 和副本菜单快捷键。 */
async function press(page, key, code, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers,
    ...(key === 'Enter' ? { text: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers });
}

/** 注入本地测试备份文件，走原生文件选择后的预览事件。 */
async function chooseBackup(page, text) {
  await page.evaluate(`(() => { const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(text)}], 'shortcuts.json', { type: 'application/json' }));
    const input = document.querySelector('#keywordImportFile'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.waitFor('!document.querySelector("#keywordImport").disabled');
}

/** 保存无真实内网数据的界面证据。 */
async function screenshot(page, name) {
  if (!process.env.XIAOYU_QA_ARTIFACT_DIR) return;
  const directory = resolve(process.env.XIAOYU_QA_ARTIFACT_DIR);
  await mkdir(directory, { recursive: true });
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, name), Buffer.from(result.data, 'base64'));
}

/** 验证预览不写入、取消、原子失败重试、幂等合并及导出内容。 */
async function testBackup(page, base) {
  await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
  const before = await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`);
  const text = JSON.stringify({ format: 'xiaoyu-tab-manager-shortcuts', version: 1, mappings: [
    { keyword: '看板', title: '不得覆盖标题', url: `${base}/a?x=1#full`, aliases: ['新别名'] },
    { keyword: 'Imported', title: '导入入口', url: `${base}/import`, aliases: ['import-alias'] },
  ] });
  await chooseBackup(page, text);
  assert.equal(await page.evaluate(`document.querySelector('#keywordImportPreview').hidden`), false);
  assert.match(await page.evaluate(`document.querySelector('#keywordImportSummary').textContent`), /1 new · 1 existing · 1 new aliases/);
  assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`), before);
  await page.evaluate(`document.querySelector('#keywordImportCancel').click()`);
  assert.equal(await page.evaluate(`document.querySelector('#keywordImportPreview').hidden`), true);
  await chooseBackup(page, text);
  await chooseBackup(page, '{}');
  assert.equal(await page.evaluate(`document.querySelector('#keywordImportPreview').hidden`), true);
  assert.match(await page.evaluate(`document.querySelector('#keywordManagerStatus').textContent`), /Invalid Xiaoyu backup/);
  assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`), before);
  await chooseBackup(page, text);
  await page.evaluate(`window.shortcutOriginalSet = SuperTabOutStorage.set; SuperTabOutStorage.set = async () => { throw new Error('quota'); }; document.querySelector('#keywordImportConfirm').click()`);
  await page.waitFor('!document.querySelector("#keywordImportConfirm").disabled');
  assert.match(await page.evaluate(`document.querySelector('#keywordManagerStatus').textContent`), /Could not save/);
  assert.equal(await page.evaluate(`document.querySelector('#keywordImportPreview').hidden`), false);
  assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`), before);
  await page.evaluate(`SuperTabOutStorage.set = window.shortcutOriginalSet; delete window.shortcutOriginalSet; document.querySelector('#keywordImportConfirm').click()`);
  await page.waitFor('document.querySelector("#keywordImportPreview").hidden && !document.querySelector("#keywordImportConfirm").disabled');
  const after = await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`);
  assert.equal(after.length, before.length + 1);
  assert.equal(after[0].title, 'ARGALL 看板');
  assert.equal(after[0].id, 'legacy');
  assert.deepEqual(after[0].aliases, ['新别名']);
  await chooseBackup(page, text);
  assert.match(await page.evaluate(`document.querySelector('#keywordImportSummary').textContent`), /0 new · 2 existing · 0 new aliases/);
  await page.evaluate(`document.querySelector('#keywordImportConfirm').click()`);
  await page.waitFor('document.querySelector("#keywordImportPreview").hidden && !document.querySelector("#keywordImportConfirm").disabled');
  assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`), after);
  await page.evaluate(`(() => { window.shortcutAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.shortcutDownload = fetch(this.href).then(response => response.json()); };
    document.querySelector('#keywordExport').click(); })()`);
  await page.waitFor('!document.querySelector("#keywordExport").disabled');
  const exported = await page.evaluate(`window.shortcutDownload`);
  assert.equal(exported.format, 'xiaoyu-tab-manager-shortcuts');
  assert.equal(exported.mappings.length, after.length);
  assert.equal(exported.mappings.some(row => 'id' in row), false);
  await page.evaluate(`HTMLAnchorElement.prototype.click = window.shortcutAnchorClick; delete window.shortcutAnchorClick; delete window.shortcutDownload`);
  await screenshot(page, 'shortcut-backup.png');
  await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
}

/** 验证卡片直达分组编辑、原子改名、子项操作，以及正文底部仍可真实点击关闭。 */
async function testGroupEditor(page, extensionBase, base) {
  const before = await page.evaluate(`(async () => ({ data: await chrome.storage.local.get(['keywordPageMappings', 'keywordGroupColors']),
    theme: localStorage.getItem('tab-out-theme'), language: localStorage.getItem('tab-out-language'),
    tabs: (await chrome.tabs.query({})).length }))()`);
  try {
    await page.evaluate(`document.querySelector('[data-action="color-shortcut-group"][data-keyword="看板"]').focus()`);
    await press(page, 'Enter', 13);
    await page.waitFor('document.activeElement.id === "keywordGroupColorCode" && document.querySelectorAll(".keyword-mapping-row").length === 2');
    assert.equal(await page.evaluate(`document.querySelector('#keywordGroupName').value`), '看板');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingKeyword').closest('label').hidden`), true);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.keyword-backup-tools')).display`), 'none');
    await page.evaluate(`document.querySelector('#keywordGroupColorCode').value = 'rgb(210,230,220)'; document.querySelector('#keywordGroupColorForm').requestSubmit()`);
    await page.waitFor('document.querySelector("#keywordManagerStatus").textContent.includes("updated") && !document.querySelector("#keywordGroupColorSave").disabled');
    await page.waitFor(`document.querySelector('[data-action="color-shortcut-group"][data-keyword="看板"] .keyword-group-swatch').style.backgroundColor === 'rgb(210, 230, 220)'`);

    await page.evaluate(`document.querySelector('[data-mapping-action="edit"][data-mapping-id="legacy"]').click();
      document.querySelector('#keywordMappingTitle').value = 'Edited <ARGALL>';
      document.querySelector('#keywordGroupName').value = 'tce'; document.querySelector('#keywordGroupNameForm').requestSubmit()`);
    await page.waitFor('document.querySelector("#keywordManagerStatus").textContent.includes("already in use")');
    assert.equal(await page.evaluate(`document.querySelector('#keywordGroupName').value`), 'tce');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingTitle').value`), 'Edited <ARGALL>');
    await page.evaluate(`window.editorOriginalSet = SuperTabOutStorage.set; SuperTabOutStorage.set = async () => { throw new Error('test quota'); };
      document.querySelector('#keywordGroupName').value = 'Observability'; document.querySelector('#keywordGroupNameForm').requestSubmit()`);
    await page.waitFor('document.querySelector("#keywordManagerStatus").textContent.includes("Could not save")');
    assert.equal(await page.evaluate(`document.querySelector('#keywordGroupName').value`), 'Observability');
    assert.equal(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings.find(row => row.id === 'legacy').keyword)`), '看板');
    await page.evaluate(`SuperTabOutStorage.set = window.editorOriginalSet; delete window.editorOriginalSet;
      document.querySelector('#keywordGroupNameForm').requestSubmit()`);
    await page.waitFor('document.querySelector("#keywordManagerTitle").textContent.includes("Observability") && !document.querySelector("#keywordMappingSave").disabled');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingTitle').value`), 'Edited <ARGALL>');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingKeyword').value`), 'Observability');
    assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordGroupColors').then(data => data.keywordGroupColors)`), { observability: '#D2E6DC' });
    await page.evaluate(`document.querySelector('#keywordMappingAliases').value = ['new-alias', '主链路'].join(String.fromCharCode(10));
      document.querySelector('#keywordMappingUrl').value = ${JSON.stringify(`${base}/edited?b=2&a=1#exact`)}; document.querySelector('#keywordMappingForm').requestSubmit()`);
    await page.waitFor('document.querySelector("#keywordManagerStatus").textContent.startsWith("Saved.") && !document.querySelector("#keywordMappingSave").disabled');
    assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings.find(row => row.id === 'legacy').aliases)`), ['new-alias', '主链路']);
    assert.equal(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings.find(row => row.id === 'legacy').url)`), `${base}/edited?b=2&a=1#exact`);
    await page.evaluate(`document.querySelector('#keywordMappingTitle').value = 'Added page';
      document.querySelector('#keywordMappingUrl').value = ${JSON.stringify(`${base}/editor?b=2&a=1#exact`)}; document.querySelector('#keywordMappingForm').requestSubmit()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 3 && !document.querySelector("#keywordMappingSave").disabled');
    await page.evaluate(`Array.from(document.querySelectorAll('.keyword-mapping-row')).find(row => row.textContent.includes('Added page')).querySelector('[data-mapping-action="delete"]').click()`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-mapping-row').length`), 3);
    await page.evaluate(`document.querySelector('[data-confirm="true"]').click()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 2 && !document.querySelector("#keywordMappingSave").disabled');
    await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
    await search(page, 'Observability');
    await page.waitFor(`document.querySelectorAll('.keyword-search-option').length === 2 && Array.from(document.querySelectorAll('.keyword-result-tag')).every(tag => tag.textContent === 'Observability' && tag.style.backgroundColor === 'rgb(210, 230, 220)')`);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("[data-action=edit-shortcut-group][data-keyword=Observability]")');
    await page.evaluate(`document.querySelector('[data-action="edit-shortcut-group"][data-keyword="Observability"]').click()`);
    await page.waitFor('document.activeElement.id === "keywordGroupName" && document.querySelectorAll(".keyword-mapping-row").length === 2');
    assert.equal(await page.evaluate(`document.querySelector('#keywordGroupColorCode').value`), '#D2E6DC');
    for (const theme of ['white', 'midnight']) {
      await page.evaluate(`document.querySelector('[data-theme-name="${theme}"]').click(); document.querySelector('[data-language="zh"]').click()`);
      assert.match(await page.evaluate(`document.querySelector('#keywordManagerTitle').textContent`), /编辑分组/);
      for (const width of [1365, 768, 390]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
        const layout = await page.evaluate(`(() => { const dialog = document.querySelector('#keywordManager');
          const body = dialog.querySelector('.keyword-dialog-body'); body.scrollTop = body.scrollHeight;
          const close = document.querySelector('#keywordManagerClose').getBoundingClientRect();
          return { overflow: dialog.scrollWidth > dialog.clientWidth || body.scrollWidth > body.clientWidth,
            visible: close.top >= 0 && close.bottom <= innerHeight, scrollable: body.scrollHeight > body.clientHeight,
            clickable: document.elementFromPoint(close.x + close.width/2, close.y + close.height/2)?.id === 'keywordManagerClose' }; })()`);
        assert.deepEqual(layout, { overflow: false, visible: true, scrollable: true, clickable: true });
        if (width !== 768) await screenshot(page, `shortcut-group-editor-${theme}-${width}.png`);
      }
    }
    const point = await page.evaluate(`(() => { const rect = document.querySelector('#keywordManagerClose').getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await page.waitFor('!document.querySelector("#keywordManager").open');
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`document.querySelector('[data-language="en"]').click(); document.querySelector('#keywordManageBtn').click()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 3');
    assert.equal(await page.evaluate(`document.querySelector('#keywordGroupNameForm').hidden`), true);
    assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('.keyword-backup-tools')).display`), 'none');
    await page.evaluate(`(async () => { const saved = await chrome.storage.local.get('keywordPageMappings');
      await chrome.storage.local.set({ keywordPageMappings: [...saved.keywordPageMappings,
        ...Array.from({ length: 12 }, (_, index) => ({ id: 'scroll-' + index, keyword: 'Scroll group ' + index,
          title: 'Synthetic page', url: ${JSON.stringify(base)} + '/scroll-' + index, aliases: [] }))] }); })()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-group").length === 14');
    for (const width of [1365, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      const layout = await page.evaluate(`(() => { const body = document.querySelector('#keywordManager .keyword-dialog-body');
        body.scrollTop = body.scrollHeight; const close = document.querySelector('#keywordManagerClose').getBoundingClientRect();
        return { scrolled: body.scrollTop > 0, visible: close.top >= 0 && close.bottom <= innerHeight,
          clickable: document.elementFromPoint(close.x + close.width/2, close.y + close.height/2)?.id === 'keywordManagerClose' }; })()`);
      assert.deepEqual(layout, { scrolled: true, visible: true, clickable: true });
    }
    await press(page, 'Escape', 27);
    await page.waitFor('!document.querySelector("#keywordManager").open');
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`), before.tabs);
    console.log('Shortcut group editor browser regression passed (direct entry, HEX/RGB, rename, drafts, conflict, save failure, child CRUD, persistence, 2 themes, 3 viewports, real close click).');
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`(() => { if (window.editorOriginalSet) { SuperTabOutStorage.set = window.editorOriginalSet; delete window.editorOriginalSet; }
      if (document.querySelector('#keywordManager').open) document.querySelector('#keywordManager').close(); })()`);
    await page.evaluate(`(async () => { const before = ${JSON.stringify(before)};
      await chrome.storage.local.set(before.data);
      if (!Object.hasOwn(before.data, 'keywordGroupColors')) await chrome.storage.local.remove('keywordGroupColors');
      for (const [key,value] of [['tab-out-theme',before.theme],['tab-out-language',before.language]]) {
        if (value === null) localStorage.removeItem(key); else localStorage.setItem(key,value);
      } })()`);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-row").length === 3');
  }
}

/** 在独立 Chrome 配置验证快捷卡片、分组编辑、别名、精确复用、收录与安全备份。 */
export async function testShortcutLibraryBrowser(page, extensionBase) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<title>收录测试页面</title><p>Local shortcut fixture</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/a?x=1#full`;
  try {
    await page.waitFor('document.querySelector("[data-organization-view=domain]")');
    const created = await page.evaluate(`(async () => {
      const dashboard = await chrome.tabs.getCurrent();
      const other = await chrome.windows.create({ url: ${JSON.stringify(url)}, focused: false });
      await chrome.storage.local.set({ keywordPageMappings: [
        { id: 'legacy', keyword: '看板', title: 'ARGALL 看板', url: ${JSON.stringify(url)} },
        { id: 'service', keyword: 'tce', title: 'ARGALL 服务', url: ${JSON.stringify(`${base}/service`)}, aliases: ['ag', '主链路服务'] },
        { id: 'param', keyword: '看板', title: '参数不同的页面', url: ${JSON.stringify(`${base}/a?x=2#full`)} }
      ] });
      return { dashboardId: dashboard.id, dashboardWindowId: dashboard.windowId, targetId: other.tabs[0].id, windowId: other.id };
    })()`);
    await page.waitFor(`chrome.tabs.get(${created.targetId}).then(tab => tab.status === 'complete')`);
    await search(page, 'ag');
    await page.waitFor('document.querySelectorAll(".keyword-search-option").length === 1');
    assert.equal(await page.evaluate(`document.querySelector('.keyword-result-tag').textContent`), 'tce');
    await search(page, 'argall');
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-search-option').length`), 2);
    await page.waitFor('document.querySelector(".keyword-search-option .shortcut-open-state").textContent.includes("Open · Window")');
    const count = await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`);
    await page.evaluate(`document.querySelector('.keyword-search-option').click()`);
    await page.waitFor('document.querySelector("#keywordSearchResults").hidden');
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`), count);
    assert.equal(await page.evaluate(`chrome.tabs.get(${created.targetId}).then(tab => tab.active)`), true);
    await page.evaluate(`document.querySelector('#openTabsSearch').value = 'retain-filter'; document.querySelector('[data-organization-view="shortcuts"]').click()`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-row").length === 3');
    assert.equal(await page.evaluate(`document.querySelectorAll('.shortcut-library-card').length`), 2);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.open-tabs-search-wrap')).display`), 'none');
    assert.equal(await page.evaluate(`document.querySelector('#openTabsSearch').value`), 'retain-filter');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#openTabsMissions')).columnCount`), 'auto');
    assert.equal(await page.evaluate(`(() => { const toolbar = document.querySelector('.shortcut-library-toolbar').getBoundingClientRect();
      const grid = document.querySelector('.shortcut-library-grid').getBoundingClientRect(); return grid.top >= toolbar.bottom; })()`), true);
    await testGroupEditor(page, extensionBase, base);
    await screenshot(page, 'shortcut-library-light.png');
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-row").length === 3');
    assert.equal(await page.evaluate(`document.querySelector('[data-organization-view="shortcuts"]').getAttribute('aria-selected')`), 'true');
    await page.evaluate(`document.querySelector('[data-mapping-id="param"][data-action="open-shortcut"]').click()`);
    await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.url === ${JSON.stringify(`${base}/a?x=2#full`)}))`);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url === ${JSON.stringify(url)}).length)`), 1);
    // 先右键取消，随后用键盘菜单明确新开副本。
    await page.evaluate(`document.querySelector('[data-action="open-shortcut"][data-mapping-id="legacy"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 420 }))`);
    assert.equal(await page.evaluate(`document.querySelector('#shortcutContextMenu').hidden`), false);
    await press(page, 'Escape', 27);
    assert.equal(await page.evaluate(`document.querySelector('#shortcutContextMenu').hidden`), true);
    assert.equal(await page.evaluate(`document.body.classList.contains('privacy-mode')`), false);
    await page.evaluate(`document.querySelector('[data-action="open-shortcut"][data-mapping-id="legacy"]').focus()`);
    await press(page, 'F10', 121, 8);
    await page.waitFor('!document.querySelector("#shortcutContextMenu").hidden');
    await page.evaluate(`document.querySelector('#shortcutNewCopy').click()`);
    await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url === ${JSON.stringify(url)} && tab.status === 'complete').length === 2)`);
    await search(page, 'argall');
    await press(page, 'Enter', 13, 8);
    await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url === ${JSON.stringify(url)} && tab.status === 'complete').length === 3)`);
    // 普通点击仍不新增；API 创建的副本不被自动防重删除。
    await search(page, 'argall');
    await page.evaluate(`document.querySelector('.keyword-search-option').click()`);
    await page.waitFor('document.querySelector("#keywordSearchResults").hidden');
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url === ${JSON.stringify(url)}).length)`), 3);
    const localTarget = await page.evaluate(`chrome.tabs.create({ url: ${JSON.stringify(url)}, windowId: ${created.dashboardWindowId}, active: false }).then(tab => tab.id)`);
    await page.waitFor(`chrome.tabs.get(${localTarget}).then(tab => tab.status === 'complete')`);
    await search(page, 'argall');
    await page.evaluate(`document.querySelector('.keyword-search-option').click()`);
    await page.waitFor('document.querySelector("#keywordSearchResults").hidden');
    assert.equal(await page.evaluate(`chrome.tabs.get(${localTarget}).then(tab => tab.active)`), true);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url === ${JSON.stringify(url)}).length)`), 4);
    await page.evaluate(`document.querySelector('[data-organization-view="window"]').click()`);
    await page.waitFor('document.querySelector("[data-action=capture-shortcut]")');
    await page.evaluate(`document.querySelector('[data-action="capture-shortcut"][data-tab-id="${created.targetId}"]').click()`);
    await page.waitFor('document.querySelector("#keywordManager").open');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingUrl').value`), url);
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingTitle').value`), '收录测试页面');
    await page.evaluate(`(() => { const form = document.querySelector('#keywordMappingForm');
      form.elements.keyword.value = '收录'; form.elements.aliases.value = ${JSON.stringify('capture\n速达')}; form.requestSubmit(); })()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 4 && !document.querySelector("#keywordMappingSave").disabled');
    await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
    await search(page, '速达');
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-search-option').length`), 1);
    await press(page, 'Escape', 27);
    await page.evaluate(`document.querySelector('[data-organization-view="domain"]').click()`);
    // 域名视图按 URL 折叠副本，代表行可能不是最早在另一个窗口创建的 ID。
    const domainCapture = `.page-chip[data-tab-url="${url}"] [data-action="capture-shortcut"]`;
    await page.waitFor(`!document.querySelector('.window-grid') && document.querySelector(${JSON.stringify(domainCapture)})`);
    // 等浏览器事件的 300ms 防抖重绘结束，避免刚聚焦的旧 DOM 被测试中的后台更新替换。
    await page.evaluate(`new Promise(resolve => setTimeout(resolve, 450))`);
    await page.evaluate(`document.querySelector(${JSON.stringify(domainCapture)}).focus()`);
    assert.equal(await page.evaluate(`document.activeElement?.dataset.action`), 'capture-shortcut');
    await press(page, 'Enter', 13);
    await page.waitFor('document.querySelector("#keywordManager").open');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingUrl').value`), url);
    await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
    await testBackup(page, base);
    await page.evaluate(`document.querySelector('[data-organization-view="shortcuts"]').click(); document.querySelector('[data-language="zh"]').click(); document.querySelector('[data-theme-name="midnight"]').click()`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-row").length === 5');
    await screenshot(page, 'shortcut-library-dark.png');
    for (const width of [1365, 768, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
      assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('.shortcut-library-row')).some(row => row.scrollWidth > row.clientWidth)`), false);
    }
    await screenshot(page, 'shortcut-library-mobile.png');
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`document.querySelector('[data-action="open-shortcut"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); document.body.classList.add('privacy-mode')`);
    await page.waitFor('document.querySelector("#shortcutContextMenu").hidden');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.shortcut-library-grid')).display`), 'none');
    await page.evaluate(`document.body.classList.remove('privacy-mode'); document.querySelector('[data-language="en"]').click(); document.querySelector('[data-organization-view="domain"]').click()`);
    await page.waitFor('!document.querySelector(".open-tabs-search-wrap").hidden');
    await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => chrome.tabs.remove(tab.id))))`);
    await page.evaluate(`document.querySelector('[data-organization-view="shortcuts"]').click()`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-row").length === 5 && !document.querySelector(".shortcut-library-row .is-open")');
    await search(page, '速达');
    await page.waitFor('document.querySelector(".keyword-search-option .shortcut-open-state").textContent === "Not open"');
    await page.evaluate(`document.querySelector('#keywordSearchInput').blur(); document.body.click()`);
    await screenshot(page, 'shortcut-library-closed-pages.png');
    assert.deepEqual(page.errors, []);
    console.log('Shortcut library browser regression passed (aliases, exact reuse, copies, cards, capture, backup, privacy, responsive layouts).');
  } finally {
    await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => chrome.tabs.remove(tab.id))))`);
    await page.evaluate(`chrome.storage.local.remove('keywordPageMappings'); localStorage.removeItem('organizationView'); localStorage.removeItem('tab-out-theme'); localStorage.removeItem('tab-out-language')`);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("[data-organization-view=domain]")');
    await new Promise(resolve => server.close(resolve));
  }
}

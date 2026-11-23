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

/** 用合成分组验证方块、同名配色、长名称、主题对比度与刷新后的稳定性。 */
async function testProjectTiles(page, extensionBase, base) {
  const groups = [
    ['看板', ['argall', 'bios', 'pistis', 'TTFT']],
    ['tce', ['kosmos', 'hermes2', 'mining', 'ARGALL']],
    ['tcc', ['kosmos', 'argall', 'hermes2', 'mining']],
    ['代码库', ['argall', 'hermes2', 'mining', 'portal']],
    ['数据库', ['hermes2', 'everest_prod', 'ad_pass_state']],
    ['长名称', ['很长的中文页面名称也需要保持正方形并且能够完整获知', 'VeryLongEnglishProjectTitleWithoutSpacesForLayoutTesting']],
  ];
  const rows = groups.flatMap(([keyword, titles], group) => titles.map((title, index) => ({
    id: `tile-${group}-${index}`, keyword, title, url: `${base}/tiles/${group}/${index}`, aliases: [],
  })));
  await page.evaluate(`chrome.storage.local.set({ keywordPageMappings: ${JSON.stringify(rows)} })`);
  await page.waitFor(`document.querySelectorAll('.shortcut-library-row').length === ${rows.length}`);
  assert.equal(await page.evaluate(`document.querySelector('.shortcut-library-grid').textContent.includes('http')`), false);
  assert.equal(await page.evaluate(`document.querySelectorAll('.shortcut-library-url').length`), 0);
  const color = await page.evaluate(`document.querySelector('[data-mapping-id="tile-0-0"]').style.getPropertyValue('--shortcut-project-hue')`);
  for (const id of ['tile-1-3', 'tile-2-1', 'tile-3-0']) {
    assert.equal(await page.evaluate(`document.querySelector('[data-mapping-id="${id}"]').style.getPropertyValue('--shortcut-project-hue')`), color);
  }
  await page.navigate(`${extensionBase}/index.html`);
  await page.waitFor(`document.querySelectorAll('.shortcut-library-row').length === ${rows.length}`);
  assert.equal(await page.evaluate(`document.querySelector('[data-mapping-id="tile-0-0"]').style.getPropertyValue('--shortcut-project-hue')`), color);
  for (const theme of ['white', 'midnight']) {
    await page.evaluate(`document.querySelector('[data-theme-name="${theme}"]').click()`);
    for (const width of [1365, 768, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false });
      // 等主题和入场动画结束，验证最终配色而非明暗切换中的过渡帧。
      await page.waitFor(`document.querySelector('.shortcut-library-grid').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running') && getComputedStyle(document.querySelector('.shortcut-library-card')).opacity === '1'`);
      const layout = await page.evaluate(`(() => {
        const canvas = document.createElement('canvas').getContext('2d');
        // 将浏览器混色转换为 RGB，再按 WCAG 相对亮度检查最终文字对比度。
        const luminance = color => { canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
          const channels = [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
            const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          tiles: [...document.querySelectorAll('.shortcut-library-row')].map(tile => {
            const rect = tile.getBoundingClientRect(); const style = getComputedStyle(tile);
            const a = luminance(style.color), b = luminance(style.backgroundColor);
            return { square: Math.abs(rect.width - rect.height) < 1, width: rect.width,
              overflow: tile.scrollWidth > tile.clientWidth, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
              foreground: style.color, background: style.backgroundColor };
          }) };
      })()`);
      assert.equal(layout.overflow, false, `${theme}/${width}: horizontal overflow`);
      assert.ok(layout.tiles.every(tile => tile.square && tile.width >= 44 && !tile.overflow && tile.contrast >= 4.5), `${theme}/${width}: ${JSON.stringify(layout.tiles)}`);
      if (width !== 768) await screenshot(page, `shortcut-project-tiles-${theme}-${width}.png`);
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(await page.evaluate(`chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`), rows);
  await page.evaluate(`document.querySelector('[data-action="open-shortcut"][data-mapping-id="tile-0-0"]').focus()`);
  assert.equal(await page.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'solid');
  await press(page, 'Enter', 13);
  await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.url === ${JSON.stringify(rows[0].url)}))`);
}

/** 在独立 Chrome 验证名称色块、别名、精确复用、收录与安全备份。 */
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
    await testProjectTiles(page, extensionBase, base);
    assert.deepEqual(page.errors, []);
    console.log('Shortcut library browser regression passed (project tiles, stable colors, square layouts, contrast, aliases, exact reuse, copies, capture, backup, privacy).');
  } finally {
    await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => chrome.tabs.remove(tab.id))))`);
    await page.evaluate(`chrome.storage.local.remove('keywordPageMappings'); localStorage.removeItem('organizationView'); localStorage.removeItem('tab-out-theme'); localStorage.removeItem('tab-out-language')`);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("[data-organization-view=domain]")');
    await new Promise(resolve => server.close(resolve));
  }
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 发送真实按键，覆盖与仪表盘全局快捷键的交互。 */
async function press(page, key, code) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
}

/** 通过管理表单提交一条映射，等待真实存储和 UI 同步。 */
async function addMapping(page, mapping, count) {
  await page.evaluate(`(() => {
    const row = ${JSON.stringify(mapping)};
    const form = document.querySelector('#keywordMappingForm');
    for (const key of ['keyword', 'title', 'url']) form.elements[key].value = row[key];
    form.requestSubmit();
  })()`);
  await page.waitFor(`document.querySelectorAll('.keyword-mapping-row').length === ${count} && !document.querySelector('#keywordMappingSave').disabled`);
}

/** 从实际输入框触发搜索，不直接调用匹配函数。 */
async function search(page, query) {
  await page.waitFor('document.querySelector("#keywordSearchInput")');
  await page.evaluate(`(() => {
    const input = document.querySelector('#keywordSearchInput');
    input.focus(); input.value = ${JSON.stringify(query)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

/** 按需输出隔离测试的视觉证据，不包含任何真实用户页面。 */
async function screenshot(page, name, clip) {
  if (!process.env.XIAOYU_QA_ARTIFACT_DIR) return;
  const directory = resolve(process.env.XIAOYU_QA_ARTIFACT_DIR);
  await mkdir(directory, { recursive: true });
  const result = await page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await writeFile(join(directory, name), Buffer.from(result.data, 'base64'));
}

/** 回归分组默认收起、原生键盘切换、状态保留、自动展开和长网址布局。 */
async function testMappingGroups(page, base) {
  await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
  await page.waitFor('document.querySelectorAll(".keyword-mapping-group").length === 2');
  assert.equal(await page.evaluate(`document.querySelectorAll('details.keyword-mapping-group').length`), 2);
  assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-mapping-group[open]').length`), 0);
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-group-count'), node => node.textContent)`), ['2 pages', '1 page']);
  await page.evaluate(`document.querySelector('.keyword-mapping-group summary').focus()`);
  await press(page, 'Enter', 13);
  assert.equal(await page.evaluate(`document.querySelector('.keyword-mapping-group').open`), true);
  await press(page, 'Enter', 13);
  assert.equal(await page.evaluate(`document.querySelector('.keyword-mapping-group').open`), false);
  const longUrl = `${base}/long?query=${'very-long-query-'.repeat(30)}#full-fragment`;
  await addMapping(page, { keyword: '看板', title: '长网址布局验证', url: longUrl }, 4);
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-mapping-group'), group => group.open)`), [true, false]);
  assert.equal(await page.evaluate(`document.querySelector('.keyword-group-count').textContent`), '3 pages');
  const urlLayout = await page.evaluate(`(() => {
    const url = Array.from(document.querySelectorAll('.keyword-mapping-copy small')).find(node => node.title === ${JSON.stringify(longUrl)});
    const style = url && getComputedStyle(url);
    return url && { title: url.title, whiteSpace: style.whiteSpace, ellipsis: style.textOverflow, clipped: url.scrollWidth > url.clientWidth };
  })()`);
  assert.deepEqual(urlLayout, { title: longUrl, whiteSpace: 'nowrap', ellipsis: 'ellipsis', clipped: true });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  const compactLayout = await page.evaluate(`(() => {
    const dialog = document.querySelector('#keywordManager');
    const row = Array.from(document.querySelectorAll('.keyword-mapping-row')).find(node => node.textContent.includes('长网址布局验证'));
    return { overflow: dialog.scrollWidth > dialog.clientWidth,
      overlaps: row.querySelector('.keyword-mapping-copy').getBoundingClientRect().right > row.querySelector('.keyword-row-actions').getBoundingClientRect().left };
  })()`);
  assert.deepEqual(compactLayout, { overflow: false, overlaps: false });
  await screenshot(page, 'keyword-groups-mobile.png');
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
  await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
  await page.waitFor('document.querySelector("#keywordManager").open');
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-mapping-group'), group => group.open)`), [true, false]);
  await page.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.keyword-mapping-row')).find(node => node.textContent.includes('长网址布局验证'));
    row.querySelector('[data-mapping-action="delete"]').click();
    document.querySelector('[data-confirm="true"]').click();
  })()`);
  await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 3 && !document.querySelector("#keywordMappingSave").disabled');
  assert.equal(await page.evaluate(`document.querySelector('.keyword-group-count').textContent`), '2 pages');
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-mapping-group'), group => group.open)`), [true, false]);
  await page.evaluate(`document.querySelector('[data-language="zh"]').click()`);
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-group-count'), node => node.textContent)`), ['2 个页面', '1 个页面']);
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-mapping-group'), group => group.open)`), [true, false]);
  const clip = await page.evaluate(`(() => {
    const rect = document.querySelector('#keywordManager').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  await screenshot(page, 'keyword-groups-light.png', clip);
  await page.evaluate(`document.querySelector('[data-language="en"]').click()`);
  await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
}

/** 验证两个分组内的同名页面同时出现，尾部归属正确，选择后只打开指定页面。 */
async function testCrossGroupPageSearch(page, base) {
  await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
  await addMapping(page, { keyword: '看板', title: 'argall', url: `${base}/argall-dashboard?orgId=1#hour` }, 3);
  await addMapping(page, { keyword: 'tce', title: 'argall', url: `${base}/argall-service?module=instance&control_plane=i18n` }, 4);
  await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
  await search(page, '  aRgAlL  ');
  const candidates = await page.evaluate(`Array.from(document.querySelectorAll('.keyword-search-option'), node => ({
    title: node.querySelector('.keyword-result-title').textContent,
    group: node.querySelector('.keyword-result-tag').textContent,
    groupTooltip: node.querySelector('.keyword-result-tag').title,
  }))`);
  assert.deepEqual(candidates, [
    { title: 'argall', group: '看板', groupTooltip: '看板' },
    { title: 'argall', group: 'tce', groupTooltip: 'tce' },
  ]);
  const before = await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`);
  await screenshot(page, 'keyword-cross-group.png', { x: 0, y: 0, width: 1365, height: 240, scale: 1 });
  await page.evaluate(`document.querySelectorAll('.keyword-search-option')[1].click()`);
  await page.waitFor('document.querySelector("#keywordSearchResults").hidden');
  assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`), before + 1);
  const urls = await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => tab.url))`);
  assert.deepEqual(urls, [`${base}/argall-service?module=instance&control_plane=i18n`]);
  await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => chrome.tabs.remove(tab.id))))`);
}

/** 验证映射 CRUD、长期保存、候选隔离、单页打开、输入法和响应式布局。 */
export async function testKeywordSearch(page, extensionBase) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<title>Keyword mapping fixture</title><p>Local test page</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.waitFor('document.querySelector("#keywordSearchInput")');
    const originalFilter = await page.evaluate(`document.querySelector('#openTabsSearch').value`);
    await search(page, '');
    await page.waitFor('document.querySelector("#keywordSearchHint").textContent.includes("group or page name")');
    await press(page, 'Escape', 27);
    assert.equal(await page.evaluate(`document.querySelector('#keywordSearchResults').hidden`), true);
    assert.equal(await page.evaluate(`document.body.classList.contains('privacy-mode')`), false);
    await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
    await page.waitFor('document.querySelector("#keywordManager").open');
    await addMapping(page, { keyword: '看板', title: '主链路 <img src=x onerror=alert(1)>', url: `${base}/a?orgId=1&from=now#hour` }, 1);
    await addMapping(page, { keyword: '看板', title: '评测 & 对比', url: `${base}/b?orgId=2&refresh=5m` }, 2);
    await addMapping(page, { keyword: '看板测试', title: '仅供测试', url: `${base}/test` }, 3);
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-mapping-copy img').length`), 0);
    assert.equal(await page.evaluate(`document.activeElement.id`), 'keywordMappingTitle');
    await page.evaluate(`(() => {
      const form = document.querySelector('#keywordMappingForm');
      form.elements.keyword.value = '看板'; form.elements.title.value = '重复';
      form.elements.url.value = ${JSON.stringify(`${base}/a?orgId=1&from=now#hour`)}; form.requestSubmit();
    })()`);
    await page.waitFor('document.querySelector("#keywordManagerStatus").textContent.includes("already saved")');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingTitle').value`), '重复');
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-mapping-row').length`), 3);

    // 暂时替换本地存储边界以触发真实表单的失败反馈，再立即恢复。
    await page.evaluate(`(() => {
      window.keywordOriginalSet = SuperTabOutStorage.set;
      SuperTabOutStorage.set = async () => { throw new Error('test storage unavailable'); };
      const form = document.querySelector('#keywordMappingForm');
      form.elements.keyword.value = '失败'; form.elements.title.value = '保留输入';
      form.elements.url.value = ${JSON.stringify(`${base}/fail`)}; form.requestSubmit();
    })()`);
    await page.waitFor('document.querySelector("#keywordManagerStatus").textContent.includes("Could not save")');
    assert.equal(await page.evaluate(`document.querySelector('#keywordMappingTitle').value`), '保留输入');
    await page.evaluate(`SuperTabOutStorage.set = window.keywordOriginalSet; delete window.keywordOriginalSet; document.querySelector('#keywordManagerClose').click()`);
    await search(page, '看板');
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-search-option').length`), 2);
    assert.equal(await page.evaluate(`document.querySelector('#openTabsSearch').value`), originalFilter);
    assert.equal(await page.evaluate(`document.querySelectorAll('#keywordSearchList img').length`), 0);
    await screenshot(page, 'keyword-search-desktop.png');

    const before = await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`);
    await page.evaluate(`document.querySelector('#keywordSearchInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))`);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`), before);
    await press(page, 'ArrowDown', 40);
    assert.equal(await page.evaluate(`document.querySelector('.keyword-search-option[aria-selected="true"]').textContent.includes('评测')`), true);
    await press(page, 'Enter', 13);
    await page.waitFor(`document.querySelector('#keywordSearchResults').hidden`);
    const opened = await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => tab.url))`);
    assert.deepEqual(opened, [`${base}/b?orgId=2&refresh=5m`]);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.length)`), before + 1);
    await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => chrome.tabs.remove(tab.id))))`);
    await search(page, '看板');
    await page.evaluate(`document.querySelector('.keyword-search-option').click()`);
    await page.waitFor(`document.querySelector('#keywordSearchResults').hidden`);
    assert.deepEqual(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => tab.url))`), [`${base}/a?orgId=1&from=now#hour`]);
    await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(base)})).map(tab => chrome.tabs.remove(tab.id))))`);

    await page.navigate(`${extensionBase}/index.html`);
    await search(page, '看板');
    await page.waitFor('document.querySelectorAll(".keyword-search-option").length === 2');
    await testMappingGroups(page, base);
    await page.evaluate(`document.querySelector('[data-language="zh"]').click()`);
    await page.waitFor('document.querySelector("#keywordManageBtn").textContent === "管理"');
    assert.match(await page.evaluate(`document.querySelector('#keywordSearchInput').placeholder`), /分组或页面名称/);
    await page.evaluate(`document.querySelector('[data-theme-name="midnight"]').click()`);
    await page.waitFor('document.documentElement.dataset.theme === "midnight"');
    await screenshot(page, 'keyword-search-dark.png');
    for (const width of [1365, 1024, 768, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = await page.evaluate(`(() => {
        const search = document.querySelector('#keywordSearch').getBoundingClientRect();
        const greeting = document.querySelector('.header-left').getBoundingClientRect();
        const settings = document.querySelector('.header-right').getBoundingClientRect();
        return { left: search.left, right: search.right, top: search.top, greetingRight: greeting.right,
          greetingBottom: greeting.bottom, settingsLeft: settings.left, settingsBottom: settings.bottom };
      })()`);
      assert.ok(layout.left >= 0 && layout.right <= width, JSON.stringify(layout));
      assert.ok(layout.top >= Math.max(layout.greetingBottom, layout.settingsBottom) - 1
        || (layout.left >= layout.greetingRight && layout.right <= layout.settingsLeft), JSON.stringify(layout));
    }
    await screenshot(page, 'keyword-search-mobile.png');
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 3');
    await page.evaluate(`document.querySelector('[data-mapping-action="edit"]').click(); document.querySelector('#keywordMappingTitle').value = '主链路已编辑'; document.querySelector('#keywordMappingForm').requestSubmit()`);
    await page.waitFor('document.querySelector("#keywordMappingList").textContent.includes("主链路已编辑") && !document.querySelector("#keywordMappingSave").disabled');
    await screenshot(page, 'keyword-manager.png');
    await page.evaluate(`document.querySelector('#keywordManagerClose').click(); document.querySelector('[data-theme-name="system"]').click()`);
    await search(page, '看板');
    await screenshot(page, 'keyword-search-preview.png', { x: 0, y: 0, width: 1365, height: 240, scale: 1 });
    await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
    await page.waitFor('document.querySelector("#keywordManager").open');
    await page.evaluate(`document.querySelector('[data-mapping-action="delete"]').click()`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-mapping-row').length`), 3);
    await page.evaluate(`document.querySelector('[data-confirm="true"]').click()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 2 && !document.querySelector("#keywordMappingSave").disabled');
    await press(page, 'Escape', 27);
    await page.waitFor('!document.querySelector("#keywordManager").open');
    assert.equal(await page.evaluate(`document.body.classList.contains('privacy-mode')`), false);
    await search(page, 'not mapped');
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-search-option').length`), 0);
    assert.match(await page.evaluate(`document.querySelector('#keywordSearchHint').textContent`), /没有匹配/);
    await search(page, '看');
    assert.equal(await page.evaluate(`document.querySelectorAll('.keyword-search-option').length`), 2);
    await page.evaluate(`document.querySelector('#keywordManageBtn').click(); document.body.classList.add('privacy-mode')`);
    await page.waitFor('!document.querySelector("#keywordManager").open');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#keywordSearch')).display`), 'none');
    await page.evaluate(`document.body.classList.remove('privacy-mode'); document.querySelector('[data-language="en"]').click(); document.querySelector('[data-theme-name="system"]').click()`);
    await testCrossGroupPageSearch(page, base);
    await page.evaluate(`chrome.storage.local.remove('keywordPageMappings')`);
    // 本脚本使用全新隔离配置；清除测试切换的偏好，供后续默认主题回归使用。
    await page.evaluate(`localStorage.removeItem('tab-out-theme'); localStorage.removeItem('tab-out-language')`);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("#keywordSearchInput")');
    assert.deepEqual(page.errors, []);
    console.log('Keyword search browser regression passed (CRUD, persistence, keyboard, privacy, themes, 4 viewports).');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

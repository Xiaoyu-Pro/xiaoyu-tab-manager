import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 用真实设置入口打开标签行为分区。 */
async function openSettings(page) {
  await page.evaluate(`(() => { const panel = document.querySelector('#privacySettings');
    if (getComputedStyle(panel).display === 'none') document.querySelector('#privacySettingsBtn').click();
    document.querySelector('[data-settings-view="tabs"]').click(); })()`);
  await page.waitFor('!document.querySelector("#dashboardAutoCleanupEnabled").disabled');
}

/** 保存只含合成测试页面的设置截图。 */
async function screenshot(page, name) {
  if (!process.env.XIAOYU_QA_ARTIFACT_DIR) return;
  const directory = resolve(process.env.XIAOYU_QA_ARTIFACT_DIR);
  await mkdir(directory, { recursive: true });
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, name), Buffer.from(result.data, 'base64'));
}

/** 在隔离浏览器中确实停止扩展后台，验证下一次打开会经历全新的 worker。 */
async function stopDashboardWorker(page, extensionBase) {
  await page.send('ServiceWorker.enable');
  let timeout;
  const stopped = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Xiaoyu test worker did not stop')), 8000);
    page.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      if (versions.some(version => version.scriptURL === `${extensionBase}/background.js` && version.runningStatus === 'stopped')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  try {
    await page.send('ServiceWorker.stopAllWorkers');
    await stopped;
  } finally {
    clearTimeout(timeout);
  }
}

/** 在独立 Chrome 中检查设置、跨窗口、后台休眠恢复与并发合并。 */
export async function testDashboardCleanupBrowser(page, extensionBase) {
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.navigate(`${extensionBase}/index.html`);
  await page.waitFor('document.querySelector("#dashboardAutoCleanupEnabled") && !document.querySelector("#dashboardAutoCleanupEnabled").disabled && _initialRenderDone');
  await page.evaluate(`document.querySelector('[data-language="en"]').click()`);
  const current = await page.evaluate(`chrome.tabs.getCurrent().then(tab => ({ id: tab.id, pinned: tab.pinned }))`);
  // 固定测试控制页，确保检查关闭其他页面时不会丢失测试连接。
  await page.evaluate(`chrome.tabs.update(${current.id}, { pinned: true })`);
  const created = [];
  try {
    assert.equal(await page.evaluate(`document.querySelector('#dashboardAutoCleanupEnabled').checked`), false);
    const fixtures = await page.evaluate(`(async () => {
      const first = await chrome.tabs.create({ url: ${JSON.stringify(`${extensionBase}/index.html?cleanup=old`)}, active: false });
      const window = await chrome.windows.create({ url: ${JSON.stringify(`${extensionBase}/index.html?cleanup=other-window`)}, focused: false });
      const web = await chrome.tabs.create({ url: 'data:text/html,<title>Protected work page</title>', active: false });
      const tools = await chrome.tabs.create({ url: ${JSON.stringify(`${extensionBase}/tools.html?tool=url`)}, active: false });
      return { first: first.id, second: window.tabs[0].id, web: web.id, tools: tools.id };
    })()`);
    created.push(...Object.values(fixtures));
    await page.waitFor(`chrome.tabs.query({}).then(tabs => [${fixtures.first}, ${fixtures.second}].every(id => tabs.some(tab => tab.id === id && tab.status === 'complete')))`);
    await page.waitFor('document.querySelector("#tabOutDupeBanner").style.display !== "none"');
    await openSettings(page);

    // 仅让新设置的写入失败，其他本地存储不受影响；失败必须恢复真实关闭状态。
    await page.evaluate(`(() => { window.cleanupOriginalSet = chrome.storage.local.set;
      chrome.storage.local.set = async values => { if ('dashboardAutoCleanupEnabled' in values) throw new Error('test quota'); return window.cleanupOriginalSet(values); };
      document.querySelector('#dashboardAutoCleanupEnabled').click(); })()`);
    await page.waitFor('document.querySelector("#dashboardAutoCleanupStatus").textContent.includes("Could not") && !document.querySelector("#dashboardAutoCleanupEnabled").disabled');
    assert.equal(await page.evaluate(`document.querySelector('#dashboardAutoCleanupEnabled').checked`), false);
    await page.evaluate(`chrome.storage.local.set = window.cleanupOriginalSet; delete window.cleanupOriginalSet; document.querySelector('#dashboardAutoCleanupEnabled').click()`);
    await page.waitFor('document.querySelector("#dashboardAutoCleanupEnabled").checked && !document.querySelector("#dashboardAutoCleanupEnabled").disabled');
    assert.equal(await page.evaluate(`chrome.storage.local.get('dashboardAutoCleanupEnabled').then(value => value.dashboardAutoCleanupEnabled)`), true);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => [${fixtures.first}, ${fixtures.second}].every(id => tabs.some(tab => tab.id === id)))`), true);
    await screenshot(page, 'dashboard-auto-cleanup-light.png');

    let latest = await page.evaluate(`chrome.tabs.create({ url: 'chrome://newtab/', active: false }).then(tab => tab.id)`);
    created.push(latest);
    await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.id === ${latest} && tab.status === 'complete') && !tabs.some(tab => [${fixtures.first}, ${fixtures.second}].includes(tab.id)))`, 10000);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => [${current.id}, ${fixtures.web}, ${fixtures.tools}].every(id => tabs.some(tab => tab.id === id)))`), true);
    assert.equal(await page.evaluate(`document.querySelector('#tabOutDupeBanner').style.display`), 'none');

    // 连续两次真正停止后台；旧通用新标签不刷新，新窗口中新开的页面仍须关闭它。
    for (let cycle = 0; cycle < 2; cycle++) {
      const old = latest;
      const proof = await page.evaluate(`chrome.runtime.getContexts({contextTypes:['TAB']}).then(contexts => contexts.some(context => context.tabId === ${old} && context.frameId === 0 && context.documentUrl === ${JSON.stringify(`${extensionBase}/index.html`)}))`);
      assert.equal(proof, true);
      await stopDashboardWorker(page, extensionBase);
      latest = await page.evaluate(`chrome.windows.create({ url: 'chrome://newtab/', focused: false }).then(window => window.tabs[0].id)`);
      created.push(latest);
      await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.id === ${latest} && tab.status === 'complete') && !tabs.some(tab => tab.id === ${old}))`, 10000);
      assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => [${current.id}, ${fixtures.web}, ${fixtures.tools}].every(id => tabs.some(tab => tab.id === id)))`), true);
    }

    // 重载较老的固定控制页，只验证持久设置，不能反过来删除最新页。
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("#dashboardAutoCleanupEnabled")?.checked && _initialRenderDone');
    await openSettings(page);
    const concurrent = await page.evaluate(`(async () => {
      const first = await chrome.tabs.create({ url: ${JSON.stringify(`${extensionBase}/index.html?cleanup=race-one`)}, active: false });
      const second = await chrome.tabs.create({ url: ${JSON.stringify(`${extensionBase}/index.html?cleanup=race-two`)}, active: false });
      return [first.id, second.id];
    })()`);
    created.push(...concurrent);
    await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.id === ${concurrent[1]} && tab.status === 'complete') && !tabs.some(tab => [${concurrent[0]}, ${latest}].includes(tab.id)))`, 10000);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.id === ${current.id} && tab.pinned))`), true);

    await page.evaluate(`document.querySelector('[data-language="zh"]').click(); document.querySelector('[data-theme-name="midnight"]').click()`);
    assert.match(await page.evaluate(`document.querySelector('[data-i18n="dashboardAutoCleanupLabel"]').textContent`), /自动合并/);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    const layout = await page.evaluate(`(() => { const rect = document.querySelector('#privacySettings').getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert.ok(layout.left >= 0 && layout.right <= 390 && layout.bottom <= 844 && !layout.overflow, JSON.stringify(layout));
    await screenshot(page, 'dashboard-auto-cleanup-mobile-dark.png');
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`document.querySelector('[data-language="en"]').click(); document.querySelector('#dashboardAutoCleanupEnabled').click()`);
    await page.waitFor('!document.querySelector("#dashboardAutoCleanupEnabled").checked && !document.querySelector("#dashboardAutoCleanupEnabled").disabled');
    // 既有手动提示只统计规范仪表盘 URL，关闭模式按原行为验证。
    const extra = await page.evaluate(`chrome.tabs.create({ url: ${JSON.stringify(`${extensionBase}/index.html`)}, active: false }).then(tab => tab.id)`);
    created.push(extra);
    await page.waitFor(`chrome.tabs.query({}).then(tabs => [${extra}, ${concurrent[1]}].every(id => tabs.some(tab => tab.id === id && tab.status === 'complete')))`);
    await page.waitFor('document.querySelector("#tabOutDupeBanner").style.display !== "none"');
    assert.deepEqual(page.errors, []);
    console.log('Dashboard cleanup browser regression passed (toggle, write failure, persistence, cross-window, new-tab override, worker restart twice, concurrency, protected tabs, responsive settings).');
  } finally {
    await page.evaluate(`(() => { if (window.cleanupOriginalSet) { chrome.storage.local.set = window.cleanupOriginalSet; delete window.cleanupOriginalSet; } })()`);
    await page.evaluate(`chrome.storage.local.set({ dashboardAutoCleanupEnabled: false })`);
    await page.evaluate(`chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => ${JSON.stringify(created)}.includes(tab.id)).map(tab => chrome.tabs.remove(tab.id))))`);
    await page.evaluate(`chrome.tabs.update(${current.id}, { pinned: ${current.pinned} }); chrome.storage.local.remove('dashboardAutoCleanupEnabled')`);
  }
}

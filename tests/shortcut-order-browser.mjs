import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 用真实鼠标启动 Chromium 原生拖拽，再投放浏览器捕获的原始载荷。 */
async function nativeDrag(page, sourceSelector, targetSelector, position, accepted = true) {
  await page.send('Page.bringToFront');
  // 等待已有 300ms 标签事件防抖及入场动画结束，再获取真实鼠标坐标。
  await page.evaluate(`new Promise(resolve => setTimeout(resolve,450))`);
  await page.waitFor(`document.querySelector('.shortcut-library-grid').getAnimations({subtree:true}).every(animation=>animation.playState!=='running')`);
  const points = await page.evaluate(`(() => {
    const source = document.querySelector(${JSON.stringify(sourceSelector)});
    const target = document.querySelector(${JSON.stringify(targetSelector)});
    const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
    const horizontal = source.dataset.shortcutSort === 'group' && getComputedStyle(target.parentElement).gridTemplateColumns.split(' ').length > 1;
    return { source: {x:from.x+from.width/2,y:from.y+from.height/2}, target: horizontal
      ? {x:${position === 'before' ? 'to.left+5' : 'to.right-5'},y:to.y+to.height/2}
      : {x:to.x+to.width/2,y:${position === 'before' ? 'to.top+5' : 'to.bottom-5'}} };
  })()`);
  assert.equal(await page.evaluate(`document.elementFromPoint(${points.source.x},${points.source.y})?.closest('[data-shortcut-sort]') === document.querySelector(${JSON.stringify(sourceSelector)})`), true, 'Drag handle must be visible and hit-testable');
  let timeout;
  let receive;
  const captured = new Promise((resolve, reject) => {
    receive = resolve;
    timeout = setTimeout(() => reject(new Error('Native shortcut drag was not intercepted')), 6000);
  });
  page.on('Input.dragIntercepted', event => receive?.(event.data));
  try {
    await page.send('Input.setInterceptDrags', { enabled: true });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.source });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.source, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 8; step++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, button: 'left',
        x: points.source.x + (points.target.x - points.source.x) * step / 8,
        y: points.source.y + (points.target.y - points.source.y) * step / 8 });
    }
    const data = await captured;
    clearTimeout(timeout);
    assert.equal(data.items.some(item => item.mimeType === 'application/x-xiaoyu-shortcut-sort'), true);
    for (const type of ['dragEnter', 'dragOver']) await page.send('Input.dispatchDragEvent', { type, ...points.target, data });
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(targetSelector)}).dataset.shortcutDropPosition || ''`), accepted ? position : '');
    await page.send('Input.dispatchDragEvent', { type: 'drop', ...points.target, data });
  } catch (error) {
    const state = await page.evaluate(`({sorting:shortcutController.isSorting(), sourceConnected:Boolean(document.querySelector(${JSON.stringify(sourceSelector)})), activeTag:document.activeElement?.tagName})`);
    throw new Error(`${error.message}; drag state=${JSON.stringify(state)}`);
  } finally {
    receive = null;
    clearTimeout(timeout);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.target, button: 'left', clickCount: 1 });
    await page.send('Input.setInterceptDrags', { enabled: false });
  }
  await page.waitFor('!shortcutController.isSorting()');
}

/** 通过原生 Alt+方向键移动当前柄，验证实际键盘事件而非直接调用服务。 */
async function keyboardMove(page, selector, key) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const code = key === 'ArrowUp' ? 38 : 40;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers: 1 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers: 1 });
  await page.waitFor('!shortcutController.isSorting()');
}

/** 保存只含合成映射的布局截图。 */
async function screenshot(page, name) {
  if (!process.env.XIAOYU_QA_ARTIFACT_DIR) return;
  await page.waitFor(`document.querySelectorAll('.shortcut-library-item').length === 5 && getComputedStyle(document.querySelector('.shortcut-library-card')).opacity === '1' && document.querySelector('.shortcut-library-grid').getAnimations({subtree:true}).every(animation=>animation.playState!=='running')`);
  const directory = resolve(process.env.XIAOYU_QA_ARTIFACT_DIR);
  await mkdir(directory, { recursive: true });
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, name), Buffer.from(result.data, 'base64'));
}

/** 在独立 Chrome 配置验证两层排序、失败保护、实时刷新与无误开页面。 */
export async function testShortcutOrderingBrowser(page, extensionBase) {
  const saved = await page.evaluate(`(async () => ({ data: await chrome.storage.local.get(['keywordPageMappings', 'keywordGroupColors']),
    preferences: Object.fromEntries(['organizationView','tab-out-theme','tab-out-language'].map(key => [key,localStorage.getItem(key)])),
    tabs: (await chrome.tabs.query({})).length }))()`);
  const rows = [
    { id: 'a1', keyword: '看板', title: 'ARGALL 看板', url: 'https://example.test/a?b=2&a=1#exact', aliases: ['ag'] },
    { id: 'a2', keyword: '看板', title: 'BIOS 看板', url: 'https://example.test/a2', aliases: [] },
    { id: 'b1', keyword: 'tce', title: 'ARGALL 服务', url: 'https://example.test/b1', aliases: [] },
    { id: 'b2', keyword: 'tce', title: 'BIOS 服务', url: 'https://example.test/b2', aliases: [] },
    { id: 'c1', keyword: '代码库', title: 'ARGALL 代码库', url: 'https://example.test/c1', aliases: [] },
  ];
  const dataExpression = `chrome.storage.local.get('keywordPageMappings').then(data => data.keywordPageMappings)`;
  try {
    await page.evaluate(`chrome.storage.local.set({ keywordPageMappings: ${JSON.stringify(rows)}, keywordGroupColors: {'看板':'#DDEBE3',tce:'#E2EAF7','代码库':'#EEE5F5'} })`);
    await page.evaluate(`document.querySelector('[data-organization-view="shortcuts"]').click()`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-item").length === 5');
    await nativeDrag(page, '[data-shortcut-sort="group"][data-sort-id="代码库"]', '.shortcut-library-card[data-shortcut-group="看板"]', 'before');
    await page.waitFor(`document.querySelector('.shortcut-library-card').dataset.shortcutGroup === '代码库'`);
    assert.deepEqual((await page.evaluate(dataExpression)).map(row => row.id), ['c1','a1','a2','b1','b2']);
    await nativeDrag(page, '[data-shortcut-sort="page"][data-sort-id="a2"]', '.shortcut-library-item[data-shortcut-id="a1"]', 'before');
    await page.waitFor(`document.querySelector('.shortcut-library-card[data-shortcut-group="看板"] .shortcut-library-item').dataset.shortcutId === 'a2'`);
    const reordered = await page.evaluate(dataExpression);
    assert.deepEqual(reordered.map(row => row.id), ['c1','a2','a1','b1','b2']);
    for (const row of rows) assert.deepEqual(reordered.find(item => item.id === row.id), row);
    await nativeDrag(page, '[data-shortcut-sort="page"][data-sort-id="a2"]', '.shortcut-library-item[data-shortcut-id="b1"]', 'before', false);
    assert.deepEqual(await page.evaluate(dataExpression), reordered);

    await page.evaluate(`window.orderOriginalSet = SuperTabOutStorage.set; SuperTabOutStorage.set = async () => { throw new Error('test quota'); }`);
    await nativeDrag(page, '[data-shortcut-sort="group"][data-sort-id="代码库"]', '.shortcut-library-card[data-shortcut-group="tce"]', 'after');
    await page.waitFor('document.querySelector("#toastText").textContent.includes("Could not save the order")');
    assert.deepEqual(await page.evaluate(dataExpression), reordered);
    assert.equal(await page.evaluate(`document.querySelector('.shortcut-library-card').dataset.shortcutGroup`), '代码库');
    await page.evaluate(`SuperTabOutStorage.set = window.orderOriginalSet; delete window.orderOriginalSet`);

    await keyboardMove(page, '[data-shortcut-sort="page"][data-sort-id="a1"]', 'ArrowUp');
    await page.waitFor(`document.querySelector('.shortcut-library-card[data-shortcut-group="看板"] .shortcut-library-item').dataset.shortcutId === 'a1' && document.activeElement.dataset.sortId === 'a1'`);
    await keyboardMove(page, '[data-shortcut-sort="group"][data-sort-id="代码库"]', 'ArrowDown');
    await page.waitFor(`document.querySelector('.shortcut-library-card').dataset.shortcutGroup === '看板' && document.activeElement.dataset.sortId === '代码库'`);

    // 合成一次拖动，不投放；同时请求真实刷新并删除源项，验证 DOM 暂缓及旧源保护。
    await page.evaluate(`(() => { window.orderSource = document.querySelector('[data-shortcut-sort="page"][data-sort-id="a1"]');
      orderSource.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()})); scheduleRefresh(); })()`);
    await page.evaluate(`new Promise(resolve => setTimeout(resolve,450))`);
    assert.equal(await page.evaluate(`orderSource.isConnected && shortcutController.isSorting()`), true);
    const beforeRemoval = await page.evaluate(dataExpression);
    await page.evaluate(`chrome.storage.local.set({keywordPageMappings:${JSON.stringify(beforeRemoval.filter(row => row.id !== 'a1'))}})`);
    await page.evaluate(`(() => { const target = document.querySelector('.shortcut-library-item[data-shortcut-id="a2"]'); const rect = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer(),clientX:rect.x+10,clientY:rect.y+5})); })()`);
    await page.waitFor('!shortcutController.isSorting() && !document.querySelector(".shortcut-library-item[data-shortcut-id=a1]")');
    assert.deepEqual((await page.evaluate(dataExpression)).map(row => row.id), beforeRemoval.filter(row => row.id !== 'a1').map(row => row.id));
    await page.evaluate(`chrome.storage.local.set({keywordPageMappings:${JSON.stringify(beforeRemoval)}})`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-item").length === 5');

    const beforeCancel = await page.evaluate(dataExpression);
    await page.evaluate(`(() => { const source = document.querySelector('[data-shortcut-sort="group"]');
      source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}));
      source.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}));
      document.querySelector('.shortcut-library-card').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()})); })()`);
    assert.deepEqual(await page.evaluate(dataExpression), beforeCancel);
    assert.equal(await page.evaluate(`document.body.classList.contains('privacy-mode')`), false);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-item").length === 5');
    assert.deepEqual(await page.evaluate(dataExpression), beforeCancel);
    await page.evaluate(`document.querySelector('#keywordManageBtn').click()`);
    await page.waitFor('document.querySelectorAll(".keyword-mapping-row").length === 5');
    assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-mapping-row'),row=>row.dataset.mappingId)`), beforeCancel.map(row => row.id));
    await page.evaluate(`document.querySelector('#keywordManagerClose').click()`);
    await page.evaluate(`(() => { const input=document.querySelector('#keywordSearchInput');input.focus();input.value='ARGALL';input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await page.waitFor('document.querySelectorAll(".keyword-search-option").length === 3');
    assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.keyword-search-option'),option=>option.dataset.mappingId)`), beforeCancel.filter(row => row.title.includes('ARGALL')).map(row => row.id));
    await page.evaluate(`document.querySelector('#keywordSearchInput').blur()`);
    for (const theme of ['white','midnight']) {
      await page.evaluate(`document.querySelector('[data-theme-name="${theme}"]').click(); document.querySelector('[data-language="zh"]').click()`);
      for (const width of [1365,768,390]) {
        await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        assert.equal(await page.evaluate(`document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.shortcut-library-row')].some(row=>row.scrollWidth>row.clientWidth)`), false);
        assert.match(await page.evaluate(`document.querySelector('.shortcut-sort-handle').getAttribute('aria-label')`), /拖拽排序/);
        if (width !== 768) await screenshot(page,`shortcut-order-${theme}-${width}.png`);
      }
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`document.querySelector('[data-shortcut-sort="group"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()})); document.querySelector('[data-organization-view="domain"]').click()`);
    await page.waitFor('!shortcutController.isSorting()');
    assert.deepEqual(await page.evaluate(dataExpression), beforeCancel);
    await page.evaluate(`document.querySelector('[data-organization-view="shortcuts"]').click()`);
    await page.waitFor('document.querySelectorAll(".shortcut-library-item").length === 5');
    await page.evaluate(`document.querySelector('[data-shortcut-sort="group"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()})); document.body.classList.add('privacy-mode')`);
    await page.waitFor('!shortcutController.isSorting()');
    await page.evaluate(`document.body.classList.remove('privacy-mode'); document.querySelector('[data-organization-view="domain"]').click()`);
    assert.equal(await page.evaluate(`chrome.tabs.query({}).then(tabs=>tabs.length)`), saved.tabs);
    assert.deepEqual(page.errors, []);
    console.log('Shortcut ordering browser regression passed (native group/page drag, keyboard focus, persistence, no-op/cancel/cross-group/external/failed/stale-source protection, live refresh, privacy, themes, responsive layouts, no tab opening).');
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`(() => { if (window.orderOriginalSet) { SuperTabOutStorage.set=window.orderOriginalSet; delete window.orderOriginalSet; }
      shortcutController.cancelSort(); document.body.classList.remove('privacy-mode'); if(document.querySelector('#keywordManager').open)document.querySelector('#keywordManager').close(); })()`);
    await page.evaluate(`(async()=>{ const saved=${JSON.stringify(saved)};await chrome.storage.local.set(saved.data);
      for(const key of ['keywordPageMappings','keywordGroupColors'])if(!Object.hasOwn(saved.data,key))await chrome.storage.local.remove(key);
      for(const [key,value] of Object.entries(saved.preferences)){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);} })()`);
    await page.navigate(`${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("#keywordSearchInput") && _initialRenderDone');
  }
}

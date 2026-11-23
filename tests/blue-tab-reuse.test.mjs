import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 两个独立安装目录共用同一组行为测试；默认保持原来的 Blue 测试入口。
const variant = process.env.TAB_REUSE_VARIANT ?? 'blue';
assert.ok(['blue', 'xiaoyu'].includes(variant), 'TAB_REUSE_VARIANT must be blue or xiaoyu');
const { createController, ENABLED_KEY } = require(variant === 'xiaoyu'
  ? '../extension/services/tab-reuse.js'
  : '../variants/blue-tab-manager/services/tab-reuse.js');
const URL = 'https://example.test/report?a=1&b=2#summary';
const TRANSIT_URL = 'https://gateway.example.test/forward';

/** 创建可精确模拟两个普通窗口、标签变更和权限状态的测试环境。 */
function fixture({ enabled = true, permission = true } = {}) {
  const calls = [];
  const popupCalls = [];
  const session = {};
  const local = { [ENABLED_KEY]: enabled };
  const windows = new Map([
    [1, { id: 1, type: 'normal', focused: true }],
    [2, { id: 2, type: 'normal', focused: false }],
  ]);
  const source = { id: 10, windowId: 1, active: true, status: 'complete', url: 'chrome://newtab/' };
  const target = { id: 20, windowId: 2, active: false, status: 'complete', url: URL };
  const tabs = new Map([[source.id, source], [target.id, target]]);
  const state = { time: 1000, permission, notificationLevel: 'granted' };
  const api = {
    runtime: { getURL: path => `chrome-extension://blue/${path}` },
    i18n: { getMessage: key => key },
    storage: {
      local: { get: async key => ({ [key]: local[key] }) },
      session: {
        get: async key => ({ [key]: structuredClone(session[key]) }),
        set: async values => Object.assign(session, structuredClone(values)),
      },
    },
    permissions: { contains: async () => state.permission },
    notifications: {
      getPermissionLevel: async () => state.notificationLevel,
      create: async options => { calls.push([variant === 'blue' ? 'notify' : 'system-notification', options]); },
    },
    action: {
      setPopup: async options => { popupCalls.push(['set', options]); },
      openPopup: async options => { popupCalls.push(['open', options]); calls.push(['notify', options]); },
    },
    tabs: {
      query: async ({ windowType }) => {
        assert.equal(windowType, 'normal');
        return [...tabs.values()].filter(tab => windows.get(tab.windowId)?.type === windowType).map(tab => ({ ...tab }));
      },
      get: async id => {
        if (!tabs.has(id)) throw new Error('Missing tab');
        return { ...tabs.get(id) };
      },
      update: async (id, { active }) => {
        calls.push(['activate', id]);
        const tab = tabs.get(id);
        for (const other of tabs.values()) if (other.windowId === tab.windowId) other.active = false;
        tab.active = active;
      },
      remove: async id => { calls.push(['close', id]); tabs.delete(id); },
    },
    windows: {
      get: async id => ({ ...windows.get(id) }),
      update: async (id, options) => {
        calls.push(['focus', id, options]);
        for (const window of windows.values()) window.focused = window.id === id;
        if (options.state) windows.get(id).state = options.state;
      },
    },
  };
  const log = { warn() {}, info() {} };
  /** 模拟服务工作线程重新启动并复用同一会话存储。 */
  const controller = () => createController(api, { now: () => state.time, log });
  return { api, calls, popupCalls, session, local, windows, tabs, source, target, state, controller };
}

/** 发送第一次网页提交事件，模拟 Chrome 没有提前报告 pendingUrl。 */
function startLoading(run, source, url = URL) {
  Object.assign(source, { url, status: 'loading', pendingUrl: undefined });
  return run.onUpdated(source.id, { url, status: 'loading' }, { ...source });
}

test('从挂起 URL 匹配，切到已有窗口后只关闭新页，并通知一次', async () => {
  const f = fixture();
  const run = f.controller();
  await run.onCreated({ ...f.source, url: '', pendingUrl: 'chrome://newtab/' });
  assert.doesNotMatch(JSON.stringify(f.session), /https?:\/\//);
  const resumed = f.controller();
  f.windows.get(2).state = 'minimized';
  f.source.pendingUrl = URL;
  f.source.status = 'loading';
  await Promise.all([
    resumed.onUpdated(f.source.id, { status: 'loading' }, { ...f.source }),
    resumed.onUpdated(f.source.id, { status: 'loading' }, { ...f.source }),
  ]);
  assert.deepEqual(f.calls.map(([action]) => action), ['activate', 'focus', 'close', 'notify']);
  assert.deepEqual(f.calls[1], ['focus', 2, { state: 'normal', focused: true }]);
  assert.deepEqual(f.calls[2], ['close', f.source.id]);
  assert.equal(f.tabs.get(f.target.id).url, URL);
  assert.doesNotMatch(JSON.stringify(f.calls.at(-1)), /example\.test/);
});

test('有来源的前台链接仅在 Xiaoyu 复用，关闭新页并通知一次', async () => {
  const f = fixture();
  const run = f.controller();
  Object.assign(f.source, { url: '', openerTabId: 9 });
  await run.onCreated({ ...f.source });
  await startLoading(run, f.source);
  await startLoading(run, f.source);
  assert.deepEqual(f.calls.map(([action]) => action),
    variant === 'xiaoyu' ? ['activate', 'focus', 'close', 'notify'] : []);
  assert.equal(f.tabs.has(f.source.id), variant === 'blue');
  assert.equal(f.tabs.get(f.target.id).url, URL);
});

test('链接创建的后台、来源不明、已带地址或完整 URL 不同的新页不接管', async () => {
  for (const [createdTab, firstUrl] of [
    [{ openerTabId: 9, active: false }, URL],
    [{}, URL],
    [{ openerTabId: -1 }, URL],
    [{ openerTabId: 10 }, URL],
    [{ openerTabId: 9, pendingUrl: URL }, URL],
    [{ openerTabId: 9, url: URL, pendingUrl: URL }, URL],
    [{ openerTabId: 9 }, URL.replace('a=1', 'a=2')],
  ]) {
    const f = fixture();
    const run = f.controller();
    Object.assign(f.source, { url: '', ...createdTab });
    await run.onCreated({ ...f.source });
    await startLoading(run, f.source, firstUrl);
    assert.deepEqual(f.calls, [], JSON.stringify({ createdTab, firstUrl }));
  }
});

test('已有窗口带来源的外部直开链接仅在 Xiaoyu 复用', async () => {
  const f = fixture();
  const run = f.controller();
  f.tabs.set(9, { id: 9, windowId: 1, status: 'complete', url: 'https://opener.example.test/' });
  Object.assign(f.source, { url: '', pendingUrl: URL, status: 'loading', openerTabId: 9 });
  await run.onCreated({ ...f.source });
  assert.deepEqual(f.calls, []);
  await startLoading(run, f.source);
  assert.deepEqual(f.calls.map(([action]) => action),
    variant === 'xiaoyu' ? ['activate', 'focus', 'close', 'notify'] : []);
  assert.equal(f.tabs.has(f.source.id), variant === 'blue');
  assert.equal(f.tabs.has(f.target.id), true);
});

test('手动复制与来源不明确或属于新窗口的直开都不自动关闭', async () => {
  for (const scenario of ['duplicate', 'unknown', 'loading-opener', 'new-window', 'late-window-event']) {
    const f = fixture();
    const run = f.controller();
    f.tabs.set(9, {
      id: 9, windowId: 1, status: scenario === 'loading-opener' ? 'loading' : 'complete', url: URL,
    });
    Object.assign(f.source, {
      url: scenario === 'duplicate' ? URL : '', pendingUrl: URL, status: 'loading',
      openerTabId: scenario === 'unknown' ? undefined : 9,
    });
    if (scenario === 'new-window') run.onWindowCreated?.({ id: 1 });
    await run.onCreated({ ...f.source });
    if (scenario === 'late-window-event') run.onWindowCreated?.({ id: 1 });
    await startLoading(run, f.source);
    assert.deepEqual(f.calls, [], scenario);
    assert.equal(f.tabs.has(f.source.id), true, scenario);
    assert.equal(f.tabs.has(f.target.id), true, scenario);
  }
});

test('前台链接在同一次加载内经多次改址后只在 Xiaoyu 自动复用', async () => {
  const f = fixture();
  const run = f.controller();
  Object.assign(f.source, { url: '', openerTabId: 9 });
  await run.onCreated({ ...f.source });
  await startLoading(run, f.source, TRANSIT_URL);
  assert.deepEqual(f.calls, []);
  f.state.time += 400;
  await startLoading(run, f.source, URL.replace('a=1', 'a=2'));
  assert.deepEqual(f.calls, []);
  assert.doesNotMatch(JSON.stringify(f.session), /https?:\/\//);
  f.state.time += 311;
  // MV3 工作线程可被回收；会话只保留来源、标签和时间，不保存地址。
  const resumed = f.controller();
  await startLoading(resumed, f.source);
  await startLoading(resumed, f.source);
  assert.deepEqual(f.calls.map(([action]) => action),
    variant === 'xiaoyu' ? ['activate', 'focus', 'close', 'notify'] : []);
  assert.equal(f.tabs.has(f.source.id), variant === 'blue');
  assert.equal(f.tabs.get(f.target.id).url, URL);
});

test('首次加载结束、来源丢失、失焦、受保护或超时后改址不会复用', async () => {
  for (const reason of ['completed', 'opener', 'inactive', 'unfocused', 'pinned', 'timeout']) {
    const f = fixture();
    const run = f.controller();
    Object.assign(f.source, { url: '', openerTabId: 9 });
    await run.onCreated({ ...f.source });
    await startLoading(run, f.source, TRANSIT_URL);
    if (reason === 'completed') {
      f.source.status = 'complete';
      await run.onUpdated(f.source.id, { status: 'complete' }, { ...f.source });
    }
    if (reason === 'opener') delete f.source.openerTabId;
    if (reason === 'inactive') f.source.active = false;
    if (reason === 'unfocused') f.windows.get(1).focused = false;
    if (reason === 'pinned') f.source.pinned = true;
    if (reason === 'timeout') {
      f.state.time += 1200;
      await startLoading(run, f.source, URL.replace('a=1', 'a=2'));
      f.state.time += 800;
    }
    await startLoading(run, f.source);
    assert.deepEqual(f.calls, [], reason);
    assert.equal(f.tabs.has(f.source.id), true, reason);
  }
});

test('参数、顺序、片段和协议差异都不会切换或关闭；首个地址消耗资格', async () => {
  for (const url of [URL.replace('a=1', 'a=2'), URL.replace('a=1&b=2', 'b=2&a=1'), URL.replace('#summary', '#detail'), URL.replace('https:', 'http:')]) {
    const f = fixture();
    const run = f.controller();
    await run.onCreated({ ...f.source });
    await startLoading(run, f.source, url);
    await startLoading(run, f.source, URL);
    assert.deepEqual(f.calls, [], url);
  }
});

test('默认关闭、反馈不可用及启动重置时不关闭', async () => {
  for (const setup of [
    f => { delete f.local[ENABLED_KEY]; },
    f => { if (variant === 'blue') f.state.permission = false; else delete f.api.action.openPopup; },
    f => { if (variant === 'blue') f.state.notificationLevel = 'denied'; else delete f.api.action.setPopup; },
    async (_f, run) => run.reset(),
  ]) {
    const f = fixture();
    const run = f.controller();
    await run.onCreated({ ...f.source });
    await setup(f, run);
    await startLoading(run, f.source);
    assert.deepEqual(f.calls, []);
  }
});

test('Xiaoyu 用目标窗口工具栏弹层代替系统通知，即使弹层被拒绝也清除映射', { skip: variant !== 'xiaoyu' }, async () => {
  for (const rejected of [false, true]) {
    const f = fixture({ permission: false });
    const run = f.controller();
    const openPopup = f.api.action.openPopup;
    f.api.action.openPopup = async options => {
      assert.equal(f.tabs.has(f.source.id), false);
      if (rejected) {
        f.popupCalls.push(['open', options]);
        throw new Error('Popup unavailable');
      }
      return openPopup(options);
    };
    await run.onCreated({ ...f.source });
    await startLoading(run, f.source);
    assert.deepEqual(f.popupCalls, [
      ['set', { tabId: f.target.id, popup: 'tab-reuse-popup.html' }],
      ['open', { windowId: f.target.windowId }],
      ['set', { tabId: f.target.id, popup: '' }],
    ]);
    assert.equal(f.calls.some(([kind]) => kind === 'system-notification'), false);
    assert.equal(f.tabs.has(f.target.id), true);
  }
});

test('旧页、后台页、来源不明的直开页、恢复页、分组页和超时页不接管', async () => {
  for (const source of [null, { active: false }, { url: '', pendingUrl: URL }, { url: URL, pendingUrl: URL }, { groupId: 42 }, { pinned: true }, { incognito: true }, {}]) {
    const f = fixture();
    const run = f.controller();
    if (source) await run.onCreated({ ...f.source, ...source });
    if (source && !Object.keys(source).length) f.state.time += 120_000;
    await startLoading(run, f.source);
    assert.deepEqual(f.calls, [], JSON.stringify(source));
  }
});

test('聚焦失败、目标消失、源导航/移动/置顶及权限撤销时保留新页', async () => {
  for (const mutate of [
    f => { f.windows.get(2).focused = false; },
    f => { f.tabs.delete(f.target.id); },
    f => { f.target.url += '-elsewhere'; },
    f => { f.source.pendingUrl = 'https://example.test/other'; },
    f => { f.source.windowId = 2; },
    f => { f.source.pinned = true; },
    f => { if (variant === 'blue') f.state.permission = false; else delete f.api.action.openPopup; },
    f => { f.state.time += 2000; },
  ]) {
    const f = fixture();
    const run = f.controller();
    await run.onCreated({ ...f.source });
    const focus = f.api.windows.update;
    f.api.windows.update = async (...args) => { await focus(...args); mutate(f); };
    await startLoading(run, f.source);
    assert.deepEqual(f.calls.map(([action]) => action), ['activate', 'focus']);
    assert.equal(f.tabs.has(f.source.id), true);
  }
});

test('优先同窗口的精确目标，既有置顶标签与跨窗副本都保留', async () => {
  const f = fixture();
  const run = f.controller();
  f.tabs.set(30, { ...f.target, id: 30, windowId: 1, pinned: true });
  await run.onCreated({ ...f.source });
  await startLoading(run, f.source);
  assert.deepEqual(f.calls.map(([action, id]) => [action, action === 'notify' ? undefined : id]), [
    ['activate', 30], ['close', 10], ['notify', undefined],
  ]);
  assert.equal(f.tabs.get(30).pinned, true);
  assert.equal(f.tabs.has(20), true);
});

test('另一新标签即使先完成同网址加载，也不被选为已有目标', async () => {
  const f = fixture();
  const run = f.controller();
  const other = { ...f.source, id: 11 };
  f.tabs.set(other.id, other);
  await run.onCreated({ ...f.source });
  await run.onCreated({ ...other });
  Object.assign(other, { url: URL, status: 'complete', active: false });
  await startLoading(run, f.source);
  assert.deepEqual(f.calls.filter(([action]) => action === 'activate' || action === 'close'), [
    ['activate', f.target.id], ['close', f.source.id],
  ]);
  assert.equal(f.tabs.has(other.id), true);
});

test('会话资格无法写入时不执行聚焦或关闭', async () => {
  const f = fixture();
  const run = f.controller();
  await run.onCreated({ ...f.source });
  f.api.storage.session.set = async () => { throw new Error('Session storage unavailable'); };
  await startLoading(run, f.source);
  assert.deepEqual(f.calls, []);
});

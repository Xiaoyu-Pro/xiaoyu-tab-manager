/* Xiaoyu 仪表盘自动合并：单个后台协调关闭，默认不启用。 */
(function (global) {
  'use strict';
  const ENABLED_KEY = 'dashboardAutoCleanupEnabled';
  const SESSION_KEY = 'xiaoyuDashboardCleanupSession';
  const PLACEHOLDERS = new Set(['chrome://newtab/', 'chrome://new-tab-page/', 'edge://newtab/', 'brave://newtab/']);

  /** 创建后台协调器，会话仅保存标签 ID、创建顺序和仪表盘身份标记。 */
  function createController(api, { log = console } = {}) {
    const dashboardUrl = api.runtime.getURL('index.html');
    let pending = Promise.resolve();
    let generation = 0;

    /** 严格识别本扩展仪表盘文档，允许页面自身的查询参数或片段。 */
    function isDocument(url) {
      return typeof url === 'string' && (url === dashboardUrl || url.startsWith(`${dashboardUrl}?`) || url.startsWith(`${dashboardUrl}#`));
    }

    /** 串行执行并隔离失败，浏览器事件不会留下未处理的 Promise 拒绝。 */
    function enqueue(phase, operation) {
      pending = pending.then(operation).catch(error => {
        log.warn('[Xiaoyu dashboard cleanup] Operation failed', { phase,
          reason: error?.message === 'dashboardCleanupStateInvalid' ? 'invalid-session-state' : 'browser-or-storage-rejected' });
        return { ok: false, reason: 'operation-failed' };
      });
      return pending;
    }

    /** 缺少或无效的本地设置一律按关闭处理。 */
    async function enabled() {
      return (await api.storage.local.get(ENABLED_KEY))[ENABLED_KEY] === true;
    }

    /** 会话结构异常时停止自动关闭，不能用空状态覆盖已有顺序。 */
    async function load() {
      const value = (await api.storage.session.get(SESSION_KEY))[SESSION_KEY];
      if (value === undefined) return { version: 1, sequence: 0, tabs: {} };
      if (value?.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 0
        || !value.tabs || typeof value.tabs !== 'object' || Array.isArray(value.tabs)
        || Object.entries(value.tabs).some(([id, entry]) => !/^\d+$/.test(id)
          || !Number.isSafeInteger(entry?.order) || entry.order < 1 || entry.order > value.sequence
          || typeof entry.verified !== 'boolean')) throw new Error('dashboardCleanupStateInvalid');
      return value;
    }

    /** 身份和顺序先落地，写入失败禁止开始清理。 */
    async function save(state) { await api.storage.session.set({ [SESSION_KEY]: state }); }

    /** 只接受稳定且未置顶的本扩展仪表盘，不猜测通用新标签页的归属。 */
    function isDashboard(tab, state) {
      return Number.isInteger(tab?.id) && !tab.incognito && !tab.pinned
        && (!tab.pendingUrl || tab.pendingUrl === tab.url)
        && (isDocument(tab.url) || (PLACEHOLDERS.has(tab.url) && state.tabs[tab.id]?.verified === true));
    }

    /** 删除前核验当前窗口类型，排除隐身和弹出窗口。 */
    async function isNormal(tab) {
      const window = await api.windows.get(tab.windowId);
      return window.type === 'normal' && !window.incognito;
    }

    /** 记录创建顺序；可能的新仪表盘会立即中断上一轮删除。 */
    function onCreated(tab) {
      if (!Number.isInteger(tab?.id) || tab.incognito || tab.pinned) return Promise.resolve();
      generation++;
      return enqueue('created', async () => {
        if (!await enabled()) return;
        const state = await load();
        if (!state.tabs[tab.id]) state.tabs[tab.id] = { order: ++state.sequence, verified: false };
        await save(state);
      });
    }

    /** 导航开始时使旧文档证明失效，不复用另一个文档的身份。 */
    function onUpdated(id, changes) {
      if (changes.status !== 'loading' && !('url' in changes)) return Promise.resolve();
      generation++;
      return enqueue('navigated', async () => {
        const state = await load();
        if (!state.tabs[id]?.verified) return;
        state.tabs[id].verified = false;
        await save(state);
      });
    }

    /** 关闭后删除对应会话条目，不保存浏览器历史。 */
    function onRemoved(id) {
      return enqueue('removed', async () => {
        const state = await load();
        if (!state.tabs[id]) return;
        delete state.tabs[id];
        await save(state);
      });
    }

    /** 设置关闭时立即中断进行中的清理，不因为切换设置发起新一轮删除。 */
    function cancel() { generation++; }

    /** 核实保留页仍可安全识别，失效时停止而不是清空全部仪表盘。 */
    async function keeperExists(id, state) {
      try {
        const tab = await api.tabs.get(id);
        return isDashboard(tab, state) && await isNormal(tab);
      } catch { return false; }
    }

    /** 验证就绪页后集中保留最新创建页；较新页加载中或状态变化时暂缓删除。 */
    function onReady(sender) {
      if (sender?.id !== api.runtime.id || !isDocument(sender.url) || !Number.isInteger(sender.tab?.id)) {
        return Promise.resolve({ ok: false, reason: 'untrusted-sender' });
      }
      const revision = generation;
      return enqueue('ready', async () => {
        const state = await load();
        const current = await api.tabs.get(sender.tab.id);
        if (current.incognito || current.pinned || !await isNormal(current)
          || (!isDocument(current.url) && !PLACEHOLDERS.has(current.url))
          || (current.pendingUrl && current.pendingUrl !== current.url)) {
          return { ok: true, enabled: await enabled(), closed: 0, skipped: 'protected-or-changed-source' };
        }
        state.tabs[current.id] ||= { order: ++state.sequence, verified: false };
        state.tabs[current.id].verified = true;
        await save(state);
        if (!await enabled()) return { ok: true, enabled: false, closed: 0 };
        if (revision !== generation) return { ok: true, enabled: true, closed: 0, deferred: true };
        const candidates = (await api.tabs.query({ windowType: 'normal' })).filter(tab => isDashboard(tab, state));
        candidates.sort((a, b) => (state.tabs[b.id]?.order || 0) - (state.tabs[a.id]?.order || 0)
          || Number(b.id === current.id) - Number(a.id === current.id));
        const keeper = candidates[0];
        if (!keeper || !state.tabs[keeper.id]?.verified) return { ok: true, enabled: true, closed: 0, deferred: true };
        let closed = 0;
        let failed = 0;
        let deferred = false;
        for (const candidate of candidates) {
          if (candidate.id === keeper.id) continue;
          if (revision !== generation || !await enabled()) { deferred = true; break; }
          let fresh;
          try { fresh = await api.tabs.get(candidate.id); } catch { continue; }
          if (!isDashboard(fresh, state) || !await isNormal(fresh)) continue;
          if (revision !== generation || !await enabled()) { deferred = true; break; }
          if (!await keeperExists(keeper.id, state)) return { ok: false, enabled: true, closed, reason: 'keeper-changed' };
          if (revision !== generation) { deferred = true; break; }
          try { await api.tabs.remove(fresh.id); closed++; }
          catch {
            failed++;
            log.warn('[Xiaoyu dashboard cleanup] Tab kept after close failure', { tabId: fresh.id });
          }
        }
        log.info('[Xiaoyu dashboard cleanup] Finished', { keeperId: keeper.id, closed, failed, deferred });
        return { ok: failed === 0, enabled: true, closed, deferred };
      });
    }

    return { onCreated, onUpdated, onRemoved, onReady, cancel };
  }

  const exported = { ENABLED_KEY, SESSION_KEY, createController };
  global.XiaoyuDashboardCleanup = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(globalThis);

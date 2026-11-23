/* Xiaoyu Tab Manager：在可识别的新标签首次加载时复用已有网页。 */
(function (global) {
  'use strict';

  const ENABLED_KEY = 'xiaoyuExactTabReuseEnabled';
  const CANDIDATES_KEY = 'xiaoyuExactTabReuseCandidates';
  const NEW_TAB_TTL = 120_000;
  const ATTEMPT_TTL = 2_000;
  const NEW_WINDOW_GRACE = 2_000;

  /** 判断当前浏览器能否显示扩展工具栏弹层，不需要网站或系统通知权限。 */
  function canShowReusePopup(api) {
    return typeof api.action?.openPopup === 'function' && typeof api.action?.setPopup === 'function';
  }

  /** 识别可复用的网页协议，保留 Chrome 提供的完整 URL 字符串。 */
  function isWebUrl(url) {
    return typeof url === 'string' && /^https?:\/\//.test(url);
  }

  /** 只返回首个加载事件中的地址；不从旧页的普通加载状态推断导航。 */
  function getFirstWebUrl(tab, change, isPlaceholder) {
    if (tab.status !== 'loading') return '';
    if (isWebUrl(tab.pendingUrl) && (!tab.url || isPlaceholder(tab.url))) return tab.pendingUrl;
    return !tab.pendingUrl && change.url === tab.url && isWebUrl(tab.url) ? tab.url : '';
  }

  /** 判断新标签是否仍可关闭，置顶和已分组的标签始终受保护。 */
  function isUnprotected(tab) {
    return !!tab && !tab.incognito && !tab.pinned && !tab.discarded && (tab.groupId ?? -1) === -1;
  }

  /** 仅比较完整 URL，并排除挂起其它导航、已卸载或尚未稳定的目标。 */
  function isExactTarget(tab, url) {
    return !!tab && Number.isInteger(tab.id) && !tab.incognito && !tab.discarded
      && tab.status === 'complete' && tab.url === url && (!tab.pendingUrl || tab.pendingUrl === url);
  }

  /** 优先同一窗口，再选最近活跃页；tabId 提供稳定的最后排序。 */
  function selectTarget(tabs, source, url, candidates) {
    return tabs.filter(tab => tab.id !== source.id && !candidates.has(tab.id) && isExactTarget(tab, url))
      .sort((a, b) => Number(b.windowId === source.windowId) - Number(a.windowId === source.windowId)
        || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.id - b.id)[0];
  }

  /** 创建单个后台协调器；事件串行处理，短期资格在工作线程休眠后仍可读取。 */
  function createController(api, { now = Date.now, log = console } = {}) {
    let candidates;
    const windowOpenedAt = new Map();
    let queue = Promise.resolve();
    let attempt;
    let revision = 0;
    const newTabUrl = api.runtime.getURL('index.html');
    const placeholders = new Set(['about:blank', 'chrome://newtab/', 'chrome://new-tab-page/', 'edge://newtab/', newTabUrl]);

    /** 识别空白或明确的新标签页地址；空地址本身不是来源证据。 */
    function isPlaceholder(url) {
      return placeholders.has(url);
    }

    /** 让同一 worker 的候选写入与切换操作按事件顺序执行。 */
    function enqueue(task) {
      queue = queue.then(task).catch(() => log.warn('[Xiaoyu tab reuse] event failed'));
      return queue;
    }

    /** 读取开关；缺失、损坏或未明确开启均按关闭处理。 */
    async function enabled() {
      return (await api.storage.local.get(ENABLED_KEY))[ENABLED_KEY] === true;
    }

    /** 淘汰过期创建或改址资格；会话存储只保留 ID 和时间，不保存网址。 */
    async function loadCandidates() {
      if (!candidates) {
        const stored = (await api.storage.session.get(CANDIDATES_KEY))[CANDIDATES_KEY];
        candidates = new Map(Object.entries(stored || {}).map(([id, entry]) => [Number(id), entry]));
      }
      for (const [id, entry] of candidates) {
        if (!(now() - entry?.createdAt < NEW_TAB_TTL)
            || (entry.firstLoadAt !== undefined && now() - entry.firstLoadAt >= ATTEMPT_TTL)) candidates.delete(id);
      }
      return candidates;
    }

    /** 先落地资格变化，写入失败时禁止继续执行本次关闭。 */
    async function saveCandidates() {
      await api.storage.session.set({ [CANDIDATES_KEY]: Object.fromEntries(candidates) });
    }

    /** 标记正在建立的窗口，防止批量恢复中带来源的新页被当作外部链接。 */
    function onWindowCreated(window) {
      if (!Number.isInteger(window.id)) return;
      windowOpenedAt.set(window.id, now());
      if (attempt?.directOpen && attempt.windowId === window.id) attempt.cancelled = true;
    }

    /** 窗口关闭后清理它的创建时间。 */
    function onWindowRemoved(windowId) {
      windowOpenedAt.delete(windowId);
    }

    /** 按标签创建时刻判断窗口是否还在初始化，而非按异步检查时刻。 */
    function isOpeningWindow(windowId, createdAt) {
      return createdAt - (windowOpenedAt.get(windowId) ?? -Infinity) < NEW_WINDOW_GRACE;
    }

    /** 记录从明确占位页或有明确来源的新链接创建的前台标签。 */
    function onCreated(tab) {
      const createdAt = now();
      const eventRevision = revision;
      if (!Number.isInteger(tab.id) || !tab.active || !isUnprotected(tab)) return;
      const startsAtPlaceholder = (isPlaceholder(tab.url) || isPlaceholder(tab.pendingUrl))
        && (!tab.url || isPlaceholder(tab.url)) && (!tab.pendingUrl || isPlaceholder(tab.pendingUrl));
      // 「复制标签页」创建时已有已提交地址，不能走链接路径。
      const startsFromLink = !tab.url && (!tab.pendingUrl || isWebUrl(tab.pendingUrl)) && Number.isInteger(tab.openerTabId)
        && tab.openerTabId >= 0 && tab.openerTabId !== tab.id;
      if (!startsAtPlaceholder && !startsFromLink) return;
      const directOpen = startsFromLink && isWebUrl(tab.pendingUrl);
      return enqueue(async () => {
        if (!await enabled() || revision !== eventRevision || now() - createdAt >= NEW_TAB_TTL) return;
        const window = await api.windows.get(tab.windowId);
        if (window.type !== 'normal' || window.incognito || !window.focused) return;
        if (directOpen) {
          if (isOpeningWindow(tab.windowId, createdAt)) return;
          const opener = await api.tabs.get(tab.openerTabId);
          if (!opener?.url || opener.windowId !== tab.windowId || !isExactTarget(opener, opener.url)) return;
        }
        await loadCandidates();
        candidates.set(tab.id, {
          windowId: tab.windowId, createdAt, ...(startsFromLink ? { openerTabId: tab.openerTabId } : {}),
          ...(directOpen ? { directOpen } : {}),
        });
        await saveCandidates();
      });
    }

    /** 判断源标签是否仍是同一次初始导航，而非另一个页面或受保护标签。 */
    function sourceMatches(tab, source, url) {
      return isUnprotected(tab) && tab.windowId === source.windowId && (tab.pendingUrl || tab.url) === url
        && (!tab.url || isPlaceholder(tab.url) || tab.url === url);
    }

    /** 检查期限、取消信号、开关和浏览器反馈能力；关页前需再次调用。 */
    async function allowed(run) {
      return !run.cancelled && now() - run.startedAt < ATTEMPT_TTL
        && await enabled() && canShowReusePopup(api)
        && !run.cancelled && now() - run.startedAt < ATTEMPT_TTL;
    }

    /** 只在目标窗口短暂打开提示，随后恢复该标签的原工具栏点击入口。 */
    async function showReusePopup(target) {
      await api.action.setPopup({ tabId: target.id, popup: 'tab-reuse-popup.html' });
      try {
        await api.action.openPopup({ windowId: target.windowId });
      } finally {
        // Chrome 已打开的弹层不受映射清除影响，页面会自行关闭。
        await api.action.setPopup({ tabId: target.id, popup: '' });
      }
    }

    /** 聚焦并复核后关闭源标签；仅未找到目标时允许继续观察本次加载。 */
    async function reuseTab(source, run) {
      let phase = 'match';
      let outcome = 'skipped';
      const { url, startedAt } = run;
      try {
        if (!await allowed(run)) return;
        const target = selectTarget(await api.tabs.query({ windowType: 'normal' }), source, url, candidates);
        if (!target) {
          outcome = 'no-target';
          return outcome;
        }
        log.info('[Xiaoyu tab reuse] match', { sourceId: source.id, targetId: target.id });
        phase = 'activate';
        const [currentSource, currentTarget, sourceWindow, targetWindow] = await Promise.all([
          api.tabs.get(source.id), api.tabs.get(target.id),
          api.windows.get(source.windowId), api.windows.get(target.windowId),
        ]);
        if (!currentSource.active || !sourceWindow.focused || sourceWindow.type !== 'normal' || sourceWindow.incognito
            || (run.openerTabId !== undefined && currentSource.openerTabId !== run.openerTabId)
            || !sourceMatches(currentSource, source, url) || !isExactTarget(currentTarget, url)
            || currentTarget.windowId !== target.windowId || targetWindow.type !== 'normal' || targetWindow.incognito
            || !await allowed(run)) return;
        await api.tabs.update(target.id, { active: true });
        if (!targetWindow.focused) {
          await api.windows.update(target.windowId, targetWindow.state === 'minimized'
            ? { state: 'normal', focused: true } : { focused: true });
        }
        phase = 'verify';
        if (!await allowed(run)) return;
        const [finalSource, finalTarget, focusedWindow] = await Promise.all([
          api.tabs.get(source.id), api.tabs.get(target.id), api.windows.get(target.windowId),
        ]);
        if (run.cancelled || now() - startedAt >= ATTEMPT_TTL || !sourceMatches(finalSource, source, url)
            || !isExactTarget(finalTarget, url) || finalTarget.windowId !== target.windowId || !finalTarget.active
            || !focusedWindow.focused || focusedWindow.type !== 'normal' || focusedWindow.incognito) return;
        phase = 'close';
        await api.tabs.remove(source.id);
        outcome = 'closed';
        phase = 'popup';
        await showReusePopup(finalTarget);
        outcome = 'closed-popup';
      } catch {
        // Chrome 异常文本可能含网址，因此只记录失败阶段和安全诊断信息。
        log.warn('[Xiaoyu tab reuse] failed', { sourceId: source.id, phase });
      } finally {
        log.info('[Xiaoyu tab reuse] result', { sourceId: source.id, phase, outcome, elapsedMs: now() - startedAt });
      }
    }

    /** 首次加载未命中时，仅在短窗口内跟进同一前台链接新页的已提交改址。 */
    function onUpdated(tabId, change, tab) {
      if (attempt?.id === tabId) {
        if (!sourceMatches(tab, attempt, attempt.url) || (attempt.completed && change.status === 'loading')) attempt.cancelled = true;
        if (change.status === 'complete') attempt.completed = true;
      }
      if (!('url' in change) && !('status' in change) && !('pinned' in change) && !('groupId' in change)) return;
      const startedAt = now();
      const eventRevision = revision;
      return enqueue(async () => {
        await loadCandidates();
        const candidate = candidates.get(tabId);
        if (!candidate) return;
        const address = tab.pendingUrl || tab.url;
        const following = candidate.firstLoadAt !== undefined;
        const sameOpener = candidate.openerTabId !== undefined && tab.openerTabId === candidate.openerTabId;
        const unsafe = !isUnprotected(tab) || candidate.windowId !== tab.windowId
          || (candidate.directOpen && (!sameOpener || isOpeningWindow(tab.windowId, candidate.createdAt)))
          || (following && (!sameOpener || !tab.active || tab.status !== 'loading' || !isWebUrl(tab.url)));
        if (!unsafe && (following ? !('url' in change) : !address || isPlaceholder(address))) return;
        candidates.delete(tabId);
        const url = following
          ? (change.url === tab.url && address === tab.url ? tab.url : '')
          : getFirstWebUrl(tab, change, isPlaceholder);
        if (!url || unsafe || !tab.active || revision !== eventRevision) {
          await saveCandidates();
          return;
        }
        const firstLoadAt = candidate.firstLoadAt ?? startedAt;
        // 沿用首个地址的期限，多次改址也不重新计时。
        attempt = {
          id: tabId, windowId: tab.windowId, url, startedAt: firstLoadAt,
          directOpen: candidate.directOpen, openerTabId: following || candidate.directOpen ? candidate.openerTabId : undefined,
          cancelled: false, completed: false,
        };
        try {
          await saveCandidates();
          if (await reuseTab(tab, attempt) === 'no-target' && sameOpener
              && revision === eventRevision && now() - firstLoadAt < ATTEMPT_TTL) {
            candidates.set(tabId, { ...candidate, firstLoadAt });
            await saveCandidates();
          }
        } finally {
          attempt = undefined;
        }
      });
    }

    /** 被关闭、跨窗移动或替换时撤销对应标签的处理资格。 */
    function forgetTab(tabId) {
      if (attempt?.id === tabId) attempt.cancelled = true;
      return enqueue(async () => {
        await loadCandidates();
        if (candidates.delete(tabId)) await saveCandidates();
      });
    }

    /** 配置失效时立即取消在途操作，并使之前的所有候选失效。 */
    function reset() {
      revision++;
      if (attempt) attempt.cancelled = true;
      return enqueue(async () => {
        candidates = new Map();
        await saveCandidates();
      });
    }

    return { onWindowCreated, onWindowRemoved, onCreated, onUpdated, forgetTab, reset };
  }

  const api = { ENABLED_KEY, canShowReusePopup, createController };
  global.XiaoyuTabReuse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

/* Xiaoyu Tab Manager tabs service; derived from Super Tab Out and modified by Xiaoyu-Pro.
   Isolates chrome.tabs/chrome.windows/tabGroups calls and pure tab rules. */
(function (global) {
  'use strict';

  const BROWSER_NEWTAB_URLS = [
    'chrome://newtab/',
    'edge://newtab/',
    'brave://newtab/',
    'about:newtab',
  ];
  const DASHBOARD_CLEANUP_KEY = 'dashboardAutoCleanupEnabled';

  const CHROME_GROUP_COLORS = new Set([
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
  ]);

  function getChromeApi() {
    return global.chrome || null;
  }

  function extensionNewTabUrl(extensionId) {
    return extensionId ? `chrome-extension://${extensionId}/index.html` : '';
  }

  function isBrowserNewTabUrl(url) {
    return BROWSER_NEWTAB_URLS.includes(url || '');
  }

  function isExtensionPageUrl(url, extensionId) {
    if (!url || !extensionId) return false;
    return url.startsWith(`chrome-extension://${extensionId}/`);
  }

  function isInternalUrl(url, extensionId) {
    if (!url) return true;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:') ||
      url.startsWith('edge://') ||
      url.startsWith('brave://') ||
      isExtensionPageUrl(url, extensionId)
    );
  }

  function isRealTab(tab, extensionId) {
    return !!tab && tab.pinned !== true && !isInternalUrl(tab.url || '', extensionId);
  }

  function normalizeRestorableUrl(url) {
    if (global.SuperTabOutUrls?.normalizeRestorableUrl) {
      return global.SuperTabOutUrls.normalizeRestorableUrl(url);
    }
    return '';
  }

  /**
   * 只保留能安全用于图片 src 的标签页 favicon，避免页面提供的危险协议进入扩展 DOM。
   */
  function normalizeTabFaviconUrl(favIconUrl) {
    if (typeof favIconUrl !== 'string') return '';
    const candidate = favIconUrl.trim();
    if (!candidate) return '';
    if (/^data:image\/[a-z0-9.+-]+(?:[;,])/i.test(candidate)) return candidate;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function normalizeTab(tab, extensionId) {
    const url = tab.url || '';
    const newtabUrl = extensionNewTabUrl(extensionId);
    return {
      id: tab.id,
      url,
      title: tab.title,
      favIconUrl: normalizeTabFaviconUrl(tab.favIconUrl),
      windowId: tab.windowId,
      active: tab.active,
      pinned: tab.pinned,
      incognito: tab.incognito === true,
      groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
      index: tab.index,
      isTabOut: url === newtabUrl || isBrowserNewTabUrl(url),
    };
  }

  async function fetchOpenTabs() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs) return [];
    const extensionId = chromeApi.runtime?.id || '';
    const tabs = await chromeApi.tabs.query({});
    return tabs.map(tab => normalizeTab(tab, extensionId));
  }

  async function fetchTabGroups() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabGroups) return [];
    try {
      return await chromeApi.tabGroups.query({});
    } catch {
      return [];
    }
  }

  /** 查询当前 profile 的非隐身普通窗口，并保留每个真实标签实例。 */
  async function fetchNormalWindows() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.windows) return [];
    const extensionId = chromeApi.runtime?.id || '';
    const windows = await chromeApi.windows.getAll({ populate: true, windowTypes: ['normal'] });
    return (windows || [])
      .filter(windowInfo => windowInfo?.type === 'normal' && windowInfo.incognito !== true)
      .map(windowInfo => ({
        id: windowInfo.id,
        type: windowInfo.type,
        focused: windowInfo.focused === true,
        incognito: false,
        tabs: (windowInfo.tabs || []).map(tab => ({
          ...normalizeTab(tab, extensionId),
          windowType: windowInfo.type,
          incognito: false,
        })),
      }));
  }

  /** 重新查询一组标签及来源窗口类型；关闭中的标签会被跳过而不是让整批操作失败。 */
  async function getTabsByIds(tabIds) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs?.get || !Array.isArray(tabIds)) return [];
    const tabs = await Promise.all(tabIds.filter(Number.isFinite).map(async tabId => {
      try {
        return await chromeApi.tabs.get(tabId);
      } catch {
        return null;
      }
    }));
    const existingTabs = tabs.filter(Boolean);
    const windowInfoById = new Map();
    if (chromeApi.windows?.get) {
      await Promise.all([...new Set(existingTabs.map(tab => tab.windowId).filter(Number.isFinite))].map(async windowId => {
        try {
          windowInfoById.set(windowId, await chromeApi.windows.get(windowId));
        } catch {}
      }));
    }
    const extensionId = chromeApi.runtime?.id || '';
    const resolvesWindowTypes = typeof chromeApi.windows?.get === 'function';
    return existingTabs.map(tab => {
      const normalized = normalizeTab(tab, extensionId);
      const windowInfo = windowInfoById.get(tab.windowId);
      return {
        ...normalized,
        ...(resolvesWindowTypes ? { windowType: windowInfo?.type || 'unknown' } : {}),
        incognito: normalized.incognito || windowInfo?.incognito === true,
      };
    });
  }

  /** 将一组标签移动到目标普通窗口，默认追加到窗口末尾。 */
  async function moveTabs(tabIds, windowId, index = -1) {
    const chromeApi = getChromeApi();
    const validIds = (Array.isArray(tabIds) ? tabIds : []).filter(Number.isFinite);
    if (!chromeApi?.tabs?.move || validIds.length === 0 || !Number.isFinite(windowId)) return [];
    return await chromeApi.tabs.move(validIds, { windowId, index });
  }

  /** 以一个现有标签创建普通窗口，避免复制 URL 或额外刷新页面。 */
  async function createWindowFromTab(tabId) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.windows?.create || !Number.isFinite(tabId)) return null;
    return await chromeApi.windows.create({ tabId, type: 'normal', focused: false });
  }

  /** 整体移动一个纯净原生标签组；混合组由规划器拆成 tab 移动。 */
  async function moveTabGroup(groupId, windowId, index = -1) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabGroups?.move || !Number.isFinite(groupId) || groupId < 0 || !Number.isFinite(windowId)) return null;
    return await chromeApi.tabGroups.move(groupId, { windowId, index });
  }

  /** 聚焦一个仍存在的目标窗口。 */
  async function focusWindow(windowId) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.windows?.update || !Number.isFinite(windowId)) return null;
    return await chromeApi.windows.update(windowId, { focused: true });
  }

  function exactUnpinnedIdsForUrls(tabs, urls) {
    const urlSet = new Set(urls || []);
    return (tabs || [])
      .filter(tab => !tab.pinned && urlSet.has(tab.url))
      .map(tab => tab.id);
  }

  async function closeTabsByUrls(urls) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !urls || urls.length === 0) return [];
    const tabs = await chromeApi.tabs.query({});
    const toClose = exactUnpinnedIdsForUrls(tabs, urls);
    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function closeTabsByIds(ids) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !ids || ids.length === 0) return [];
    const idSet = new Set(ids);
    const tabs = await chromeApi.tabs.query({});
    const toClose = tabs
      .filter(tab => idSet.has(tab.id) && !tab.pinned)
      .map(tab => tab.id);
    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function focusTab(url) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.windows || !url) return null;
    const allTabs = await chromeApi.tabs.query({});
    const currentWindow = await chromeApi.windows.getCurrent();

    let matches = allTabs.filter(tab => tab.url === url);
    if (matches.length === 0) {
      try {
        const targetHost = new URL(url).hostname;
        matches = allTabs.filter(tab => {
          try { return new URL(tab.url).hostname === targetHost; }
          catch { return false; }
        });
      } catch {}
    }

    if (matches.length === 0) return null;

    const match = matches.find(tab => tab.windowId !== currentWindow.id) || matches[0];
    await chromeApi.tabs.update(match.id, { active: true });
    await chromeApi.windows.update(match.windowId, { focused: true });
    return match;
  }

  async function closeDuplicateTabs(urls, keepOne = true) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs) return [];
    const allTabs = await chromeApi.tabs.query({});
    const toClose = [];

    for (const url of urls || []) {
      const matching = allTabs.filter(tab => tab.url === url && !tab.pinned);
      if (keepOne) {
        const keep = matching.find(tab => tab.active) || matching[0];
        for (const tab of matching) {
          if (keep && tab.id !== keep.id) toClose.push(tab.id);
        }
      } else {
        for (const tab of matching) {
          toClose.push(tab.id);
        }
      }
    }

    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function closeTabOutDupes() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.windows) return [];
    const extensionId = chromeApi.runtime?.id || '';
    const newtabUrl = extensionNewTabUrl(extensionId);
    const allTabs = await chromeApi.tabs.query({});
    const currentWindow = await chromeApi.windows.getCurrent();
    const tabOutTabs = allTabs.filter(tab =>
      tab.url === newtabUrl || isBrowserNewTabUrl(tab.url)
    );

    if (tabOutTabs.length <= 1) return [];

    const keep =
      tabOutTabs.find(tab => tab.active && tab.windowId === currentWindow.id) ||
      tabOutTabs.find(tab => tab.active) ||
      tabOutTabs[0];
    const toClose = tabOutTabs.filter(tab => tab.id !== keep.id).map(tab => tab.id);
    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  /** 后台串行合并仪表盘；临时顺序和身份只保存在当前 worker 内。 */
  function createDashboardCleanupController(chromeApi, { log = console } = {}) {
    const dashboardUrl = chromeApi.runtime.getURL('index.html');
    const tabs = new Map();
    let sequence = 0;
    let generation = 0;
    let pending = Promise.resolve();

    /** 只识别本扩展的仪表盘入口，允许其查询参数和片段。 */
    function isDocument(url) {
      return typeof url === 'string' && (url === dashboardUrl || url.startsWith(`${dashboardUrl}?`) || url.startsWith(`${dashboardUrl}#`));
    }

    /** 通用新标签地址必须有页面就绪证明，挂起其他导航的页不参与。 */
    function isDashboard(tab) {
      return Number.isInteger(tab?.id) && !tab.incognito && !tab.pinned
        && (!tab.pendingUrl || tab.pendingUrl === tab.url)
        && (isDocument(tab.url) || ((isBrowserNewTabUrl(tab.url) || tab.url === 'chrome://new-tab-page/') && tabs.get(tab.id)?.verified));
    }

    /** 只读取严格开启的本地设置，不修改设置或会话存储。 */
    async function enabled() {
      return (await chromeApi.storage.local.get(DASHBOARD_CLEANUP_KEY))[DASHBOARD_CLEANUP_KEY] === true;
    }

    /** 删除前重新核验窗口类型，排除隐身与弹出窗口。 */
    async function isNormal(tab) {
      const window = await chromeApi.windows.get(tab.windowId);
      return window.type === 'normal' && !window.incognito;
    }

    /** 同步记录创建顺序，并中断旧清理轮次以保护新页。 */
    function onCreated(tab) {
      if (!Number.isInteger(tab?.id) || tab.incognito || tab.pinned) return;
      generation++;
      tabs.set(tab.id, { order: ++sequence, verified: false });
    }

    /** 导航时立即失效旧文档证明，不将刷新当作新建。 */
    function onUpdated(id, changes) {
      if (changes.status !== 'loading' && !('url' in changes)) return;
      generation++;
      if (tabs.has(id)) tabs.get(id).verified = false;
    }

    /** 删除已关闭标签的临时记录。 */
    function onRemoved(id) { tabs.delete(id); }

    /** 设置变化只中断清理，不立即发起关闭。 */
    function cancel() { generation++; }

    /** 保留页消失、导航或受保护时终止，不能清空全部仪表盘。 */
    async function keeperExists(id) {
      try {
        const tab = await chromeApi.tabs.get(id);
        return isDashboard(tab) && await isNormal(tab);
      } catch { return false; }
    }

    /** 验证就绪页，再逐个关闭旧仪表盘；后台重启后以本次确认的页面为起点。 */
    async function cleanup(sender, revision) {
      const current = await chromeApi.tabs.get(sender.tab.id);
      const configured = await enabled();
      if (revision !== generation) return { ok: true, enabled: configured, closed: 0, deferred: true };
      if (current.pinned || current.incognito || !await isNormal(current)
        || (!isDocument(current.url) && !isBrowserNewTabUrl(current.url) && current.url !== 'chrome://new-tab-page/')
        || (current.pendingUrl && current.pendingUrl !== current.url)) return { ok: true, enabled: configured, closed: 0 };
      if (revision !== generation) return { ok: true, enabled: configured, closed: 0, deferred: true };
      if (!tabs.has(current.id)) tabs.set(current.id, { order: ++sequence });
      tabs.get(current.id).verified = true;
      if (!configured) return { ok: true, enabled: false, closed: 0 };
      const candidates = (await chromeApi.tabs.query({ windowType: 'normal' })).filter(isDashboard);
      candidates.sort((a, b) => (tabs.get(b.id)?.order || 0) - (tabs.get(a.id)?.order || 0));
      const keeper = candidates[0];
      if (!keeper || !tabs.get(keeper.id)?.verified) return { ok: true, enabled: true, closed: 0, deferred: true };
      let closed = 0;
      let failed = 0;
      for (const candidate of candidates) {
        if (candidate.id === keeper.id) continue;
        let fresh;
        try { fresh = await chromeApi.tabs.get(candidate.id); } catch { continue; }
        if (!isDashboard(fresh) || !await isNormal(fresh)) continue;
        if (!await keeperExists(keeper.id)) return { ok: false, enabled: true, closed, reason: 'keeper-changed' };
        if (revision !== generation || !await enabled() || revision !== generation) break;
        try { await chromeApi.tabs.remove(fresh.id); closed++; }
        catch { failed++; log.warn('[Xiaoyu dashboard cleanup] Tab kept after close failure', { tabId: fresh.id }); }
      }
      log.info('[Xiaoyu dashboard cleanup] Finished', { keeperId: keeper.id, closed, failed });
      return { ok: failed === 0, enabled: true, closed };
    }

    /** 只接受本扩展仪表盘消息，并隔离失败以便后续请求继续处理。 */
    function onReady(sender) {
      if (sender?.id !== chromeApi.runtime.id || !isDocument(sender.url) || !Number.isInteger(sender.tab?.id)) {
        return Promise.resolve({ ok: false, reason: 'untrusted-sender' });
      }
      const revision = generation;
      pending = pending.then(() => cleanup(sender, revision)).catch(() => {
        log.warn('[Xiaoyu dashboard cleanup] Browser or storage operation failed');
        return { ok: false, reason: 'operation-failed' };
      });
      return pending;
    }
    return { onCreated, onUpdated, onRemoved, onReady, cancel };
  }

  async function groupTabs(tabIds, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.tabGroups || !tabIds?.length) return null;
    const groupRequest = { tabIds };
    if (Number.isFinite(options.groupId) && options.groupId >= 0) groupRequest.groupId = options.groupId;
    const groupId = await chromeApi.tabs.group(groupRequest);
    await chromeApi.tabGroups.update(groupId, {
      ...(options.title ? { title: options.title } : {}),
      ...(options.color ? { color: options.color } : {}),
      ...(typeof options.collapsed === 'boolean' ? { collapsed: options.collapsed } : {}),
    });
    return groupId;
  }

  async function updateGroup(groupId, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabGroups || !Number.isFinite(groupId)) return null;
    return await chromeApi.tabGroups.update(groupId, options);
  }

  async function ungroupTabs(tabIds) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !tabIds?.length) return;
    await chromeApi.tabs.ungroup(tabIds);
  }

  async function getRecentlyClosed(maxResults = 10) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.sessions) return [];
    return await chromeApi.sessions.getRecentlyClosed({ maxResults });
  }

  async function restoreSession(sessionId) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.sessions) return null;
    return await chromeApi.sessions.restore(sessionId);
  }

  function normalizeSessionRestoreTabs(session) {
    const sourceTabs = Array.isArray(session?.tabs) && session.tabs.length > 0
      ? session.tabs
      : (Array.isArray(session?.urls) ? session.urls.map(url => ({ url })) : []);

    return sourceTabs
      .filter(tab => tab && typeof tab.url === 'string' && tab.url.length > 0)
      .map((tab, index) => {
        const url = normalizeRestorableUrl(tab.url);
        if (!url || isInternalUrl(url, getChromeApi()?.runtime?.id || '')) return null;
        return {
          url,
          title: typeof tab.title === 'string' ? tab.title : url,
          windowId: Number.isFinite(Number(tab.windowId)) ? Number(tab.windowId) : 0,
          index: Number.isFinite(Number(tab.index)) ? Number(tab.index) : index,
          groupTitle: typeof tab.groupTitle === 'string' ? tab.groupTitle : '',
          groupColor: typeof tab.groupColor === 'string' ? tab.groupColor : '',
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.windowId === b.windowId ? a.index - b.index : a.windowId - b.windowId);
  }

  async function restoreSavedSession(session, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.windows || !chromeApi?.tabs) return null;

    const sessionTabs = normalizeSessionRestoreTabs(session);
    const urls = sessionTabs.map(tab => tab.url);
    if (urls.length === 0) return null;

    let restoredWindow = null;
    let restoredTabs = [];
    const targetWindowId = Number(options.windowId);

    if (Number.isFinite(targetWindowId)) {
      const existingTabs = await chromeApi.tabs.query({ windowId: targetWindowId });
      const activeTab = existingTabs.find(tab => tab.active) || existingTabs[existingTabs.length - 1];
      let insertIndex = Number.isFinite(Number(activeTab?.index)) ? Number(activeTab.index) + 1 : existingTabs.length;
      for (const url of urls) {
        const created = await chromeApi.tabs.create({
          url,
          windowId: targetWindowId,
          active: options.active === true,
          index: insertIndex,
        });
        restoredTabs.push(created);
        insertIndex += 1;
      }
      restoredWindow = { id: targetWindowId, tabs: restoredTabs };
      if (options.focused === true) await chromeApi.windows.update(targetWindowId, { focused: true });
    } else {
      restoredWindow = await chromeApi.windows.create({
        url: urls,
        focused: options.focused !== false,
      });

      restoredTabs = Array.isArray(restoredWindow?.tabs) ? restoredWindow.tabs : [];
      if (restoredWindow?.id != null && restoredTabs.length < urls.length) {
        restoredTabs = await chromeApi.tabs.query({ windowId: restoredWindow.id });
      }
    }

    restoredTabs = restoredTabs
      .filter(tab => tab?.id != null)
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    const fallbackTitle = typeof session?.group === 'string' ? session.group : '';
    const fallbackColor = typeof session?.groupColor === 'string' ? session.groupColor : '';
    const groups = new Map();

    sessionTabs.forEach((sourceTab, index) => {
      const restoredTab = restoredTabs[index];
      if (!restoredTab?.id) return;
      const title = sourceTab.groupTitle || fallbackTitle;
      const color = sourceTab.groupColor || fallbackColor;
      if (!title && !color) return;
      const key = `${title}\n${color}`;
      if (!groups.has(key)) groups.set(key, { title, color, tabIds: [] });
      groups.get(key).tabIds.push(restoredTab.id);
    });

    const groupIds = [];
    if (chromeApi.tabGroups) {
      for (const group of groups.values()) {
        if (group.tabIds.length === 0) continue;
        const groupId = await chromeApi.tabs.group({ tabIds: group.tabIds });
        const update = {};
        if (group.title) update.title = group.title;
        if (CHROME_GROUP_COLORS.has(group.color)) update.color = group.color;
        if (Object.keys(update).length > 0) await chromeApi.tabGroups.update(groupId, update);
        groupIds.push(groupId);
      }
    }

    return {
      windowId: restoredWindow?.id,
      tabIds: restoredTabs.map(tab => tab.id).filter(Boolean),
      groupIds,
    };
  }

  const api = {
    BROWSER_NEWTAB_URLS,
    extensionNewTabUrl,
    isBrowserNewTabUrl,
    isExtensionPageUrl,
    isInternalUrl,
    isRealTab,
    normalizeTabFaviconUrl,
    normalizeTab,
    fetchOpenTabs,
    fetchTabGroups,
    fetchNormalWindows,
    getTabsByIds,
    moveTabs,
    createWindowFromTab,
    moveTabGroup,
    focusWindow,
    exactUnpinnedIdsForUrls,
    closeTabsByUrls,
    closeTabsByIds,
    focusTab,
    closeDuplicateTabs,
    closeTabOutDupes,
    DASHBOARD_CLEANUP_KEY,
    createDashboardCleanupController,
    groupTabs,
    updateGroup,
    ungroupTabs,
    getRecentlyClosed,
    restoreSession,
    normalizeSessionRestoreTabs,
    restoreSavedSession,
  };

  global.SuperTabOutTabs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

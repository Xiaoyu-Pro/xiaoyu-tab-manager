/* 快捷入口只复用完整 URL，不猜测同域名页面，不关闭任何标签。 */
(function (global) {
  'use strict';

  /** 只将已提交且未导航到其他 URL 的普通标签视为精确目标。 */
  function isExactTab(tab, url) {
    return Number.isInteger(tab?.id) && !tab.incognito && tab.url === url
      && (!tab.pendingUrl || tab.pendingUrl === url);
  }

  /** 优先当前窗口，其次最近使用的精确页面，绝不按域名兜底。 */
  function selectExactTab(snapshot, url) {
    return snapshot.tabs.filter(tab => isExactTab(tab, url)).sort((a, b) =>
      Number(b.windowId === snapshot.currentWindowId) - Number(a.windowId === snapshot.currentWindowId)
      || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id - b.id)[0] || null;
  }

  /** 创建独立的快照和打开服务，不使用自动关闭标签的后台逻辑。 */
  function createService(browser = global.chrome) {
    /** 获取可操作普通窗口，排除隐身及弹出窗口。 */
    async function getSnapshot() {
      const [allWindows, current] = await Promise.all([
        browser.windows.getAll({ populate: true, windowTypes: ['normal'] }), browser.windows.getCurrent(),
      ]);
      const windows = allWindows.filter(window => window.type === 'normal' && !window.incognito);
      return { windows, currentWindowId: current.id,
        tabs: windows.flatMap(window => (window.tabs || []).filter(tab => !tab.incognito)) };
    }

    /** 点击时重新核验；激活失败不盲目另开，显式副本直接新建。 */
    async function open(value, { newCopy = false } = {}) {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error('keywordInvalidUrl'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('keywordInvalidUrl');
      const url = parsed.href;
      if (!newCopy) {
        const snapshot = await getSnapshot();
        const target = selectExactTab(snapshot, url);
        if (target) {
          const fresh = await browser.tabs.get(target.id);
          if (!isExactTab(fresh, url) || !snapshot.windows.some(window => window.id === fresh.windowId)) throw new Error('shortcutTargetChanged');
          const tab = await browser.tabs.update(fresh.id, { active: true });
          await browser.windows.update(fresh.windowId, { focused: true });
          console.info('[Xiaoyu shortcuts] Reused exact tab', { tabId: fresh.id, windowId: fresh.windowId });
          return { reused: true, tab };
        }
      }
      const tab = await browser.tabs.create({ url, active: true });
      console.info('[Xiaoyu shortcuts] Created tab', { tabId: tab.id, newCopy });
      return { reused: false, tab };
    }

    return { getSnapshot, open };
  }

  const api = { isExactTab, selectExactTab, createService };
  global.XiaoyuShortcutTabs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

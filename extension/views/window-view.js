/* Xiaoyu Tab Manager 真实 Chrome 窗口纯渲染器；基于 Super Tab Out，由 Xiaoyu-Pro 修改。 */
(function initWindowView(globalScope) {
  'use strict';

  /** 转义窗口标题和标签信息。 */
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /** 从标签 URL 提取展示域名。 */
  function getDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') || '本地页面'; }
    catch { return '未知页面'; }
  }

  /** 只把可由 Chrome 跨窗口移动的网页实例渲染为拖拽行。 */
  function isMovableTab(tab) {
    if (!tab || !Number.isFinite(tab.id) || tab.pinned) return false;
    try {
      return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol);
    } catch {
      return false;
    }
  }

  /** 渲染窗口中的单个真实标签，不按 URL 去重。 */
  function renderTabRow(tab, windowId, options) {
    const title = tab.title || tab.url || options.labels.untitled;
    const domain = getDomain(tab.url);
    const favicon = options.renderFavicon ? options.renderFavicon(tab, domain) : '<span class="organization-favicon-placeholder" aria-hidden="true"></span>';
    return `
      <article class="page-chip organization-tab-row clickable" draggable="true"
               data-tab-id="${Number(tab.id)}" data-source-id="window:${Number(windowId)}"
               data-tab-url="${escapeHtml(tab.url || '')}" role="listitem" title="${escapeHtml(title)}">
        <span class="organization-drag-handle" aria-hidden="true">⠿</span>
        <button type="button" class="organization-tab-focus" data-action="focus-tab-id"
                data-tab-id="${Number(tab.id)}" aria-label="${escapeHtml(`${options.labels.focusTab}: ${title}`)}">
          ${favicon}
          <span class="organization-tab-copy">
            <span class="chip-text">${escapeHtml(title)}</span>
            <span class="organization-tab-domain">${escapeHtml(domain)}</span>
          </span>
        </button>
        <span class="chip-actions organization-tab-actions">
          <button type="button" class="chip-action organization-move-btn" data-action="move-tab-menu"
                  data-tab-id="${Number(tab.id)}" aria-label="${escapeHtml(options.labels.moveTab)}">↗</button>
          <button type="button" class="chip-action chip-close organization-close-btn" data-action="close-tab-id"
                  data-tab-id="${Number(tab.id)}" aria-label="${escapeHtml(`${options.labels.closeTab}: ${title}`)}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </span>
      </article>`;
  }

  /** 渲染一个真实普通窗口卡片及其保护标签摘要。 */
  function renderWindowCard(windowInfo, index, options) {
    const tabs = Array.isArray(windowInfo.tabs) ? windowInfo.tabs : [];
    const pinnedCount = tabs.filter(tab => tab.pinned).length;
    const movableTabs = tabs.filter(isMovableTab);
    const rows = movableTabs.length
      ? movableTabs.map(tab => renderTabRow(tab, windowInfo.id, options)).join('')
      : `<div class="organization-card-empty">${escapeHtml(options.labels.emptyWindow)}</div>`;
    return `
      <section class="mission-card organization-card window-card${windowInfo.focused ? ' is-focused-window' : ''}"
               data-window-id="${Number(windowInfo.id)}" data-drop-target-id="window:${Number(windowInfo.id)}">
        <div class="mission-content">
          <div class="organization-card-header">
            <span class="mission-name">${escapeHtml(`${options.labels.window} ${index + 1}`)}</span>
            ${windowInfo.focused ? `<span class="organization-current-badge">${escapeHtml(options.labels.current)}</span>` : ''}
            <span class="open-tabs-badge">${movableTabs.length} ${escapeHtml(options.labels.tabs)}</span>
            <button type="button" class="icon-action-btn" data-action="focus-window" data-window-id="${Number(windowInfo.id)}" aria-label="${escapeHtml(options.labels.focusWindow)}">↗</button>
          </div>
          ${pinnedCount ? `<div class="organization-protected-note">${escapeHtml(options.labels.pinned.replace('{count}', String(pinnedCount)))}</div>` : ''}
          <div class="mission-pages organization-tab-list" role="list">${rows}</div>
        </div>
      </section>`;
  }

  /** 渲染永久存在的虚拟新窗口目标；它没有真实 windowId，也不进入窗口计数。 */
  function renderNewWindowTarget(options) {
    return `
      <section class="mission-card organization-card window-card window-new-target"
               data-drop-target-id="window:new" aria-label="${escapeHtml(options.labels.newWindow)}">
        <div class="mission-content window-new-target-content">
          <span class="window-new-target-icon" aria-hidden="true">＋</span>
          <span class="mission-name">${escapeHtml(options.labels.newWindow)}</span>
          <span class="organization-card-empty">${escapeHtml(options.labels.dropToCreateWindow)}</span>
        </div>
      </section>`;
  }

  /** 渲染全部普通窗口；每个 tabId 都必须生成独立行。 */
  function renderWindowView({ windows = [], labels = {}, renderFavicon = null } = {}) {
    const options = {
      renderFavicon,
      labels: {
        window: labels.window || '窗口',
        current: labels.current || '当前',
        tabs: labels.tabs || '个标签页',
        untitled: labels.untitled || '未命名页面',
        focusTab: labels.focusTab || '打开标签页',
        moveTab: labels.moveTab || '移动到其他窗口',
        closeTab: labels.closeTab || '关闭这个标签页',
        focusWindow: labels.focusWindow || '切换到此窗口',
        emptyWindow: labels.emptyWindow || '没有可移动的标签页',
        pinned: labels.pinned || '{count} 个置顶标签保持原位',
        newWindow: labels.newWindow || '新窗口',
        dropToCreateWindow: labels.dropToCreateWindow || '将标签页拖到这里创建窗口',
      },
    };
    const windowCards = windows.map((windowInfo, index) => renderWindowCard(windowInfo, index, options)).join('');
    return `<div class="window-grid">${windowCards}${renderNewWindowTarget(options)}</div>`;
  }

  const api = { isMovableTab, renderWindowView };
  globalScope.SuperTabOutWindowView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

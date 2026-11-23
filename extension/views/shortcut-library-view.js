/* 持久快捷卡片纯渲染器；与顶部搜索共用映射和精确打开状态。 */
(function (global) {
  'use strict';
  const html = global.SuperTabOutHtml || (typeof require === 'function' ? require('../services/html-service.js') : null);
  const tabs = global.XiaoyuShortcutTabs || (typeof require === 'function' ? require('../services/shortcut-tabs.js') : null);

  /** 用相同快照生成搜索和卡片状态，查询失败不谎报页面尚未打开。 */
  function getStatus(snapshot, url, translate) {
    if (!snapshot) return { opened: false, text: translate('shortcutStatusUnknown') };
    const target = tabs.selectExactTab(snapshot, url);
    return target ? { opened: true, text: translate('shortcutOpenedWindow', {
      number: snapshot.windows.findIndex(window => window.id === target.windowId) + 1,
    }) } : { opened: false, text: translate('shortcutNotOpened') };
  }

  /** 生成与现有组织视图一致的分组卡片，所有用户数据必须转义。 */
  function render({ rows = [], tabSnapshot = null, loadError = false, translate }) {
    const escape = html.escapeHtml;
    const toolbar = `<div class="shortcut-library-toolbar"><p>${escape(translate('shortcutLibraryHelp'))}</p>
      <button type="button" class="action-btn" data-action="manage-shortcuts">${escape(translate('keywordManage'))}</button></div>`;
    if (loadError || !rows.length) return toolbar + `<div class="organization-card-empty shortcut-library-empty" role="status">${escape(translate(loadError ? 'keywordLoadError' : 'keywordEmpty'))}</div>`;
    const groups = new Map();
    for (const row of rows) {
      const key = row.keyword.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return toolbar + `<div class="shortcut-library-grid">${[...groups.values()].map(group => `
      <section class="mission-card organization-card shortcut-library-card">
        <div class="mission-content">
          <div class="organization-card-header"><span class="mission-name">${escape(group[0].keyword)}</span>
            <span class="open-tabs-badge">${escape(translate('keywordPageCount', { count: group.length }))}</span></div>
          <div class="mission-pages">${group.map(row => {
            const state = getStatus(tabSnapshot, row.url, translate);
            return `<button type="button" class="shortcut-library-row" data-action="open-shortcut" data-mapping-id="${escape(row.id)}" title="${escape(row.url)}">
              <span class="shortcut-library-copy"><span class="chip-text">${escape(row.title)}</span><span class="shortcut-library-url">${escape(row.url)}</span></span>
              <span class="shortcut-open-state${state.opened ? ' is-open' : ''}">${escape(state.text)}</span>
              <span class="shortcut-library-arrow" aria-hidden="true">↗</span></button>`;
          }).join('')}</div>
        </div>
      </section>`).join('')}</div>`;
  }

  const api = { getStatus, render };
  global.XiaoyuShortcutLibrary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

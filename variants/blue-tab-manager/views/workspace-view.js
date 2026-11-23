/* Blue Tab Manager 工作编排纯渲染器；基于 Super Tab Out，由 Xiaoyu-Pro 修改。 */
(function initWorkspaceView(globalScope) {
  'use strict';

  /** 对工作名、标题和 URL 进行 HTML 转义。 */
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /** 从 URL 提取安全展示域名，解析失败时使用短占位。 */
  function getDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') || '本地页面'; }
    catch { return '未知页面'; }
  }

  /** 渲染单个可拖拽标签行，favicon 由现有安全策略回调提供。 */
  function renderTabRow(tab, sourceId, options) {
    const title = tab.title || tab.url || options.labels.untitled;
    const domain = getDomain(tab.url);
    const favicon = options.renderFavicon ? options.renderFavicon(tab, domain) : '<span class="organization-favicon-placeholder" aria-hidden="true"></span>';
    return `
      <article class="page-chip organization-tab-row clickable" draggable="true"
               data-tab-id="${Number(tab.id)}" data-source-id="${escapeHtml(sourceId)}"
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

  /** 渲染工作卡片；整个卡片都是投放区域，但按钮仍可独立操作。 */
  function renderWorkspaceCard(workspace, options) {
    const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
    const rows = tabs.length
      ? tabs.map(tab => renderTabRow(tab, `workspace:${workspace.id}`, options)).join('')
      : `<div class="organization-card-empty">${escapeHtml(options.labels.dropTabsHere)}</div>`;
    return `
      <section class="mission-card organization-card workspace-card" data-workspace-id="${escapeHtml(workspace.id)}"
               data-drop-target-id="workspace:${escapeHtml(workspace.id)}">
        <div class="mission-content">
          <div class="organization-card-header">
            <span class="mission-name">${escapeHtml(workspace.name)}</span>
            <span class="open-tabs-badge">${tabs.length} ${escapeHtml(options.labels.tabs)}</span>
            <span class="organization-card-menu">
              <button type="button" class="icon-action-btn" data-action="rename-workspace" data-workspace-id="${escapeHtml(workspace.id)}" aria-label="${escapeHtml(options.labels.rename)}">✎</button>
              <button type="button" class="icon-action-btn" data-action="delete-workspace" data-workspace-id="${escapeHtml(workspace.id)}" aria-label="${escapeHtml(options.labels.delete)}">×</button>
            </span>
          </div>
          <div class="mission-pages organization-tab-list" role="list">${rows}</div>
          <div class="actions">
            <button type="button" class="action-btn" data-action="create-workspace-group" data-workspace-id="${escapeHtml(workspace.id)}"${tabs.length ? '' : ' disabled'}>${escapeHtml(options.labels.createGroup)}</button>
          </div>
        </div>
      </section>`;
  }

  /** 渲染待整理区域，并保留域名分组以降低初次整理成本。 */
  function renderUnassigned(unassignedGroups, options) {
    const groups = (Array.isArray(unassignedGroups) ? unassignedGroups : []).map(group => `
      <section class="workspace-unassigned-domain">
        <div class="workspace-unassigned-domain-title">${escapeHtml(group.label || group.hostname || group.domain)}</div>
        <div class="organization-tab-list" role="list">
          ${(group.tabs || []).map(tab => renderTabRow(tab, 'unassigned', options)).join('')}
        </div>
      </section>`).join('');
    return `
      <section class="mission-card organization-card workspace-unassigned-card" data-drop-target-id="unassigned">
        <div class="mission-content">
          <div class="organization-card-header">
            <span class="mission-name">${escapeHtml(options.labels.unassigned)}</span>
            <span class="open-tabs-badge">${unassignedGroups.reduce((sum, group) => sum + (group.tabs?.length || 0), 0)} ${escapeHtml(options.labels.tabs)}</span>
          </div>
          ${groups || `<div class="organization-card-empty">${escapeHtml(options.labels.allOrganized)}</div>`}
        </div>
      </section>`;
  }

  /** 渲染完整工作编排视图。 */
  function renderWorkspaceView({ workspaces = [], unassignedGroups = [], labels = {}, renderFavicon = null } = {}) {
    const options = {
      renderFavicon,
      labels: {
        tabs: labels.tabs || '个标签页',
        untitled: labels.untitled || '未命名页面',
        focusTab: labels.focusTab || '打开标签页',
        moveTab: labels.moveTab || '移动到其他工作',
        closeTab: labels.closeTab || '关闭这个标签页',
        rename: labels.rename || '重命名工作',
        delete: labels.delete || '删除工作',
        createGroup: labels.createGroup || '创建标签组',
        dropTabsHere: labels.dropTabsHere || '把标签页拖到这里',
        unassigned: labels.unassigned || '待整理',
        allOrganized: labels.allOrganized || '所有页面都已整理',
      },
    };
    const cards = workspaces.map(item => renderWorkspaceCard(item, options)).join('');
    return `
      <div class="organization-toolbar">
        <button type="button" class="action-btn primary" data-action="create-workspace">＋ ${escapeHtml(labels.createWorkspace || '新建工作')}</button>
        <button type="button" class="action-btn" data-action="reassign-workspace-windows"${workspaces.some(item => item.tabs?.length) ? '' : ' disabled'}>${escapeHtml(labels.reassignWindows || '按照现有组织重新分配窗口')}</button>
      </div>
      <div class="workspace-grid">${cards}${renderUnassigned(unassignedGroups, options)}</div>`;
  }

  const api = { getDomain, renderWorkspaceView };
  globalScope.SuperTabOutWorkspaceView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

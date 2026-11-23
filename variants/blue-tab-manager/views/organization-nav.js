/* Blue Tab Manager 组织视图导航渲染器；基于 Super Tab Out，由 Xiaoyu-Pro 修改。 */
(function initOrganizationNav(globalScope) {
  'use strict';

  const PRIMARY_VIEWS = new Set(['domain', 'workspace', 'window']);
  const WORKSPACE_VIEWS = new Set(['arrange', 'chrome-groups']);

  /** 转义导航文案，防止自定义语言内容进入 HTML 结构。 */
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /**
   * 解析新旧视图偏好；只有“尚未写入新偏好”时才读取旧值，
   * 防止损坏的新值被旧 `group` 偏好错误迁移回工作视图。
   */
  function resolveOrganizationPreferences({ storedView = '', storedWorkspaceView = '', legacyView = 'domain' } = {}) {
    const hasStoredView = typeof storedView === 'string' && storedView !== '';
    const activeView = hasStoredView
      ? (PRIMARY_VIEWS.has(storedView) ? storedView : 'domain')
      : (legacyView === 'group' ? 'workspace' : 'domain');
    const defaultWorkspaceView = !hasStoredView && legacyView === 'group' ? 'chrome-groups' : 'arrange';
    return {
      activeView,
      activeWorkspaceView: WORKSPACE_VIEWS.has(storedWorkspaceView)
        ? storedWorkspaceView
        : defaultWorkspaceView,
    };
  }

  /** 渲染一级组织入口和仅属于“工作”的二级入口。 */
  function renderOrganizationNav({ activeView = 'domain', activeWorkspaceView = 'arrange', labels = {} } = {}) {
    const copy = {
      domain: labels.domain || '域名',
      workspace: labels.workspace || '工作',
      window: labels.window || '窗口',
      arrange: labels.arrange || '工作编排',
      chromeGroups: labels.chromeGroups || 'Chrome 标签组',
    };
    const primaryItems = [
      ['domain', copy.domain],
      ['workspace', copy.workspace],
      ['window', copy.window],
    ];
    const primary = primaryItems.map(([value, label]) => `
      <button type="button" class="organization-nav-btn${activeView === value ? ' active' : ''}"
              role="tab" data-action="switch-organization-view" data-organization-view="${value}" aria-selected="${activeView === value}">
        ${escapeHtml(label)}
      </button>`).join('');
    const secondary = activeView === 'workspace' ? `
      <div class="workspace-subnav" role="tablist" aria-label="${escapeHtml(copy.workspace)}">
        <button type="button" class="workspace-subnav-btn${activeWorkspaceView === 'arrange' ? ' active' : ''}"
                role="tab" data-action="switch-workspace-view" data-workspace-view="arrange" aria-selected="${activeWorkspaceView === 'arrange'}">${escapeHtml(copy.arrange)}</button>
        <button type="button" class="workspace-subnav-btn${activeWorkspaceView === 'chrome-groups' ? ' active' : ''}"
                role="tab" data-action="switch-workspace-view" data-workspace-view="chrome-groups" aria-selected="${activeWorkspaceView === 'chrome-groups'}">${escapeHtml(copy.chromeGroups)}</button>
      </div>` : '';
    return `<div class="organization-navigation"><div class="organization-nav" role="tablist">${primary}</div>${secondary}</div>`;
  }

  const api = { resolveOrganizationPreferences, renderOrganizationNav };
  globalScope.SuperTabOutOrganizationNav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

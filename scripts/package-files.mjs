/** Xiaoyu Tab Manager 发布文件清单；打包与验证必须共用这一份定义。 */

export const EXTENSION_PACKAGE_FILES = Object.freeze([
  'manifest.json',
  'background.js',
  'index.html',
  'app.js',
  'style.css',
  'keyword-search.css',
  'theme-init.js',
  'tab-reuse-popup.html',
  'tab-reuse-popup.js',
  'sidepanel.html',
  'sidepanel.css',
  'sidepanel.js',
  'tools.html',
  'tools.css',
  'tools.js',
  'services/url-service.js',
  'services/html-service.js',
  'services/storage-service.js',
  'services/keyword-mappings.js',
  'services/shortcut-tabs.js',
  'services/tabs-service.js',
  'services/tab-reuse.js',
  'services/workspace-service.js',
  'services/workspace-planner.js',
  'services/workspace-operations.js',
  'services/drag-controller.js',
  'services/search-service.js',
  'services/metrics-service.js',
  'services/tools-service.js',
  'views/organization-nav.js',
  'views/workspace-view.js',
  'views/window-view.js',
  'views/shortcut-library-view.js',
  'views/tab-reuse-settings.js',
  'views/keyword-search.js',
  'vendor/qrcodegen.js',
  '_locales/en/messages.json',
  '_locales/zh_CN/messages.json',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
]);

export const LEGAL_PACKAGE_FILES = Object.freeze([
  'LICENSE',
  'NOTICE',
  'MODIFICATIONS.md',
]);

export const ARCHIVE_FILES = Object.freeze([
  ...EXTENSION_PACKAGE_FILES,
  ...LEGAL_PACKAGE_FILES,
]);

/** 根据浏览器目标与 Manifest 版本生成稳定、可审计的发布包文件名。 */
export function getPackageArchiveName(target, version) {
  return `xiaoyu-tab-manager-${target}-${version}.zip`;
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCT_NAME = 'Xiaoyu Tab Manager';

/** 读取仓库内文本文件，统一品牌契约测试的路径处理。 */
function readText(root, relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

/** 读取 JSON 文件；解析失败时保留 Node 原始错误，便于定位格式问题。 */
function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

/** 验证浏览器入口与页面中的当前产品身份已经统一。 */
function assertRuntimeBrand(root) {
  const en = readJson(root, 'extension/_locales/en/messages.json');
  const zh = readJson(root, 'extension/_locales/zh_CN/messages.json');
  const manifest = readJson(root, 'extension/manifest.json');
  assert.equal(en.extensionName.message, PRODUCT_NAME);
  assert.equal(zh.extensionName.message, PRODUCT_NAME);
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.omnibox.keyword, 'xtm');

  for (const page of ['index.html', 'sidepanel.html', 'tools.html']) {
    assert.match(readText(root, `extension/${page}`), new RegExp(`<title>${PRODUCT_NAME}`));
  }

  const dashboard = readText(root, 'extension/index.html');
  assert.match(dashboard, />Xiaoyu Tab Manager<\/a>/);
  assert.match(dashboard, /class="panel-brand">Xiaoyu Tab Manager</);
  assert.match(dashboard, /aria-label="Xiaoyu Tab Manager dock"/);

  const sidePanel = readText(root, 'extension/sidepanel.html');
  const toolsPage = readText(root, 'extension/tools.html');
  assert.match(sidePanel, /class="panel-brand">Xiaoyu Tab Manager</);
  assert.match(toolsPage, /class="tools-brand">Xiaoyu Tab Manager</);

  const app = readText(root, 'extension/app.js');
  const background = readText(root, 'extension/background.js');
  const tools = readText(root, 'extension/tools.js');
  assert.equal(app.includes("documentTitle: 'Super Tab Out'"), false);
  assert.equal(background.includes('Search Super Tab Out'), false);
  assert.equal(tools.includes('super-tab-out-qr.svg'), false);
  assert.match(tools, /xiaoyu-tab-manager-qr\.svg/);
}

/** 验证公开文档与包元数据使用新品牌，同时保留上游署名。 */
function assertDistributionBrand(root) {
  const packageJson = readJson(root, 'package.json');
  assert.equal(packageJson.name, 'xiaoyu-tab-manager');

  for (const file of [
    'README.md',
    'README.zh-CN.md',
    'PRIVACY.md',
    'STORE_LISTING.md',
    'MODIFICATIONS.md',
    'todo.md',
  ]) {
    assert.match(readText(root, file), /Xiaoyu Tab Manager/, file);
  }

  const notice = readText(root, 'NOTICE');
  assert.match(notice, /^Xiaoyu Tab Manager$/m);
  assert.match(notice, /Super Tab Out/);
  assert.match(notice, /Tab Out/);
  assert.match(notice, /QR Code generator/);
}

/** 验证改名没有破坏升级所依赖的内部事件、锁名和全局对象。 */
function assertCompatibilityIdentifiers(root) {
  assert.match(readText(root, 'extension/app.js'), /super-tab-out-language-change/);
  assert.match(readText(root, 'extension/services/workspace-service.js'), /super-tab-out-workspace-state/);
  assert.match(readText(root, 'extension/services/workspace-operations.js'), /super-tab-out-chrome-organization/);
  assert.match(readText(root, 'extension/services/storage-service.js'), /SuperTabOutStorage/);
}

/** 执行品牌、署名和内部兼容边界的完整契约测试。 */
export function testBrandContract(root) {
  assertRuntimeBrand(root);
  assertDistributionBrand(root);
  assertCompatibilityIdentifiers(root);
}

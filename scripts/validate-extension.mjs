#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVE_FILES,
  EXTENSION_PACKAGE_FILES,
  LEGAL_PACKAGE_FILES,
  getPackageArchiveName,
} from './package-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const failures = [];
const OPTIONAL_LOCAL_REFERENCES = new Set(['config.local.js']);

/** 累积失败而不是遇到首个错误就退出，便于一次修完打包问题。 */
function fail(message) {
  failures.push(message);
}

/** 读取 JSON 并把解析错误转成统一的验证结果。 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return null;
  }
}

/** 判断 HTML 引用是否属于需要随扩展发布的本地资源。 */
function isLocalReference(reference) {
  return Boolean(reference)
    && !reference.startsWith('#')
    && !/^(?:[a-z]+:)?\/\//i.test(reference)
    && !reference.startsWith('data:');
}

/** 把相对页面引用归一化为扩展根目录使用的 POSIX 路径。 */
function resolveLocalReference(ownerFile, reference) {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  return posix.normalize(posix.join(posix.dirname(ownerFile), cleanReference));
}

/** 校验本地运行时引用存在，并且已经进入共享发布清单。 */
function checkPackagedReference(ownerFile, reference) {
  if (!isLocalReference(reference)) return;
  const normalized = resolveLocalReference(ownerFile, reference);
  if (OPTIONAL_LOCAL_REFERENCES.has(normalized)) return;
  if (normalized.startsWith('../') || normalized.startsWith('/')) {
    fail(`${ownerFile} references path outside extension root: ${reference}`);
    return;
  }
  if (!existsSync(join(extensionDir, normalized))) {
    fail(`${ownerFile} references missing local file: ${normalized}`);
  }
  if (!EXTENSION_PACKAGE_FILES.includes(normalized)) {
    fail(`${ownerFile} references file not included in package manifest: ${normalized}`);
  }
}

/** 检查共享清单无重复、无越界路径，并且所有源文件真实存在。 */
function checkPackageManifest() {
  if (new Set(ARCHIVE_FILES).size !== ARCHIVE_FILES.length) {
    fail('Shared package manifest contains duplicate entries');
  }
  for (const file of EXTENSION_PACKAGE_FILES) {
    if (posix.isAbsolute(file) || file === '..' || file.startsWith('../')) {
      fail(`Shared package manifest contains unsafe extension path: ${file}`);
    } else if (!existsSync(join(extensionDir, file))) {
      fail(`Shared package manifest references missing extension file: ${file}`);
    }
  }
  for (const file of LEGAL_PACKAGE_FILES) {
    if (posix.isAbsolute(file) || file.includes('/')) {
      fail(`Shared package manifest contains unsafe legal path: ${file}`);
    } else if (!existsSync(join(root, file))) {
      fail(`Shared package manifest references missing legal file: ${file}`);
    }
  }
}

/** 检查 Manifest V3 契约、权限和所有本地入口资源。 */
function checkManifest() {
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest) return null;

  if (manifest.manifest_version !== 3) fail('manifest.json must use manifest_version 3');
  if (!manifest.chrome_url_overrides?.newtab) fail('manifest.json must override the new tab page');
  for (const permission of ['tabs', 'storage', 'tabGroups', 'sidePanel', 'sessions']) {
    if (!manifest.permissions?.includes(permission)) fail(`manifest.json is missing permission: ${permission}`);
  }

  const manifestReferences = [
    manifest.chrome_url_overrides?.newtab,
    manifest.side_panel?.default_path,
    manifest.background?.service_worker,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
  ];
  for (const reference of manifestReferences) checkPackagedReference('manifest.json', reference);
  return manifest;
}

/** 递归收集文件，用于对全部扩展脚本做语法检查。 */
async function collectFiles(dir, predicate, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

/** 使用 Node 解析器检查全部 JavaScript，尽早发现发布前语法错误。 */
async function checkSyntax() {
  const jsFiles = await collectFiles(extensionDir, path => path.endsWith('.js'));
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      fail(`${relative(root, file)} failed syntax check:\n${result.stderr || result.stdout}`);
    }
  }
}

/** 提取页面中的本地脚本和样式引用，覆盖运行时依赖闭包。 */
function collectHtmlReferences(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map(match => match[1]);
  const styles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/gi)].map(match => match[1]);
  return { scripts, styles };
}

/** 检查单个 HTML 的引用存在、进入包清单，并满足关键脚本加载顺序。 */
function checkHtmlResources(htmlFile, expectedScripts = []) {
  const html = readFileSync(join(extensionDir, htmlFile), 'utf8');
  const { scripts, styles } = collectHtmlReferences(html);
  for (const reference of [...scripts, ...styles]) checkPackagedReference(htmlFile, reference);

  let previousIndex = -1;
  const appIndex = scripts.indexOf('app.js');
  for (const script of expectedScripts) {
    const scriptIndex = scripts.indexOf(script);
    if (scriptIndex === -1) {
      fail(`${htmlFile} does not load ${script}`);
      continue;
    }
    if (scriptIndex <= previousIndex) fail(`${script} loads out of order in ${htmlFile}`);
    if (appIndex !== -1 && scriptIndex > appIndex) fail(`${script} must load before app.js`);
    previousIndex = scriptIndex;
  }
}

/** 检查扩展页面入口，覆盖组织模块和标签复用反馈页。 */
function checkHtmlEntrypoints() {
  checkHtmlResources('index.html', [
    'services/url-service.js',
    'services/html-service.js',
    'services/storage-service.js',
    'services/keyword-mappings.js',
    'services/shortcut-tabs.js',
    'services/tabs-service.js',
    'services/tab-reuse.js',
    'services/dashboard-cleanup.js',
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
    'views/dashboard-cleanup-settings.js',
    'views/keyword-search.js',
  ]);
  checkHtmlResources('sidepanel.html', [
    'services/url-service.js',
    'services/storage-service.js',
    'services/tabs-service.js',
    'services/search-service.js',
    'services/tools-service.js',
  ]);
  checkHtmlResources('tools.html', [
    'services/url-service.js',
    'services/storage-service.js',
    'services/tabs-service.js',
    'vendor/qrcodegen.js',
    'services/tools-service.js',
  ]);
  checkHtmlResources('tab-reuse-popup.html', ['tab-reuse-popup.js']);
}

/** 检查 service worker 的 importScripts 引用同样进入发布闭包。 */
function checkBackgroundImports() {
  const background = readFileSync(join(extensionDir, 'background.js'), 'utf8');
  const calls = [...background.matchAll(/importScripts\s*\(([\s\S]*?)\)\s*;/g)];
  for (const call of calls) {
    const references = [...call[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const reference of references) checkPackagedReference('background.js', reference);
  }
}

/** 保留命令 Dock 的既有跨容器交互与响应式约束。 */
function checkCommandDockContracts() {
  const indexHtml = readFileSync(join(extensionDir, 'index.html'), 'utf8');
  const sidepanelJs = readFileSync(join(extensionDir, 'sidepanel.js'), 'utf8');
  const dockIndex = indexHtml.indexOf('id="commandDockFavorites"');
  const drawerIndex = indexHtml.indexOf('id="commandDrawer"');

  if (dockIndex !== -1 && drawerIndex !== -1 && dockIndex < drawerIndex
      && !sidepanelJs.includes("actionEl.closest('.command-dock-rail')")) {
    fail('sidepanel.js must allow command dock actions rendered outside commandDrawer');
  }
  if (sidepanelJs.includes("const DOCK_BOTTOM_QUERY = '(min-width: 0px)'")) {
    fail('sidepanel.js DOCK_BOTTOM_QUERY must not force desktop dock sorting to horizontal');
  }
}

/** 读取 ZIP 中单个文件，供 Manifest 与法律声明内容校验使用。 */
function readZipEntry(zipPath, entry) {
  const result = spawnSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Could not read ${entry} from ${relative(root, zipPath)}`);
    return '';
  }
  return result.stdout;
}

/** 校验 ZIP 根结构、精确文件集、Manifest 版本与许可证内容。 */
function checkDistZip(zipPath, sourceManifest) {
  if (!existsSync(zipPath)) return;
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Could not inspect ${relative(root, zipPath)} with unzip`);
    return;
  }

  const entries = result.stdout.split('\n').filter(Boolean);
  for (const required of ARCHIVE_FILES) {
    if (!entries.includes(required)) fail(`${relative(root, zipPath)} is missing required entry: ${required}`);
  }
  for (const entry of entries) {
    const expectedDirectory = entry.endsWith('/') && ARCHIVE_FILES.some(file => file.startsWith(entry));
    if (!ARCHIVE_FILES.includes(entry) && !expectedDirectory) {
      fail(`${relative(root, zipPath)} contains unexpected entry: ${entry}`);
    }
  }

  const packagedManifestText = readZipEntry(zipPath, 'manifest.json');
  if (packagedManifestText) {
    try {
      const packagedManifest = JSON.parse(packagedManifestText);
      if (packagedManifest.version !== sourceManifest.version) {
        fail(`${relative(root, zipPath)} manifest version does not match source`);
      }
      if (packagedManifest.manifest_version !== 3) {
        fail(`${relative(root, zipPath)} manifest must use version 3`);
      }
    } catch (error) {
      fail(`${relative(root, zipPath)} contains invalid manifest JSON: ${error.message}`);
    }
  }

  const packagedNotice = readZipEntry(zipPath, 'NOTICE');
  if (!packagedNotice.includes('Xiaoyu Tab Manager') || !packagedNotice.includes('Super Tab Out')) {
    fail(`${relative(root, zipPath)} NOTICE must preserve current and upstream attribution`);
  }
}

/** 执行源码与现有发布包的完整静态验证。 */
async function main() {
  checkPackageManifest();
  const manifest = checkManifest();
  checkHtmlEntrypoints();
  checkBackgroundImports();
  checkCommandDockContracts();
  await checkSyntax();
  if (manifest?.version) {
    for (const target of ['chrome', 'edge']) {
      checkDistZip(join(root, 'dist', getPackageArchiveName(target, manifest.version)), manifest);
    }
  }

  if (failures.length > 0) {
    console.error('Extension validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Extension validation passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

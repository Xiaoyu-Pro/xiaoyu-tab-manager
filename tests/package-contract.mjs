import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import {
  ARCHIVE_FILES,
  EXTENSION_PACKAGE_FILES,
  LEGAL_PACKAGE_FILES,
  getPackageArchiveName,
} from '../scripts/package-files.mjs';
import { normalizeTargets, runPackage } from '../scripts/package-extension.mjs';

const TEST_DIRECTORY_PREFIX = 'xiaoyu-tab-manager-package-test-';

/** 严格校验后清理本测试创建的临时目录，避免测试失败时扩大删除范围。 */
function cleanupTestDirectory(testDirectory) {
  if (!existsSync(testDirectory) || lstatSync(testDirectory).isSymbolicLink()) return;
  const realTempRoot = realpathSync(tmpdir());
  const realTestDirectory = realpathSync(testDirectory);
  if (!realTestDirectory.startsWith(`${realTempRoot}${sep}`)
      || !basename(realTestDirectory).startsWith(TEST_DIRECTORY_PREFIX)) {
    throw new Error(`Refusing to clean unexpected test directory: ${realTestDirectory}`);
  }
  rmSync(realTestDirectory, { recursive: true });
}

/** 验证共享清单覆盖组织和快捷搜索模块、法律文件、双目标与异常清理路径。 */
export function testPackageContract() {
  for (const file of [
    'services/workspace-service.js',
    'services/workspace-planner.js',
    'services/workspace-operations.js',
    'services/drag-controller.js',
    'views/organization-nav.js',
    'views/workspace-view.js',
    'views/window-view.js',
    'keyword-search.css',
    'services/keyword-mappings.js',
    'services/shortcut-tabs.js',
    'views/shortcut-library-view.js',
    'views/keyword-search.js',
    'services/dashboard-cleanup.js',
    'views/dashboard-cleanup-settings.js',
  ]) {
    assert.equal(EXTENSION_PACKAGE_FILES.includes(file), true, file);
  }
  assert.deepEqual(LEGAL_PACKAGE_FILES, ['LICENSE', 'NOTICE', 'MODIFICATIONS.md']);
  assert.equal(new Set(ARCHIVE_FILES).size, ARCHIVE_FILES.length);
  assert.equal(getPackageArchiveName('chrome', '1.2.3'), 'xiaoyu-tab-manager-chrome-1.2.3.zip');
  assert.deepEqual(normalizeTargets([]), ['chrome', 'edge']);
  assert.deepEqual(normalizeTargets(['chrome', 'chrome']), ['chrome']);
  assert.throws(() => normalizeTargets(['firefox']), /Unknown package target/);

  const testDirectory = mkdtempSync(join(tmpdir(), TEST_DIRECTORY_PREFIX));
  const stageParent = join(testDirectory, 'stage');
  const outputDirectory = join(testDirectory, 'dist');
  mkdirSync(stageParent);
  try {
    assert.throws(() => runPackage(['chrome'], {
      zipCommand: 'xiaoyu-tab-manager-definitely-missing-zip-command',
      outputDirectory,
      stageParent,
    }), /Failed to create/);
    assert.deepEqual(readdirSync(outputDirectory), []);
    assert.deepEqual(readdirSync(stageParent), []);
  } finally {
    cleanupTestDirectory(testDirectory);
  }
}

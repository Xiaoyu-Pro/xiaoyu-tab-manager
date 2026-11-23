#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVE_FILES,
  EXTENSION_PACKAGE_FILES,
  LEGAL_PACKAGE_FILES,
  getPackageArchiveName,
} from './package-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const distDir = join(root, 'dist');
const STAGE_PREFIX = 'xiaoyu-tab-manager-package-';
const VALID_TARGETS = new Set(['chrome', 'edge']);

/** 校验目标名称，并在未指定时同时构建 Chrome 与 Edge 包。 */
export function normalizeTargets(targets) {
  const requestedTargets = targets.length > 0 ? targets : ['chrome', 'edge'];
  for (const target of requestedTargets) {
    if (!VALID_TARGETS.has(target)) {
      throw new Error(`Unknown package target "${target}". Use "chrome" or "edge".`);
    }
  }
  return [...new Set(requestedTargets)];
}

/** 在写入任何产物前检查共享清单中的源码与法律文件。 */
function assertPackageSources() {
  for (const file of EXTENSION_PACKAGE_FILES) {
    if (!existsSync(join(extensionDir, file))) throw new Error(`Package file is missing: ${file}`);
  }
  for (const file of LEGAL_PACKAGE_FILES) {
    if (!existsSync(join(root, file))) throw new Error(`Package legal file is missing: ${file}`);
  }
}

/** 将扩展文件和根目录法律文件复制到同一个受控 ZIP 根目录。 */
function copyPackageSources(stageDir) {
  for (const file of EXTENSION_PACKAGE_FILES) {
    const destination = join(stageDir, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(extensionDir, file), destination);
  }
  for (const file of LEGAL_PACKAGE_FILES) {
    copyFileSync(join(root, file), join(stageDir, file));
  }
}

/** 校验待删除产物是 dist 下本次任务定义的普通 ZIP，避免越界删除。 */
function assertSafeOutputPath(output, target, version, outputDirectory) {
  const expectedName = getPackageArchiveName(target, version);
  if (dirname(output) !== outputDirectory || basename(output) !== expectedName) {
    throw new Error(`Refusing to modify unexpected package path: ${output}`);
  }
  if (existsSync(output)) {
    const outputStat = lstatSync(output);
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
      throw new Error(`Refusing to replace non-regular package path: ${output}`);
    }
  }
}

/** 只移除经过严格文件名与类型校验的旧包或失败的半成品。 */
function removeOutputArchive(output, target, version, outputDirectory) {
  assertSafeOutputPath(output, target, version, outputDirectory);
  if (existsSync(output)) rmSync(output);
}

/** 检查临时目录确由本脚本在系统临时根目录下创建且不是符号链接。 */
function assertSafeStageDirectory(stageDir, stageParent) {
  if (!existsSync(stageDir) || lstatSync(stageDir).isSymbolicLink()) {
    throw new Error(`Refusing to clean invalid package staging directory: ${stageDir}`);
  }
  const realTempRoot = realpathSync(stageParent);
  const realStage = realpathSync(stageDir);
  if (!realStage.startsWith(`${realTempRoot}${sep}`) || !basename(realStage).startsWith(STAGE_PREFIX)) {
    throw new Error(`Refusing to clean unexpected package staging directory: ${realStage}`);
  }
}

/** 无论打包成功或失败，都只清理本次创建的临时目录。 */
function cleanupStageDirectory(stageDir, stageParent) {
  assertSafeStageDirectory(stageDir, stageParent);
  rmSync(stageDir, { recursive: true });
}

/** 从临时根目录创建单个目标 ZIP，并在失败时删除不完整产物。 */
function createArchive({ stageDir, target, version, zipCommand, outputDirectory }) {
  const output = join(outputDirectory, getPackageArchiveName(target, version));
  removeOutputArchive(output, target, version, outputDirectory);
  const result = spawnSync(zipCommand, ['-X', '-q', output, ...ARCHIVE_FILES], {
    cwd: stageDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    removeOutputArchive(output, target, version, outputDirectory);
    const details = result.error?.message || result.stderr || result.stdout || 'Unknown zip error';
    throw new Error(`Failed to create ${relative(root, output)}:\n${details}`);
  }
  console.log(`Created ${relative(root, output)}`);
}

/** 执行完整发布打包；zipCommand 可注入以覆盖缺少 zip 工具的失败回归测试。 */
export function runPackage(targets, {
  zipCommand = process.env.XIAOYU_TAB_MANAGER_ZIP_COMMAND || 'zip',
  outputDirectory = distDir,
  stageParent = tmpdir(),
} = {}) {
  const requestedTargets = normalizeTargets(targets);
  const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
  assertPackageSources();

  if (existsSync(outputDirectory) && lstatSync(outputDirectory).isSymbolicLink()) {
    throw new Error(`Refusing to write packages through symbolic link: ${outputDirectory}`);
  }
  if (!existsSync(stageParent) || lstatSync(stageParent).isSymbolicLink()) {
    throw new Error(`Package staging parent must be an existing regular directory: ${stageParent}`);
  }
  mkdirSync(outputDirectory, { recursive: true });

  const stageDir = mkdtempSync(join(stageParent, STAGE_PREFIX));
  try {
    copyPackageSources(stageDir);
    for (const target of requestedTargets) {
      createArchive({ stageDir, target, version: manifest.version, zipCommand, outputDirectory });
    }
  } finally {
    cleanupStageDirectory(stageDir, stageParent);
  }
}

/** CLI 入口保持模块可测试，导入本文件时不会自动生成产物。 */
function main() {
  runPackage(process.argv.slice(2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

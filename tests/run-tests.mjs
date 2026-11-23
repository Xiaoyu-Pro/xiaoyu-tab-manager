#!/usr/bin/env node
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrandContract } from './brand-contract.mjs';
import { testPackageContract } from './package-contract.mjs';
import { testKeywordMappings } from './keyword-mappings.test.mjs';
import { testShortcutLibrary } from './shortcut-library.test.mjs';
import { testDashboardCleanup } from './dashboard-cleanup.test.mjs';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const urls = require(resolve(root, 'extension/services/url-service.js'));
const tabs = require(resolve(root, 'extension/services/tabs-service.js'));
const storage = require(resolve(root, 'extension/services/storage-service.js'));
const search = require(resolve(root, 'extension/services/search-service.js'));
const metrics = require(resolve(root, 'extension/services/metrics-service.js'));
const html = require(resolve(root, 'extension/services/html-service.js'));
const tools = require(resolve(root, 'extension/services/tools-service.js'));
const workspace = require(resolve(root, 'extension/services/workspace-service.js'));
const workspacePlanner = require(resolve(root, 'extension/services/workspace-planner.js'));
const workspaceOperations = require(resolve(root, 'extension/services/workspace-operations.js'));
const dragController = require(resolve(root, 'extension/services/drag-controller.js'));
const organizationNav = require(resolve(root, 'extension/views/organization-nav.js'));
const workspaceView = require(resolve(root, 'extension/views/workspace-view.js'));
const windowView = require(resolve(root, 'extension/views/window-view.js'));

function makeFakeStorage(seed = {}) {
  const store = { ...seed };
  return {
    store,
    async get(keys) {
      if (keys == null) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(key => [key, store[key]]));
      }
      return Object.fromEntries(Object.keys(keys).map(key => [key, store[key] ?? keys[key]]));
    },
    async set(values) {
      Object.assign(store, values);
    },
    async getBytesInUse() {
      return JSON.stringify(store).length;
    },
  };
}

/** 为工作模型创建互相独立的长期和会话存储。 */
function makeWorkspaceStorage(localSeed = {}, sessionSeed = {}) {
  return {
    local: makeFakeStorage(localSeed),
    session: makeFakeStorage(sessionSeed),
  };
}

function testUrlService() {
  assert.equal(urls.isRestorableUrl('https://a.test'), true);
  assert.equal(urls.isRestorableUrl('http://a.test'), true);
  assert.equal(urls.isRestorableUrl('file:///Users/a.txt'), true);
  assert.equal(urls.normalizeRestorableUrl('https://a.test'), 'https://a.test/');
  assert.equal(urls.normalizeRestorableUrl('file:///Users/a.txt'), 'file:///Users/a.txt');

  for (const unsafeUrl of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://extensions', 'about:blank', '', 'not a url']) {
    assert.equal(urls.isRestorableUrl(unsafeUrl), false, unsafeUrl);
    assert.equal(urls.normalizeRestorableUrl(unsafeUrl), '', unsafeUrl);
  }
}

async function testTabsService() {
  assert.equal(tabs.isRealTab({ url: 'https://example.com', pinned: false }, 'ext'), true);
  assert.equal(tabs.isRealTab({ url: 'chrome://extensions', pinned: false }, 'ext'), false);
  assert.equal(tabs.isRealTab({ url: 'https://example.com', pinned: true }, 'ext'), false);

  assert.equal(tabs.normalizeTabFaviconUrl('https://internal.example.test/favicon.ico'), 'https://internal.example.test/favicon.ico');
  assert.equal(tabs.normalizeTabFaviconUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  for (const unsafeFaviconUrl of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://favicon/https://example.com', '', null]) {
    assert.equal(tabs.normalizeTabFaviconUrl(unsafeFaviconUrl), '', String(unsafeFaviconUrl));
  }

  const normalizedTab = tabs.normalizeTab({
    id: 8,
    url: 'https://internal.example.test/page',
    title: 'Internal',
    favIconUrl: 'https://internal.example.test/favicon.ico',
  }, 'ext');
  assert.equal(normalizedTab.favIconUrl, 'https://internal.example.test/favicon.ico');

  const ids = tabs.exactUnpinnedIdsForUrls([
    { id: 1, url: 'https://a.test', pinned: false },
    { id: 2, url: 'https://a.test', pinned: true },
    { id: 3, url: 'https://b.test', pinned: false },
  ], ['https://a.test']);
  assert.deepEqual(ids, [1]);

  const removed = [];
  global.chrome = {
    runtime: { id: 'ext' },
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://a.test', active: false, pinned: false },
          { id: 2, url: 'https://a.test', active: true, pinned: false },
          { id: 3, url: 'https://a.test', active: false, pinned: true },
        ];
      },
      async remove(idsToRemove) {
        removed.push(...idsToRemove);
      },
    },
  };

  await tabs.closeDuplicateTabs(['https://a.test'], true);
  assert.deepEqual(removed, [1]);

  removed.length = 0;
  global.chrome = {
    runtime: { id: 'ext' },
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://a.test', active: true, pinned: true },
          { id: 2, url: 'https://a.test', active: false, pinned: false },
          { id: 3, url: 'https://a.test', active: false, pinned: false },
        ];
      },
      async remove(idsToRemove) {
        removed.push(...idsToRemove);
      },
    },
  };

  await tabs.closeDuplicateTabs(['https://a.test'], true);
  assert.deepEqual(removed, [3]);

  removed.length = 0;
  const closedIds = await tabs.closeTabsByIds([2, 1, 99]);
  assert.deepEqual(closedIds, [2]);
  assert.deepEqual(removed, [2]);

  assert.deepEqual(tabs.normalizeSessionRestoreTabs({
    tabs: [
      { url: 'https://w1-0.test', windowId: 1, index: 0 },
      { url: 'javascript:alert(1)', windowId: 1, index: 99 },
      { url: 'https://w1-1.test', windowId: 1, index: 1 },
      { url: 'data:text/html,hi', windowId: 2, index: 99 },
      { url: 'https://w2-0.test', windowId: 2, index: 0 },
      { url: 'https://w2-1.test', windowId: 2, index: 1 },
    ],
  }).map(tab => tab.url), [
    'https://w1-0.test/',
    'https://w1-1.test/',
    'https://w2-0.test/',
    'https://w2-1.test/',
  ]);

  const createdWindows = [];
  const groupedTabSets = [];
  const updatedGroups = [];
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async create(options) {
        createdWindows.push(options);
        return {
          id: 7,
          tabs: options.url.map((url, index) => ({ id: index + 10, url, index })),
        };
      },
    },
    tabs: {
      async query() {
        return [
          { id: 10, url: 'https://docs.test/a', index: 0 },
          { id: 11, url: 'https://docs.test/b', index: 1 },
        ];
      },
      async group(options) {
        groupedTabSets.push(options.tabIds);
        return 21;
      },
    },
    tabGroups: {
      async update(groupId, update) {
        updatedGroups.push({ groupId, update });
      },
    },
  };

  const restored = await tabs.restoreSavedSession({
    group: 'Research',
    groupColor: 'blue',
    tabs: [
      { url: 'https://docs.test/a', title: 'A', index: 0, groupTitle: 'Research', groupColor: 'blue' },
      { url: 'https://docs.test/b', title: 'B', index: 1, groupTitle: 'Research', groupColor: 'blue' },
    ],
  });
  assert.deepEqual(createdWindows[0].url, ['https://docs.test/a', 'https://docs.test/b']);
  assert.deepEqual(groupedTabSets, [[10, 11]]);
  assert.deepEqual(updatedGroups, [{ groupId: 21, update: { title: 'Research', color: 'blue' } }]);
  assert.deepEqual(restored.groupIds, [21]);

  const createdTabs = [];
  const groupedCurrentWindowTabSets = [];
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async update() {},
    },
    tabs: {
      async query() {
        return [{ id: 5, url: 'chrome-extension://ext/index.html', active: true, index: 2 }];
      },
      async create(options) {
        const tab = { id: 30 + createdTabs.length, url: options.url, index: options.index };
        createdTabs.push(options);
        return tab;
      },
      async group(options) {
        groupedCurrentWindowTabSets.push(options.tabIds);
        return 31;
      },
    },
    tabGroups: {
      async update() {},
    },
  };

  await tabs.restoreSavedSession({
    group: 'Build',
    tabs: [
      { url: 'https://repo.test/issues', groupTitle: 'Build' },
      { url: 'https://repo.test/pulls', groupTitle: 'Build' },
    ],
  }, { windowId: 9, focused: false });
  assert.deepEqual(createdTabs.map(tab => ({ windowId: tab.windowId, active: tab.active, index: tab.index })), [
    { windowId: 9, active: false, index: 3 },
    { windowId: 9, active: false, index: 4 },
  ]);
  assert.deepEqual(groupedCurrentWindowTabSets, [[30, 31]]);

  const chromeCalls = { moves: [], windowsCreated: [], groupMoves: [], focused: [] };
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async getAll(options) {
        assert.deepEqual(options, { populate: true, windowTypes: ['normal'] });
        return [
          { id: 1, type: 'normal', focused: true, tabs: [{ id: 40, url: 'https://a.test', windowId: 1, index: 0 }] },
          { id: 2, type: 'popup', tabs: [{ id: 41, url: 'https://b.test', windowId: 2, index: 0 }] },
          { id: 3, type: 'normal', incognito: true, tabs: [] },
        ];
      },
      async create(options) {
        chromeCalls.windowsCreated.push(options);
        return { id: 8, type: 'normal' };
      },
      async update(windowId, options) {
        chromeCalls.focused.push([windowId, options]);
        return { id: windowId, ...options };
      },
      async get(windowId) {
        return { id: windowId, type: windowId === 2 ? 'popup' : 'normal', incognito: false };
      },
    },
    tabs: {
      async get(tabId) {
        if (tabId === 404) throw new Error('closed');
        return { id: tabId, url: `https://tab-${tabId}.test`, windowId: 1, index: tabId };
      },
      async move(tabIds, options) {
        chromeCalls.moves.push([tabIds, options]);
        return (Array.isArray(tabIds) ? tabIds : [tabIds]).map(id => ({ id, ...options }));
      },
    },
    tabGroups: {
      async move(groupId, options) {
        chromeCalls.groupMoves.push([groupId, options]);
        return { id: groupId, ...options };
      },
    },
  };
  assert.deepEqual((await tabs.fetchNormalWindows()).map(windowInfo => windowInfo.id), [1]);
  assert.deepEqual((await tabs.getTabsByIds([40, 404])).map(tab => [tab.id, tab.windowType]), [[40, 'normal']]);
  await tabs.moveTabs([40, 42], 9, 0);
  await tabs.createWindowFromTab(40);
  await tabs.moveTabGroup(7, 9, -1);
  await tabs.focusWindow(9);
  assert.deepEqual(chromeCalls.moves, [[[40, 42], { windowId: 9, index: 0 }]]);
  assert.deepEqual(chromeCalls.windowsCreated, [{ tabId: 40, type: 'normal', focused: false }]);
  assert.deepEqual(chromeCalls.groupMoves, [[7, { windowId: 9, index: -1 }]]);
  assert.deepEqual(chromeCalls.focused, [[9, { focused: true }]]);
}

/** 验证工作模型的版本、隐私边界、归属优先级与 CRUD 约束。 */
async function testWorkspaceService() {
  assert.equal(workspace.normalizePageUrl('https://a.test/p?q=1#old'), 'https://a.test/p?q=1');
  assert.equal(workspace.normalizePageUrl('javascript:alert(1)'), '');
  assert.equal((await workspace.createPageKey('https://a.test/p?q=1#old', webcrypto)).length, 64);
  assert.equal(
    await workspace.createPageKey('https://a.test/p?q=1#old', webcrypto),
    await workspace.createPageKey('https://a.test/p?q=1#new', webcrypto)
  );
  assert.notEqual(
    await workspace.createPageKey('https://a.test/p?q=1', webcrypto),
    await workspace.createPageKey('https://a.test/p?q=2', webcrypto)
  );
  assert.throws(
    () => workspace.normalizeState({ schemaVersion: workspace.SCHEMA_VERSION + 1, workspaces: [] }),
    /WORKSPACE_SCHEMA_NEWER_THAN_SUPPORTED/
  );

  let nextId = 0;
  const storageAreas = makeWorkspaceStorage();
  const service = workspace.createWorkspaceService({
    storage: storageAreas,
    cryptoApi: webcrypto,
    now: () => 1000,
    createId: () => `work-${++nextId}`,
  });
  const initialized = await service.initializeFromDomainGroups([
    { hostname: 'docs.test', tabs: [{ id: 1, url: 'https://docs.test/a#top' }] },
    { hostname: 'docs.test', tabs: [{ id: 2, url: 'https://docs.test/b' }] },
  ]);
  assert.equal(initialized.schemaVersion, 1);
  assert.deepEqual(initialized.workspaces.map(item => item.name), ['docs.test', 'docs.test 2']);
  assert.equal(Object.keys(initialized.pageAssignments).length, 2);
  assert.equal(JSON.stringify(storageAreas.local.store).includes('https://docs.test'), false);

  await service.initializeFromDomainGroups([
    { hostname: 'ignored.test', tabs: [{ id: 3, url: 'https://ignored.test' }] },
  ]);
  assert.equal((await service.load()).workspaces.length, 2);

  const project = await service.createWorkspace(' 项目 B ');
  assert.equal(project.name, '项目 B');
  await assert.rejects(() => service.createWorkspace('项目 b'), /WORKSPACE_NAME_DUPLICATE/);
  await assert.rejects(() => service.createWorkspace('  '), /WORKSPACE_NAME_REQUIRED/);

  await service.assignTab({ id: 2, url: 'https://docs.test/b#current' }, project.id);
  assert.equal((await service.resolveWorkspace({ id: 2, url: 'https://docs.test/b#other' })).id, project.id);
  assert.equal((await service.resolveWorkspace({ id: 20, url: 'https://docs.test/b#other' })).id, project.id);

  const originalWorkspaceId = initialized.workspaces[0].id;
  await service.assignTab({ id: 2, url: 'https://docs.test/a#second-instance' }, project.id);
  assert.equal((await service.resolveWorkspace({ id: 1, url: 'https://docs.test/a' })).id, originalWorkspaceId);
  assert.equal((await service.resolveWorkspace({ id: 2, url: 'https://docs.test/a' })).id, project.id);

  const organization = await service.buildOrganization([
    { id: 1, url: 'https://docs.test/a' },
    { id: 2, url: 'https://docs.test/a' },
    { id: 99, url: 'https://new.test/page' },
  ]);
  assert.equal(organization.workspaces.find(item => item.id === originalWorkspaceId).tabs.length, 1);
  assert.equal(organization.workspaces.find(item => item.id === project.id).tabs.length, 1);
  assert.deepEqual(organization.unassignedTabs.map(tab => tab.id), [99]);

  await service.renameWorkspace(project.id, '项目 C');
  assert.equal((await service.load()).workspaces.find(item => item.id === project.id).name, '项目 C');
  assert.equal(await service.deleteWorkspace(project.id), true);
  assert.equal(await service.resolveWorkspace({ id: 2, url: 'https://docs.test/a' }), null);
  await service.cleanupClosedTabs([1]);
  assert.deepEqual(Object.keys((await service.loadSession()).tabAssignments), ['1']);

  const fallbackService = workspace.createWorkspaceService({
    localArea: makeFakeStorage(),
    cryptoApi: webcrypto,
    createId: () => 'fallback-work',
  });
  await fallbackService.initializeFromDomainGroups([]);
  await fallbackService.createWorkspace('Fallback');
  assert.equal((await fallbackService.load()).workspaces.length, 1);

  const lockNames = [];
  const lockedService = workspace.createWorkspaceService({
    localArea: makeFakeStorage(),
    cryptoApi: webcrypto,
    createId: () => 'locked-work',
    lockManager: {
      async request(name, operation) {
        lockNames.push(name);
        return operation({ name });
      },
    },
  });
  await lockedService.initializeFromDomainGroups([]);
  await lockedService.createWorkspace('Locked');
  assert.deepEqual(lockNames, [workspace.WRITE_LOCK_NAME, workspace.WRITE_LOCK_NAME]);
}

/** 验证窗口规划使用全局最优匹配并严格保护特殊标签和混合组。 */
function testWorkspacePlanner() {
  const optimum = workspacePlanner.maximumWeightMatching([
    [3, 2],
    [2, 0],
  ]);
  assert.deepEqual(optimum.pairs, [[0, 1], [1, 0]]);
  assert.equal(optimum.score, 4);

  const plan = workspacePlanner.planWorkspaceWindows({
    workspaces: [{ id: 'a' }, { id: 'b' }],
    windows: [{ id: 1, type: 'normal' }, { id: 2, type: 'normal' }],
    tabs: [
      { id: 1, url: 'https://a.test/1', windowId: 1, index: 0, workspaceId: 'a', groupId: -1 },
      { id: 2, url: 'https://a.test/2', windowId: 2, index: 0, workspaceId: 'a', groupId: -1 },
      { id: 3, url: 'https://b.test/1', windowId: 1, index: 1, workspaceId: 'b', groupId: 7 },
      { id: 4, url: 'https://b.test/2', windowId: 1, index: 2, workspaceId: 'b', groupId: 7 },
      { id: 5, url: 'https://b.test/pinned', windowId: 2, index: 1, workspaceId: 'b', groupId: 7, pinned: true },
    ],
  });
  assert.deepEqual(plan.assignments.map(item => [item.workspaceId, item.windowId]), [['a', 2], ['b', 1]]);
  assert.deepEqual(plan.moves, [{ workspaceId: 'a', tabIds: [1], toWindowId: 2 }]);
  assert.equal(plan.summary.movedTabCount, 1);
  assert.equal(plan.summary.protectedTabCount, 1);
  assert.equal(plan.summary.splitGroupCount, 0);

  const pureGroupMove = workspacePlanner.planWorkspaceWindows({
    workspaces: [{ id: 'a' }, { id: 'b' }],
    windows: [{ id: 1, type: 'normal' }, { id: 2, type: 'normal' }],
    tabs: [
      { id: 101, url: 'https://a.test/group-1', windowId: 1, index: 0, workspaceId: 'a', groupId: 9 },
      { id: 102, url: 'https://a.test/group-2', windowId: 1, index: 1, workspaceId: 'a', groupId: 9 },
      { id: 103, url: 'https://a.test/3', windowId: 2, index: 0, workspaceId: 'a', groupId: -1 },
      { id: 104, url: 'https://a.test/4', windowId: 2, index: 1, workspaceId: 'a', groupId: -1 },
      { id: 105, url: 'https://a.test/5', windowId: 2, index: 2, workspaceId: 'a', groupId: -1 },
      { id: 106, url: 'https://b.test/1', windowId: 1, index: 2, workspaceId: 'b', groupId: -1 },
      { id: 107, url: 'https://b.test/2', windowId: 1, index: 3, workspaceId: 'b', groupId: -1 },
      { id: 108, url: 'https://b.test/3', windowId: 1, index: 4, workspaceId: 'b', groupId: -1 },
      { id: 109, url: 'https://b.test/4', windowId: 1, index: 5, workspaceId: 'b', groupId: -1 },
    ],
  });
  assert.deepEqual(pureGroupMove.groupMoves, [{ workspaceId: 'a', groupId: 9, tabIds: [101, 102], toWindowId: 2 }]);
  assert.equal(pureGroupMove.moves.length, 0);

  const mixedWithInbox = workspacePlanner.planWorkspaceWindows({
    workspaces: [{ id: 'a' }],
    windows: [{ id: 1, type: 'normal' }, { id: 2, type: 'normal' }],
    tabs: [
      { id: 110, url: 'https://a.test', windowId: 1, index: 0, workspaceId: 'a', groupId: 10 },
      { id: 111, url: 'https://inbox.test', windowId: 1, index: 1, workspaceId: null, groupId: 10 },
      { id: 112, url: 'https://a.test/keep', windowId: 2, index: 0, workspaceId: 'a', groupId: -1 },
      { id: 113, url: 'https://a.test/keep-2', windowId: 2, index: 1, workspaceId: 'a', groupId: -1 },
    ],
  });
  assert.deepEqual(mixedWithInbox.groupMoves, []);
  assert.deepEqual(mixedWithInbox.moves[0].tabIds, [110]);
  assert.equal(mixedWithInbox.summary.splitGroupCount, 1);

  const needsWindow = workspacePlanner.planWorkspaceWindows({
    workspaces: [{ id: 'a' }, { id: 'b' }],
    windows: [{ id: 1, type: 'normal' }],
    tabs: [
      { id: 10, url: 'https://a.test', windowId: 1, index: 0, workspaceId: 'a', groupId: -1 },
      { id: 20, url: 'https://b.test', windowId: 1, index: 1, workspaceId: 'b', groupId: -1 },
    ],
  });
  assert.equal(needsWindow.summary.newWindowCount, 1);
  assert.equal(needsWindow.newWindows[0].remainingTabIds.length, 0);

  const pureGroupTabs = [
    { id: 30, url: 'https://a.test/1', groupId: 9, workspaceId: 'a' },
    { id: 31, url: 'https://a.test/2', groupId: 9, workspaceId: 'a' },
  ];
  assert.equal(workspacePlanner.findReusableGroup(pureGroupTabs, pureGroupTabs), 9);
  assert.equal(workspacePlanner.findReusableGroup(pureGroupTabs, [
    ...pureGroupTabs,
    { id: 32, url: 'https://b.test', groupId: 9, workspaceId: 'b' },
  ]), null);
  assert.equal(workspacePlanner.findReusableGroup([
    { ...pureGroupTabs[0], groupId: 9 },
    { ...pureGroupTabs[1], groupId: 10 },
  ]), null);
  assert.equal(workspacePlanner.getProtectedReason({ id: 1, url: 'chrome://settings' }), 'internal');
  assert.equal(workspacePlanner.getProtectedReason({ id: 1, url: 'data:text/plain,private' }), 'internal');
  assert.equal(workspacePlanner.getProtectedReason({ id: 1, url: 'https://a.test', windowType: 'popup' }), 'window-type');

  const unrelatedMixedGroup = workspacePlanner.planWorkspaceWindows({
    workspaces: [{ id: 'a' }, { id: 'b' }],
    windows: [{ id: 1, type: 'normal' }, { id: 2, type: 'normal' }],
    tabs: [
      { id: 201, url: 'https://a.test/1', windowId: 1, index: 0, workspaceId: 'a', groupId: 20 },
      { id: 202, url: 'https://a.test/2', windowId: 1, index: 1, workspaceId: 'a', groupId: -1 },
      { id: 203, url: 'https://inbox.test', windowId: 1, index: 2, workspaceId: null, groupId: 20 },
      { id: 204, url: 'https://b.test/move', windowId: 1, index: 3, workspaceId: 'b', groupId: -1 },
      { id: 205, url: 'https://b.test/keep-1', windowId: 2, index: 0, workspaceId: 'b', groupId: -1 },
      { id: 206, url: 'https://b.test/keep-2', windowId: 2, index: 1, workspaceId: 'b', groupId: -1 },
      { id: 207, url: 'https://popup.test', windowId: 3, index: 0, workspaceId: 'b', groupId: -1 },
      { id: 208, url: 'data:text/plain,private', windowId: 2, index: 2, workspaceId: 'b', groupId: -1 },
    ],
  });
  assert.deepEqual(unrelatedMixedGroup.moves, [{ workspaceId: 'b', tabIds: [204], toWindowId: 2 }]);
  assert.equal(unrelatedMixedGroup.summary.protectedTabCount, 2);
  assert.equal(unrelatedMixedGroup.summary.splitGroupCount, 0);
}

/** 验证真实 Chrome 操作被串行执行，并能基于最小快照撤销。 */
async function testWorkspaceOperations() {
  const tabState = new Map([
    [1, { id: 1, url: 'https://one.test', windowId: 1, index: 0, groupId: -1 }],
    [2, { id: 2, url: 'https://two.test', windowId: 1, index: 1, groupId: -1 }],
  ]);
  const calls = [];
  const groupState = new Map();
  let nextCreatedWindowId = 8;
  let undoEntry = null;
  const tabsService = {
    async getTabsByIds(tabIds) {
      return tabIds.map(tabId => tabState.get(tabId)).filter(Boolean).map(tab => ({ ...tab }));
    },
    async moveTabs(tabIds, windowId, index) {
      calls.push(['moveTabs', [...tabIds], windowId, index]);
      tabIds.forEach((tabId, offset) => tabState.set(tabId, { ...tabState.get(tabId), windowId, index: index < 0 ? offset : index + offset }));
      return tabIds.map(tabId => tabState.get(tabId));
    },
    async createWindowFromTab(tabId) {
      calls.push(['createWindowFromTab', tabId]);
      const windowId = nextCreatedWindowId++;
      tabState.set(tabId, { ...tabState.get(tabId), windowId, index: 0 });
      return { id: windowId };
    },
    async moveTabGroup(groupId, windowId) {
      calls.push(['moveTabGroup', groupId, windowId]);
      tabState.forEach((tab, tabId) => {
        if (tab.groupId === groupId) tabState.set(tabId, { ...tab, windowId });
      });
    },
    async groupTabs(tabIds, options) {
      calls.push(['groupTabs', [...tabIds], options]);
      const groupId = options?.groupId ?? 12;
      tabIds.forEach(tabId => tabState.set(tabId, { ...tabState.get(tabId), groupId }));
      const currentGroup = groupState.get(groupId) || { id: groupId, title: '', color: 'grey', collapsed: false };
      groupState.set(groupId, {
        ...currentGroup,
        ...(options?.title !== undefined ? { title: options.title } : {}),
        ...(options?.color !== undefined ? { color: options.color } : {}),
        ...(options?.collapsed !== undefined ? { collapsed: options.collapsed } : {}),
      });
      return groupId;
    },
    async ungroupTabs(tabIds) {
      calls.push(['ungroupTabs', [...tabIds]]);
      tabIds.forEach(tabId => tabState.set(tabId, { ...tabState.get(tabId), groupId: -1 }));
    },
    async fetchOpenTabs() {
      return [...tabState.values()].map(tab => ({ ...tab }));
    },
    async fetchTabGroups() {
      return [...groupState.values()].map(group => ({ ...group }));
    },
    async updateGroup(groupId, options) {
      calls.push(['updateGroup', groupId, options]);
      groupState.set(groupId, { ...(groupState.get(groupId) || { id: groupId }), ...options });
      return groupState.get(groupId);
    },
  };
  const undoStore = {
    async getUndoEntry() { return undoEntry; },
    async setUndoEntry(value) { undoEntry = value; },
  };
  const operations = workspaceOperations.createWorkspaceOperations({ tabsService, undoStore, now: () => 5000 });
  const result = await operations.executeWindowPlan({ moves: [{ workspaceId: 'a', tabIds: [2, 404], toWindowId: 9 }] });
  assert.equal(result.movedTabCount, 1);
  assert.deepEqual(result.skippedTabIds, [404]);
  assert.equal(tabState.get(2).windowId, 9);
  assert.equal(undoEntry.kind, 'window-plan');
  assert.equal(JSON.stringify(undoEntry).includes('https://'), false);

  const undone = await operations.undo();
  assert.equal(undone.restoredTabCount, 1);
  assert.equal(tabState.get(2).windowId, 1);
  assert.equal(undoEntry, null);

  const nativeGroup = await operations.createNativeGroupForWorkspace({
    workspace: { id: 'a', name: '项目 A' },
    tabs: [tabState.get(1), tabState.get(2)],
    targetWindowId: 1,
  });
  assert.equal(nativeGroup.groupId, 12);
  assert.equal(tabState.get(1).groupId, 12);
  await operations.undo();
  assert.equal(tabState.get(1).groupId, -1);
  assert.equal(tabState.get(2).groupId, -1);

  tabState.set(2, { ...tabState.get(2), pinned: true });
  const protectedMove = await operations.executeWindowPlan({ moves: [{ tabIds: [2], toWindowId: 7 }] });
  assert.equal(protectedMove.movedTabCount, 0);
  assert.deepEqual(protectedMove.skippedTabIds, [2]);
  tabState.set(2, { ...tabState.get(2), pinned: false });

  tabState.set(1, { ...tabState.get(1), groupId: 9 });
  tabState.set(2, { ...tabState.get(2), groupId: 9 });
  groupState.set(9, { id: 9, title: '原始组名', color: 'red', collapsed: true });
  const groupMove = await operations.executeWindowPlan({
    groupMoves: [{ workspaceId: 'a', groupId: 9, tabIds: [1, 2], toWindowId: 7 }],
  });
  assert.equal(groupMove.movedTabCount, 2);
  assert.equal(tabState.get(1).windowId, 7);
  assert.equal(calls.some(call => call[0] === 'moveTabGroup' && call[1] === 9), true);
  await operations.undo();
  assert.equal(tabState.get(1).windowId, 1);
  assert.equal(tabState.get(1).groupId, 9);
  assert.deepEqual(groupState.get(9), { id: 9, title: '原始组名', color: 'red', collapsed: true });

  const sameWindowGroupMoveCount = calls.filter(call => call[0] === 'moveTabGroup').length;
  const reusedGroup = await operations.createNativeGroupForWorkspace({
    workspace: { id: 'a', name: '项目 A' },
    tabs: [tabState.get(1), tabState.get(2)],
    targetWindowId: 1,
    reusableGroupId: 9,
  });
  assert.equal(reusedGroup.groupId, 9);
  assert.equal(calls.filter(call => call[0] === 'moveTabGroup').length, sameWindowGroupMoveCount);
  assert.equal(groupState.get(9).title, '项目 A');
  await operations.undo();
  assert.deepEqual(groupState.get(9), { id: 9, title: '原始组名', color: 'red', collapsed: true });

  tabState.set(3, { id: 3, url: 'https://inbox.test', windowId: 1, index: 2, groupId: 9 });
  const impureGroupMoveCount = calls.filter(call => call[0] === 'moveTabGroup').length;
  const impureReuse = await operations.createNativeGroupForWorkspace({
    workspace: { id: 'a', name: '项目 A' },
    tabs: [tabState.get(1), tabState.get(2)],
    targetWindowId: 7,
    reusableGroupId: 9,
  });
  assert.equal(impureReuse.groupId, 12);
  assert.equal(calls.filter(call => call[0] === 'moveTabGroup').length, impureGroupMoveCount);
  assert.equal(calls.filter(call => call[0] === 'groupTabs').at(-1)[2].groupId, undefined);
  assert.equal(tabState.get(3).windowId, 1);
  await operations.undo();

  const groupMoveCallCount = calls.filter(call => call[0] === 'moveTabGroup').length;
  await operations.executeWindowPlan({
    groupMoves: [{ workspaceId: 'a', groupId: 9, tabIds: [1, 2], toWindowId: 7 }],
  });
  assert.equal(calls.filter(call => call[0] === 'moveTabGroup').length, groupMoveCallCount);
  assert.equal(tabState.get(3).windowId, 1);
  await operations.undo();
  tabState.delete(3);

  const created = await operations.executeWindowPlan({
    newWindows: [{ workspaceId: 'a', seedTabId: 1, remainingTabIds: [2] }],
  });
  assert.equal(created.createdWindowIds[0], 8);
  assert.equal(tabState.get(1).windowId, 8);
  assert.equal(tabState.get(2).windowId, 8);
  await operations.undo();
  assert.equal(tabState.get(1).windowId, 1);
  assert.equal(tabState.get(2).windowId, 1);

  const createCallCount = calls.filter(call => call[0] === 'createWindowFromTab').length;
  const closedCreate = await operations.executeWindowPlan({
    newWindows: [{ seedTabId: 404, remainingTabIds: [] }],
  });
  assert.deepEqual(closedCreate.skippedTabIds, [404]);
  assert.equal(calls.filter(call => call[0] === 'createWindowFromTab').length, createCallCount);

  tabState.set(2, { ...tabState.get(2), pinned: true });
  const protectedCreate = await operations.executeWindowPlan({
    newWindows: [{ seedTabId: 2, remainingTabIds: [] }],
  });
  assert.deepEqual(protectedCreate.skippedTabIds, [2]);
  assert.equal(calls.filter(call => call[0] === 'createWindowFromTab').length, createCallCount);
  tabState.set(2, { ...tabState.get(2), pinned: false });

  let validationReadCount = 0;
  const pinDuringValidationService = {
    ...tabsService,
    async getTabsByIds(tabIds) {
      const snapshotTabs = await tabsService.getTabsByIds(tabIds);
      validationReadCount += 1;
      if (validationReadCount === 1) tabState.set(1, { ...tabState.get(1), pinned: true });
      return snapshotTabs;
    },
  };
  const pinDuringValidationOperations = workspaceOperations.createWorkspaceOperations({ tabsService: pinDuringValidationService, undoStore });
  const stalePinnedCreate = await pinDuringValidationOperations.executeWindowPlan({
    newWindows: [{ seedTabId: 1, remainingTabIds: [] }],
  });
  assert.deepEqual(stalePinnedCreate.skippedTabIds, [1]);
  assert.equal(calls.filter(call => call[0] === 'createWindowFromTab').length, createCallCount);
  tabState.set(1, { ...tabState.get(1), pinned: false });

  const firstSingleCreate = await operations.executeWindowPlan({ newWindows: [{ seedTabId: 1, remainingTabIds: [] }] });
  const secondSingleCreate = await operations.executeWindowPlan({ newWindows: [{ seedTabId: 2, remainingTabIds: [] }] });
  assert.deepEqual([firstSingleCreate.createdWindowIds[0], secondSingleCreate.createdWindowIds[0]], [9, 10]);
  tabState.set(1, { ...tabState.get(1), windowId: 10 });
  await operations.undo();
  assert.equal(tabState.get(2).windowId, 1);
  assert.equal(tabState.get(1).windowId, 10);
  tabState.set(1, { ...tabState.get(1), windowId: 1, index: 0 });

  let releaseMove;
  const blockedTabsService = {
    ...tabsService,
    async moveTabs() {
      await new Promise(resolvePromise => { releaseMove = resolvePromise; });
    },
  };
  const lockedOperations = workspaceOperations.createWorkspaceOperations({ tabsService: blockedTabsService, undoStore });
  const pending = lockedOperations.executeWindowPlan({ moves: [{ tabIds: [1], toWindowId: 7 }] });
  await Promise.resolve();
  await assert.rejects(
    () => lockedOperations.executeWindowPlan({ moves: [{ tabIds: [2], toWindowId: 7 }] }),
    /ORGANIZATION_OPERATION_IN_PROGRESS/
  );
  releaseMove();
  await pending;
  assert.equal(calls.some(call => call[0] === 'moveTabs'), true);

  let releaseCreate;
  let signalCreateStarted;
  const createStarted = new Promise(resolvePromise => { signalCreateStarted = resolvePromise; });
  const blockedCreateService = {
    ...tabsService,
    async createWindowFromTab(tabId) {
      signalCreateStarted();
      await new Promise(resolvePromise => { releaseCreate = resolvePromise; });
      return tabsService.createWindowFromTab(tabId);
    },
  };
  const lockedCreateOperations = workspaceOperations.createWorkspaceOperations({ tabsService: blockedCreateService, undoStore });
  const pendingCreate = lockedCreateOperations.executeWindowPlan({ newWindows: [{ seedTabId: 1, remainingTabIds: [] }] });
  await createStarted;
  await assert.rejects(
    () => lockedCreateOperations.executeWindowPlan({ newWindows: [{ seedTabId: 2, remainingTabIds: [] }] }),
    /ORGANIZATION_OPERATION_IN_PROGRESS/
  );
  releaseCreate();
  await pendingCreate;
  await lockedCreateOperations.undo();

  const failingCreateService = {
    ...tabsService,
    async createWindowFromTab() {
      throw new Error('simulated create failure');
    },
  };
  const failingCreateOperations = workspaceOperations.createWorkspaceOperations({ tabsService: failingCreateService, undoStore });
  const failedCreate = await failingCreateOperations.executeWindowPlan({
    newWindows: [{ seedTabId: 1, remainingTabIds: [] }],
  });
  assert.equal(failedCreate.movedTabCount, 0);
  assert.equal(failedCreate.compensated, true);
  assert.equal(failedCreate.errors[0].message, 'simulated create failure');
  assert.equal(tabState.get(1).windowId, 1);

  const unavailableOperations = workspaceOperations.createWorkspaceOperations({
    tabsService,
    undoStore,
    lockManager: { async request(_name, _options, operation) { return operation(null); } },
  });
  await assert.rejects(
    () => unavailableOperations.executeWindowPlan({ moves: [{ tabIds: [1], toWindowId: 7 }] }),
    /ORGANIZATION_OPERATION_IN_PROGRESS/
  );

  const failingTabsService = {
    ...tabsService,
    async moveTabs(tabIds, windowId, index) {
      tabIds.forEach(tabId => tabState.set(tabId, { ...tabState.get(tabId), windowId, index }));
      if (windowId === 9) throw new Error('simulated move failure');
    },
  };
  tabState.set(2, { id: 2, url: 'https://two.test', windowId: 1, index: 1, groupId: -1 });
  const failingOperations = workspaceOperations.createWorkspaceOperations({ tabsService: failingTabsService, undoStore });
  const failed = await failingOperations.executeWindowPlan({ moves: [{ tabIds: [2], toWindowId: 9 }] });
  assert.equal(failed.movedTabCount, 0);
  assert.equal(failed.compensated, true);
  assert.equal(failed.errors[0].message, 'simulated move failure');
  assert.equal(tabState.get(2).windowId, 1);
}

/** 验证新增组织视图保持纯渲染、完整实例和安全转义。 */
function testOrganizationViews() {
  assert.deepEqual(organizationNav.resolveOrganizationPreferences({ legacyView: 'group' }), {
    activeView: 'workspace',
    activeWorkspaceView: 'chrome-groups',
  });
  assert.deepEqual(organizationNav.resolveOrganizationPreferences({ storedView: 'broken', legacyView: 'group' }), {
    activeView: 'domain',
    activeWorkspaceView: 'arrange',
  });
  const navHtml = organizationNav.renderOrganizationNav({ activeView: 'workspace', activeWorkspaceView: 'chrome-groups' });
  assert.match(navHtml, /data-organization-view="domain"/);
  assert.match(navHtml, /data-organization-view="workspace" aria-selected="true"/);
  assert.match(navHtml, /data-organization-view="window"/);
  assert.match(navHtml, /data-organization-view="shortcuts"/);
  assert.equal(organizationNav.resolveOrganizationPreferences({ storedView: 'shortcuts' }).activeView, 'shortcuts');
  assert.match(navHtml, /Chrome 标签组/);

  const workspaceHtml = workspaceView.renderWorkspaceView({
    workspaces: [{ id: 'a', name: '<项目 A>', tabs: [{ id: 1, title: '<script>', url: 'https://a.test/p' }] }],
    unassignedGroups: [{ domain: 'b.test', tabs: [{ id: 2, title: 'B', url: 'https://b.test' }] }],
  });
  assert.match(workspaceHtml, /&lt;项目 A&gt;/);
  assert.doesNotMatch(workspaceHtml, /<script>/);
  assert.match(workspaceHtml, /data-drop-target-id="workspace:a"/);
  assert.match(workspaceHtml, /data-action="move-tab-menu"/);
  assert.equal((workspaceHtml.match(/data-action="close-tab-id"/g) || []).length, 2);
  assert.match(workspaceHtml, /data-action="close-tab-id"\s+data-tab-id="1"/);
  assert.match(workspaceHtml, /data-action="close-tab-id"\s+data-tab-id="2"/);
  assert.match(workspaceHtml, /class="organization-tab-focus" data-action="focus-tab-id"/);
  assert.doesNotMatch(workspaceHtml, /<article[^>]+data-action="focus-tab-id"/);
  assert.match(workspaceHtml, /待整理/);
  // Regression: 组织卡片不能使用全局 header 元素，否则窄屏页头规则会把卡片标题强制竖排。
  assert.doesNotMatch(workspaceHtml, /<header class="organization-card-header"/);

  const windowsHtml = windowView.renderWindowView({
    windows: [{
      id: 7,
      focused: true,
      tabs: [
        { id: 10, title: 'A1', url: 'https://same.test', pinned: false },
        { id: 11, title: 'A2', url: 'https://same.test', pinned: false },
        { id: 12, title: 'Pinned', url: 'https://pinned.test', pinned: true },
        { id: 13, title: 'Transient blank page', url: '', pinned: false },
      ],
    }],
  });
  assert.equal((windowsHtml.match(/data-action="focus-tab-id"/g) || []).length, 2);
  assert.equal((windowsHtml.match(/data-action="close-tab-id"/g) || []).length, 2);
  assert.match(windowsHtml, /data-action="close-tab-id"\s+data-tab-id="10"/);
  assert.match(windowsHtml, /data-action="close-tab-id"\s+data-tab-id="11"/);
  assert.equal((windowsHtml.match(/draggable="true"/g) || []).length, 2);
  assert.match(windowsHtml, /1 个置顶标签保持原位/);
  assert.doesNotMatch(windowsHtml, /Transient blank page/);
  assert.doesNotMatch(windowsHtml, /<header class="organization-card-header"/);

  const virtualTargetHtml = windowView.renderWindowView({
    windows: [{ id: 7, focused: false, tabs: [] }],
    labels: { newWindow: '<新窗口>', dropToCreateWindow: '拖到 & 这里' },
  });
  assert.equal((virtualTargetHtml.match(/data-drop-target-id="window:new"/g) || []).length, 1);
  assert.equal((virtualTargetHtml.match(/data-drop-target-id="window:7"/g) || []).length, 1);
  assert.doesNotMatch(virtualTargetHtml.match(/<section[^>]*data-drop-target-id="window:new"[^>]*>/)?.[0] || '', /data-window-id=/);
  assert.match(virtualTargetHtml, /&lt;新窗口&gt;/);
  assert.match(virtualTargetHtml, /拖到 &amp; 这里/);

  const emptyWindowViewHtml = windowView.renderWindowView({ windows: [] });
  assert.equal((emptyWindowViewHtml.match(/data-drop-target-id="window:new"/g) || []).length, 1);

  const extensionCss = readFileSync(resolve(root, 'extension/style.css'), 'utf8');
  assert.match(virtualTargetHtml, /class="[^"]*window-new-target[^"]*"/);
  assert.match(extensionCss, /\.window-new-target\s*\{/);
  assert.match(extensionCss, /\.window-new-target\s*\{[^}]*border[^;]*dashed/s);
  assert.match(extensionCss, /\.window-new-target\.is-drop-target/);

  const appSource = readFileSync(resolve(root, 'extension/app.js'), 'utf8');
  assert.doesNotMatch(appSource, /data-action="close-single-tab"/);
  assert.match(appSource, /if \(action === 'close-tab-id'\)/);
  assert.match(appSource, /await closeTabsByIds\(\[tabId\]\)/);
  assert.match(appSource, /targetId === 'window:new'/);
  assert.match(appSource, /async function moveTabToNewWindow\(tabId\)/);
  assert.match(appSource, /newWindows:\s*\[\{\s*seedTabId:\s*tabId,\s*remainingTabIds:\s*\[\]\s*\}\]/s);
  assert.match(appSource, /toastMovedToNewWindow/);
  assert.match(appSource, /\{ id: NEW_WINDOW_PROMPT_TARGET_ID, label: tr\('newWindow'\) \}/);
  assert.match(appSource, /selected\.id === NEW_WINDOW_PROMPT_TARGET_ID[\s\S]*moveTabToNewWindow\(tabId\)/);
}

/** 验证拖拽控制器的门闩、目标校验和监听器生命周期。 */
function testDragController() {
  const listeners = new Map();
  const root = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector() { return null; },
  };
  const states = [];
  const drops = [];
  const controller = dragController.createDragController({
    root,
    onDrop: detail => drops.push(detail),
    onDragStateChange: active => states.push(active),
  });
  controller.attach();
  controller.attach();
  assert.equal(listeners.size, 4);

  const rowClasses = new Set();
  const row = {
    dataset: { tabId: '3', sourceId: 'workspace:a' },
    classList: { add: value => rowClasses.add(value), remove: value => rowClasses.delete(value) },
  };
  const dataTransfer = { setData() {}, effectAllowed: '' };
  controller.handleDragStart({ target: { closest: () => row }, dataTransfer });
  assert.deepEqual(states, [true]);
  assert.equal(dataTransfer.effectAllowed, 'move');

  const targetClasses = new Set();
  const target = {
    dataset: { dropTargetId: 'workspace:b' },
    classList: { add: value => targetClasses.add(value), remove: value => targetClasses.delete(value) },
  };
  let prevented = false;
  controller.handleDragOver({ target: { closest: () => target }, preventDefault: () => { prevented = true; } });
  controller.handleDrop({ target: { closest: () => target }, preventDefault() {} });
  assert.equal(prevented, true);
  assert.deepEqual(drops, [{ tabId: 3, sourceId: 'workspace:a', targetId: 'workspace:b' }]);
  controller.handleDragEnd();
  assert.deepEqual(states, [true, false]);
  assert.equal(targetClasses.has('is-drop-target'), false);
  controller.detach();
  assert.equal(listeners.size, 0);
}

async function testStorageService() {
  const freshStorage = makeFakeStorage();
  global.chrome = { storage: { local: freshStorage } };
  await storage.migrateStorage();
  assert.equal(freshStorage.store.viewMode, 'domain');

  const fakeStorage = makeFakeStorage({
    deferred: [
      { url: 'https://a.test', title: 'A' },
      { url: 'javascript:alert(1)', title: 'Bad' },
      { url: 'file:///Users/local-note.txt', title: 'Local note' },
      { title: 'Missing URL' },
    ],
    viewMode: 'bad',
    privacySettings: { clock: false, mottoText: 'Focus' },
    savedSessions: [
      {
        id: 'session-1',
        name: 'MV3 research',
        group: 'Extensions',
        groupColor: 'cyan',
        tabs: [
          {
            title: 'Side Panel',
            url: 'https://developer.chrome.com/docs/extensions',
            windowId: 1,
            index: 3,
            groupTitle: 'Extensions',
            groupColor: 'cyan',
          },
          {
            title: 'Unsafe',
            url: 'javascript:alert(1)',
            windowId: 1,
            index: 4,
          },
          {
            title: 'Local notes',
            url: 'file:///Users/local-notes.md',
            windowId: 1,
            index: 5,
            groupTitle: 'Extensions',
            groupColor: 'cyan',
          },
        ],
      },
    ],
  });

  global.chrome = { storage: { local: fakeStorage } };
  const migration = await storage.migrateStorage();
  assert.equal(migration.changed, true);
  assert.equal(fakeStorage.store.storageSchemaVersion, storage.CURRENT_SCHEMA_VERSION);
  assert.equal(fakeStorage.store.deferred.length, 2);
  assert.equal(fakeStorage.store.savedSessions.length, 1);
  assert.equal(fakeStorage.store.viewMode, 'domain');
  assert.deepEqual(fakeStorage.store.privacySettings, {
    clock: false,
    date: true,
    motto: true,
    mottoText: 'Focus',
    externalFavicons: true,
  });

  await storage.addDeferredTab({ url: 'https://b.test', title: 'B' });
  assert.equal(await storage.addDeferredTab({ url: 'data:text/html,hi', title: 'Bad' }), false);
  const saved = await storage.getSavedTabs();
  assert.equal(saved.active.length, 3);
  assert.equal(saved.active.some(tab => tab.url === 'file:///Users/local-note.txt'), true);
  assert.equal(saved.active.some(tab => tab.url.startsWith('javascript:')), false);
  await storage.updateDeferredTab(saved.active[0].id, { completed: true, completedAt: '2026-04-30T00:00:00.000Z' });
  const afterUpdate = await storage.getSavedTabs();
  assert.equal(afterUpdate.archived.length, 1);
  assert.equal(await storage.clearArchivedDeferredTabs(), 1);
  const afterArchiveClear = await storage.getSavedTabs();
  assert.equal(afterArchiveClear.archived.length, 0);
  assert.equal(afterArchiveClear.active.length, 2);
  const storedSession = (await storage.getSavedSessions())[0];
  assert.equal(storedSession.name, 'MV3 research');
  assert.equal(storedSession.groupColor, 'cyan');
  assert.equal(storedSession.tabs[0].groupColor, 'cyan');
  assert.equal(storedSession.tabs[0].index, 3);
  assert.equal(storedSession.tabs.length, 2);
  assert.equal(storedSession.tabs.some(tab => tab.url === 'file:///Users/local-notes.md'), true);
  assert.equal(storedSession.tabs.some(tab => tab.url.startsWith('javascript:')), false);
  await storage.addSavedSession({ name: 'Focus set', urls: ['https://focus.test'] });
  assert.equal((await storage.getSavedSessions())[0].name, 'Focus set');
  assert.equal(await storage.addSavedSession({ name: 'Unsafe set', urls: ['chrome://extensions'] }), false);
  assert.equal(await storage.removeSavedSession('session-1'), true);
  assert.equal((await storage.getSavedSessions()).some(session => session.id === 'session-1'), false);
  const stats = await storage.recordActivity({ type: 'closed', count: 3, domain: 'example.com' });
  assert.equal(stats.closedTotal, 3);
  assert.equal(stats.domains['example.com'], 3);

  const futureStorage = makeFakeStorage({ storageSchemaVersion: storage.CURRENT_SCHEMA_VERSION + 1 });
  global.chrome = { storage: { local: futureStorage } };
  const futureMigration = await storage.migrateStorage();
  assert.equal(futureMigration.forwardVersion, true);
  assert.equal(futureStorage.store.storageSchemaVersion, storage.CURRENT_SCHEMA_VERSION + 1);
}

function testSearchService() {
  const index = search.buildSearchIndex({
    tabs: [
      { id: 1, title: 'GitHub Pull Request', url: 'https://github.com/org/repo/pull/1', groupId: 10 },
      { id: 2, title: 'Docs', url: 'https://developer.mozilla.org/en-US/docs', groupId: -1 },
    ],
    tabGroups: [{ id: 10, title: 'Work' }],
    savedTabs: [{ id: 's1', title: 'Read later', url: 'https://example.com/article' }],
    savedSessions: [{
      id: 'session-1',
      name: 'Chrome MV3 references',
      tabs: [
        { title: 'Side Panel', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel', groupTitle: 'Extensions' },
      ],
    }],
  });

  assert.equal(search.searchIndex(index, 'gthb')[0].title, 'GitHub Pull Request');
  assert.equal(search.searchIndex(index, 'domain:github work').length, 1);
  assert.equal(search.searchIndex(index, 'saved:true').some(record => record.title === 'Read later'), true);
  assert.equal(search.searchIndex(index, 'url:mozilla')[0].title, 'Docs');
  assert.equal(search.searchIndex(index, 'saved:true group:extensions')[0].type, 'session');
  assert.equal(search.searchIndex(index, 'domain:chrome sidepanel')[0].type, 'session');
  assert.deepEqual(search.getHighlightSegments('GitHub Pull Request', 'git pull').filter(s => s.match).map(s => s.text), ['Git', 'Pull']);
}

function testMetricsService() {
  const health = metrics.calculateTabHealth([
    { url: 'https://a.test', groupId: -1 },
    { url: 'https://a.test', groupId: -1 },
    { url: 'https://b.test', groupId: 2 },
  ]);
  assert.equal(health.duplicateExtras, 1);
  assert.equal(health.tabCount, 3);
  assert.equal(health.score < 100, true);
  const summary = metrics.summarizeActivity({
    weekly: { '2026-W18': { closed: 4, saved: 2, duplicateClosed: 1, sessionsSaved: 1 } },
    domains: { 'b.test': 1, 'a.test': 3 },
  });
  assert.equal(summary.closedThisWeek, 4);
  assert.equal(summary.topDomains[0].domain, 'a.test');
  assert.deepEqual(metrics.evaluateAchievements({ closedTotal: 10, sessionsSavedTotal: 1 }, { score: 95, tabCount: 4 }), ['closed-10', 'session-saver', 'calm-deck']);
}

function testHtmlService() {
  assert.equal(
    html.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
}

async function testToolsService() {
  assert.equal(tools.searchTools('json', { lang: 'en' })[0].id, 'json');
  assert.equal(tools.searchTools('二维码', { lang: 'zh' })[0].id, 'qr');
  const jsonTool = tools.getTool('json', { lang: 'en' });
  assert.equal(jsonTool.icon, 'json-tree');
  assert.equal(jsonTool.categoryLabel, 'Format');
  assert.equal(jsonTool.examples.length > 0, true);
  assert.deepEqual(
    tools.getTools({ lang: 'en' }).map(tool => tool.icon),
    ['json-tree', 'qr-grid', 'time-ruler', 'url-search', 'codec-arrows', 'id-key', 'fingerprint-hash', 'cookie-kv', 'session-export']
  );
  assert.equal(tools.getToolIconSvg('qr-grid').includes('data-tool-icon="qr-grid"'), true);
  assert.equal(tools.getToolIconSvg('missing').includes('data-tool-icon="tool-default"'), true);

  const formatted = await tools.runTool('json', '{"b":2,"a":1}', { action: 'format' });
  assert.equal(formatted.ok, true);
  assert.equal(formatted.output.includes('\n  "b": 2'), true);
  assert.equal(formatted.visual.type, 'json-tree');
  assert.equal(formatted.visual.tree.type, 'object');
  const minified = await tools.runTool('json', '{ "a": 1 }', { action: 'minify' });
  assert.equal(minified.output, '{"a":1}');
  const invalidJson = await tools.runTool('json', '{bad', { action: 'validate' });
  assert.equal(invalidJson.ok, false);
  assert.equal(typeof invalidJson.diagnostics.message, 'string');

  const parsedUrl = await tools.runTool('url', 'https://example.com/path?a=1&a=2&b=x#top', { action: 'parse' });
  const urlPayload = JSON.parse(parsedUrl.output);
  assert.deepEqual(urlPayload.params.a, ['1', '2']);
  assert.equal(parsedUrl.visual.type, 'url');
  assert.equal(parsedUrl.visual.params.length, 3);
  assert.equal((await tools.runTool('url', 'a b', { action: 'encode' })).output, 'a%20b');
  assert.equal((await tools.runTool('url', 'a%20b', { action: 'decode' })).output, 'a b');

  const b64 = await tools.runTool('codec', '你好', { action: 'base64-encode' });
  assert.equal((await tools.runTool('codec', b64.output, { action: 'base64-decode' })).output, '你好');
  assert.equal((await tools.runTool('codec', '<a&b>', { action: 'html-encode' })).output, '&lt;a&amp;b&gt;');
  assert.equal((await tools.runTool('codec', '\\u4f60\\u597d', { action: 'unicode-decode' })).output, '你好');

  const ts = await tools.runTool('timestamp', '0', { action: 'convert' });
  assert.equal(JSON.parse(ts.output).iso, '1970-01-01T00:00:00.000Z');
  assert.equal(ts.visual.type, 'timestamp');
  assert.equal((await tools.runTool('timestamp', '', { action: 'convert' })).ok, false);
  const ft = await tools.runTool('timestamp', '116444736000000000', { action: 'filetime' });
  assert.equal(JSON.parse(ft.output).unixMilliseconds, 0);
  const weekStart = await tools.runTool('timestamp', '', { action: 'week-start' });
  assert.equal(weekStart.ok, true);

  const cookie = await tools.runTool('cookie', 'a=1; token=hello%20world', { action: 'json' });
  assert.deepEqual(JSON.parse(cookie.output), { a: '1', token: 'hello world' });
  assert.equal(cookie.visual.rows.length, 2);

  const qr = await tools.runTool('qr', 'https://example.com', { action: 'generate' });
  assert.equal(qr.ok, true);
  assert.equal(qr.meta.mime, 'image/svg+xml');
  assert.equal(qr.visual.type, 'qr');
  assert.equal(qr.output.startsWith('<svg'), true);
  assert.equal(qr.output.includes('viewBox="0 0'), true);
  const longQrUrl = 'https://crazyrope-backup.oss-cn-shanghai.aliyuncs.com/app/android_apps/crazyrope-eng-4.1.8-8066-0511-1902.apk';
  const longQr = await tools.runTool('qr', longQrUrl, { action: 'generate' });
  assert.equal(longQr.ok, true);
  assert.equal(longQr.meta.mime, 'image/svg+xml');
  assert.equal(longQr.visual.textLength, Buffer.byteLength(longQrUrl, 'utf8'));

  assert.equal(await tools.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal((await tools.runTool('hash', 'abc', { action: 'sha1' })).output, 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal((await tools.runTool('hash', 'abc', { action: 'sha256' })).output, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  const tabsForExport = [
    { title: 'A [doc]', url: 'https://a.test', windowId: 1, index: 1, groupTitle: 'Work' },
    { title: 'B', url: 'https://b.test', windowId: 1, index: 0 },
  ];
  assert.equal(tools.formatSessionExport(tabsForExport, 'urls'), 'https://b.test\nhttps://a.test');
  assert.equal(tools.formatSessionExport(tabsForExport, 'markdown').includes('[A \\[doc\\]](https://a.test)'), true);
  assert.equal(JSON.parse(tools.formatSessionExport(tabsForExport, 'json')).tabs.length, 2);

  const fakeStorage = makeFakeStorage();
  global.chrome = { storage: { local: fakeStorage } };
  assert.deepEqual(await tools.setFavorite('json', true), ['json']);
  assert.deepEqual(await tools.setFavorite('url', true), ['json', 'url']);
  assert.deepEqual(await tools.setFavoritesOrder(['url', 'json', 'missing', 'url']), ['url', 'json']);
  assert.deepEqual(await tools.getFavorites(), ['url', 'json']);
  assert.deepEqual((await tools.getToolOrder()).slice(0, 3), ['url', 'json', 'qr']);
  assert.deepEqual((await tools.setToolOrder(['hash', 'qr', 'missing', 'hash'])).slice(0, 4), ['hash', 'qr', 'json', 'timestamp']);
  assert.deepEqual((await tools.getToolOrder()).slice(0, 4), ['hash', 'qr', 'json', 'timestamp']);
  await tools.recordRecent('hash');
  await tools.recordRecent('json');
  assert.deepEqual((await tools.getRecent()).map(item => item.id), ['json', 'hash']);
  await tools.setToolState('json', { input: '{"a":1}', output: 'ok' });
  assert.equal((await tools.getToolState('json')).output, 'ok');
}

testUrlService();
await testTabsService();
await testWorkspaceService();
testWorkspacePlanner();
await testWorkspaceOperations();
testOrganizationViews();
testDragController();
await testStorageService();
await testKeywordMappings();
await testShortcutLibrary();
await testDashboardCleanup();
testSearchService();
testMetricsService();
testHtmlService();
await testToolsService();
testBrandContract(root);
testPackageContract();

console.log('Unit tests passed.');

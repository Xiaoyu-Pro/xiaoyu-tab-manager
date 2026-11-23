/* Blue Tab Manager Chrome 编排操作协调器；基于 Super Tab Out，由 Xiaoyu-Pro 修改。
   串行执行真实窗口变更，保存不含 URL 的快照，并为最近一次操作提供撤销。 */
(function initWorkspaceOperations(globalScope) {
  'use strict';

  const OPERATION_LOCK_NAME = 'super-tab-out-chrome-organization';

  /** 将 Chrome API 异常收敛为可记录的纯文本，避免把不可序列化对象写入会话存储。 */
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'UNKNOWN_ERROR');
  }

  /** 按原窗口和索引稳定排列快照，恢复时能尽量重建原顺序。 */
  function sortSnapshot(snapshot) {
    return snapshot.slice().sort((a, b) => a.windowId - b.windowId || a.index - b.index || a.tabId - b.tabId);
  }

  /** 创建真实 Chrome 操作协调器；undoStore 只需实现 getUndoEntry/setUndoEntry。 */
  function createWorkspaceOperations({ tabsService, undoStore, now = () => Date.now(), lockManager = null } = {}) {
    if (!tabsService) throw new Error('TABS_SERVICE_REQUIRED');
    if (!undoStore?.getUndoEntry || !undoStore?.setUndoEntry) throw new Error('UNDO_STORE_REQUIRED');
    const sharedLockManager = lockManager || globalScope.navigator?.locks;
    let activeOperation = '';

    /** 保证当前页面和同源的其他 Dashboard 页面不会交错执行 Chrome 变更。 */
    async function runExclusive(kind, operation) {
      if (activeOperation) throw new Error('ORGANIZATION_OPERATION_IN_PROGRESS');
      const execute = async () => {
        activeOperation = kind;
        try {
          return await operation();
        } finally {
          activeOperation = '';
        }
      };
      if (!sharedLockManager?.request) return execute();
      return sharedLockManager.request(OPERATION_LOCK_NAME, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('ORGANIZATION_OPERATION_IN_PROGRESS');
        return execute();
      });
    }

    /** 执行前再次过滤已经置顶、转入隐身或导航到内部页面的标签。 */
    function isMovableTab(tab) {
      if (!tab || !Number.isFinite(tab.id) || tab.pinned || tab.incognito) return false;
      if (tab.windowType && tab.windowType !== 'normal') return false;
      try {
        return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol);
      } catch {
        return false;
      }
    }

    /** 查询计划涉及的仍存在标签并生成不含 URL 的最小撤销快照。 */
    async function captureSnapshot(tabIds) {
      const uniqueIds = [...new Set((tabIds || []).filter(Number.isFinite))];
      const tabs = await tabsService.getTabsByIds(uniqueIds);
      return sortSnapshot(tabs.filter(isMovableTab).map(tab => ({
        tabId: tab.id,
        windowId: tab.windowId,
        index: Number.isFinite(tab.index) ? tab.index : -1,
        groupId: Number.isFinite(tab.groupId) ? tab.groupId : -1,
      })));
    }

    /** 保存原生组的标题、颜色和折叠状态；只记录会话内显示元数据，不记录 URL。 */
    async function captureGroupMetadata(snapshot) {
      if (!tabsService.fetchTabGroups) return [];
      const groupIds = new Set(snapshot.map(item => item.groupId).filter(groupId => groupId >= 0));
      if (!groupIds.size) return [];
      const groups = await tabsService.fetchTabGroups();
      return groups
        .filter(group => groupIds.has(group?.id))
        .map(group => ({
          groupId: group.id,
          title: typeof group.title === 'string' ? group.title : '',
          color: typeof group.color === 'string' ? group.color : 'grey',
          collapsed: group.collapsed === true,
        }));
    }

    /**
     * 在每个 Chrome 写操作前重查标签；只允许已有撤销快照且此刻仍可移动的成员，
     * 避免执行等待期间新置顶、关闭或导航到内部页的标签被误移动。
     */
    async function revalidateTabIds(tabIds, snapshotIds, skippedIds) {
      const candidates = [...new Set((tabIds || []).filter(tabId => snapshotIds.has(tabId)))];
      const liveTabs = await tabsService.getTabsByIds(candidates);
      const movableIds = liveTabs.filter(isMovableTab).map(tab => tab.id);
      const movableSet = new Set(movableIds);
      candidates.filter(tabId => !movableSet.has(tabId)).forEach(tabId => skippedIds.add(tabId));
      return movableIds;
    }

    /** 按快照恢复标签窗口、顺序和仍可用的原生组，单项失败不会阻断其余恢复。 */
    async function restoreSnapshot(snapshot, groupMetadata = []) {
      const restoredTabIds = [];
      const skippedTabIds = [];
      const errors = [];
      const currentTabs = (await tabsService.getTabsByIds(snapshot.map(item => item.tabId))).filter(isMovableTab);
      const currentIds = new Set(currentTabs.map(tab => tab.id));
      const byWindow = new Map();
      for (const item of sortSnapshot(snapshot)) {
        if (!currentIds.has(item.tabId)) {
          skippedTabIds.push(item.tabId);
          continue;
        }
        if (!byWindow.has(item.windowId)) byWindow.set(item.windowId, []);
        byWindow.get(item.windowId).push(item);
      }

      for (const [windowId, items] of byWindow) {
        for (const item of items) {
          try {
            await tabsService.moveTabs([item.tabId], windowId, item.index);
            restoredTabIds.push(item.tabId);
          } catch (error) {
            errors.push({ step: 'restore-window', tabIds: [item.tabId], message: errorMessage(error) });
          }
        }
      }

      const restoredSet = new Set(restoredTabIds);
      const tabsAfterMove = await tabsService.getTabsByIds(restoredTabIds);
      const groupedAfterMove = new Set(tabsAfterMove.filter(tab => tab.groupId >= 0).map(tab => tab.id));
      const originallyUngroupedIds = snapshot
        .filter(item => item.groupId < 0 && restoredSet.has(item.tabId) && groupedAfterMove.has(item.tabId))
        .map(item => item.tabId);
      if (originallyUngroupedIds.length) {
        try {
          await tabsService.ungroupTabs(originallyUngroupedIds);
        } catch (error) {
          errors.push({ step: 'restore-ungroup', tabIds: originallyUngroupedIds, message: errorMessage(error) });
        }
      }

      const byGroup = new Map();
      const metadataByGroup = new Map((Array.isArray(groupMetadata) ? groupMetadata : [])
        .filter(item => Number.isFinite(item?.groupId))
        .map(item => [item.groupId, item]));
      for (const item of snapshot) {
        if (item.groupId < 0 || !restoredSet.has(item.tabId)) continue;
        if (!byGroup.has(item.groupId)) byGroup.set(item.groupId, []);
        byGroup.get(item.groupId).push(item.tabId);
      }
      for (const [groupId, tabIds] of byGroup) {
        let restoredGroupId = groupId;
        try {
          const resultGroupId = await tabsService.groupTabs(tabIds, { groupId });
          if (Number.isFinite(resultGroupId)) restoredGroupId = resultGroupId;
        } catch {
          try {
            const resultGroupId = await tabsService.groupTabs(tabIds);
            if (Number.isFinite(resultGroupId)) restoredGroupId = resultGroupId;
          } catch (error) {
            errors.push({ step: 'restore-group', tabIds, message: errorMessage(error) });
            continue;
          }
        }
        const metadata = metadataByGroup.get(groupId);
        if (metadata && tabsService.updateGroup) {
          try {
            await tabsService.updateGroup(restoredGroupId, {
              title: metadata.title,
              color: metadata.color,
              collapsed: metadata.collapsed,
            });
          } catch (error) {
            errors.push({ step: 'restore-group-metadata', tabIds, message: errorMessage(error) });
          }
        }
      }
      return { restoredTabCount: restoredTabIds.length, skippedTabIds, errors };
    }

    /** 执行规划器生成的窗口计划，失败时立即按原快照尽力补偿。 */
    async function executeWindowPlan(plan = {}) {
      return runExclusive('window-plan', async () => {
        const moveTabIds = (plan.moves || []).flatMap(move => move.tabIds || []);
        const groupMoveTabIds = (plan.groupMoves || []).flatMap(move => move.tabIds || []);
        const newWindowTabIds = (plan.newWindows || []).flatMap(item => [item.seedTabId, ...(item.remainingTabIds || [])]);
        const requestedTabIds = [...new Set([...moveTabIds, ...groupMoveTabIds, ...newWindowTabIds].filter(Number.isFinite))];
        const snapshot = await captureSnapshot(requestedTabIds);
        const groupMetadata = await captureGroupMetadata(snapshot);
        const existingIds = new Set(snapshot.map(item => item.tabId));
        const skippedIds = new Set(requestedTabIds.filter(tabId => !existingIds.has(tabId)));
        const movedTabIds = [];
        const createdWindowIds = [];
        const errors = [];

        try {
          for (const move of plan.groupMoves || []) {
            const tabIds = await revalidateTabIds(move.tabIds, existingIds, skippedIds);
            const expectedIds = new Set(tabIds);
            if (!expectedIds.size) continue;
            // 每个组都紧邻写操作重查，避免前一个步骤之后成员已发生变化。
            const currentTabs = tabsService.fetchOpenTabs ? await tabsService.fetchOpenTabs() : [];
            const currentMembers = currentTabs.filter(tab => tab.groupId === move.groupId);
            const groupIsIntact = currentMembers.length === expectedIds.size
              && currentMembers.every(tab => expectedIds.has(tab.id) && isMovableTab(tab));
            if (groupIsIntact) {
              await tabsService.moveTabGroup(move.groupId, move.toWindowId, -1);
            } else {
              await tabsService.moveTabs(tabIds, move.toWindowId, -1);
            }
            movedTabIds.push(...tabIds);
          }
          for (const move of plan.moves || []) {
            const tabIds = await revalidateTabIds(move.tabIds, existingIds, skippedIds);
            if (!tabIds.length) continue;
            await tabsService.moveTabs(tabIds, move.toWindowId, -1);
            movedTabIds.push(...tabIds);
          }
          for (const item of plan.newWindows || []) {
            const plannedIds = [item.seedTabId, ...(item.remainingTabIds || [])];
            const liveIds = await revalidateTabIds(plannedIds, existingIds, skippedIds);
            if (!liveIds.length) continue;
            const [seedTabId, ...remainingIds] = liveIds;
            const createdWindow = await tabsService.createWindowFromTab(seedTabId);
            if (!Number.isFinite(createdWindow?.id)) throw new Error('WINDOW_CREATE_FAILED');
            createdWindowIds.push(createdWindow.id);
            movedTabIds.push(seedTabId);
            if (remainingIds.length) {
              await tabsService.moveTabs(remainingIds, createdWindow.id, -1);
              movedTabIds.push(...remainingIds);
            }
          }
        } catch (error) {
          errors.push({ step: 'execute-window-plan', message: errorMessage(error) });
          const compensation = await restoreSnapshot(snapshot, groupMetadata);
          errors.push(...compensation.errors);
          return {
            movedTabCount: 0,
            movedTabIds: [],
            skippedTabIds: [...skippedIds],
            createdWindowIds,
            errors,
            compensated: compensation.errors.length === 0,
          };
        }

        if (movedTabIds.length) {
          await undoStore.setUndoEntry({ kind: 'window-plan', createdAt: now(), snapshot, groupMetadata });
        }
        return {
          movedTabCount: movedTabIds.length,
          movedTabIds,
          skippedTabIds: [...skippedIds],
          createdWindowIds,
          errors,
          compensated: false,
        };
      });
    }

    /** 将一个工作聚合到目标窗口并创建或安全复用 Chrome 原生标签组。 */
    async function createNativeGroupForWorkspace({ workspace, tabs = [], targetWindowId = null, reusableGroupId = null, color = 'blue' } = {}) {
      return runExclusive('workspace-group', async () => {
        const requestedTabIds = tabs.map(tab => tab.id).filter(Number.isFinite);
        const snapshot = await captureSnapshot(requestedTabIds);
        const groupMetadata = await captureGroupMetadata(snapshot);
        const existingIds = new Set(snapshot.map(item => item.tabId));
        const skippedIds = new Set(requestedTabIds.filter(tabId => !existingIds.has(tabId)));
        const liveIds = await revalidateTabIds(requestedTabIds, existingIds, skippedIds);
        const liveTabs = (await tabsService.getTabsByIds(liveIds)).filter(isMovableTab);
        const liveTabIds = new Set(liveTabs.map(tab => tab.id));
        liveIds.filter(tabId => !liveTabIds.has(tabId)).forEach(tabId => skippedIds.add(tabId));
        if (!workspace?.name || liveTabs.length === 0) {
          return { groupId: null, movedTabCount: 0, skippedTabIds: [...skippedIds], errors: [] };
        }

        let destinationWindowId = Number.isFinite(targetWindowId) ? targetWindowId : null;
        let effectiveReusableGroupId = null;
        if (Number.isFinite(reusableGroupId) && reusableGroupId >= 0 && destinationWindowId !== null && tabsService.fetchOpenTabs) {
          const expectedIds = new Set(liveTabs.map(tab => tab.id));
          const currentMembers = (await tabsService.fetchOpenTabs()).filter(tab => tab.groupId === reusableGroupId);
          const groupIsStillPure = currentMembers.length === expectedIds.size
            && currentMembers.every(tab => expectedIds.has(tab.id) && isMovableTab(tab));
          if (groupIsStillPure) effectiveReusableGroupId = reusableGroupId;
        }
        const movedTabIds = [];
        let seededTabId = null;
        try {
          if (destinationWindowId === null) {
            const created = await tabsService.createWindowFromTab(liveTabs[0].id);
            if (!Number.isFinite(created?.id)) throw new Error('WINDOW_CREATE_FAILED');
            destinationWindowId = created.id;
            seededTabId = liveTabs[0].id;
            movedTabIds.push(seededTabId);
          }

          if (effectiveReusableGroupId !== null) {
            const groupNeedsMove = liveTabs.some(tab => tab.windowId !== destinationWindowId);
            if (groupNeedsMove) {
              await tabsService.moveTabGroup(effectiveReusableGroupId, destinationWindowId, -1);
              movedTabIds.push(...liveTabs.filter(tab => tab.windowId !== destinationWindowId).map(tab => tab.id));
            }
          } else {
            const toMove = liveTabs
              .filter(tab => tab.id !== seededTabId && tab.windowId !== destinationWindowId)
              .map(tab => tab.id);
            if (toMove.length) {
              await tabsService.moveTabs(toMove, destinationWindowId, -1);
              movedTabIds.push(...toMove);
            }
          }

          const groupId = await tabsService.groupTabs(liveTabs.map(tab => tab.id), {
            ...(effectiveReusableGroupId !== null ? { groupId: effectiveReusableGroupId } : {}),
            title: workspace.name,
            color,
          });
          await undoStore.setUndoEntry({ kind: 'workspace-group', createdAt: now(), snapshot, groupMetadata });
          return {
            groupId,
            windowId: destinationWindowId,
            movedTabCount: new Set(movedTabIds).size,
            skippedTabIds: [...skippedIds],
            errors: [],
          };
        } catch (error) {
          const compensation = await restoreSnapshot(snapshot, groupMetadata);
          return {
            groupId: null,
            windowId: destinationWindowId,
            movedTabCount: 0,
            skippedTabIds: [...skippedIds],
            errors: [{ step: 'create-workspace-group', message: errorMessage(error) }, ...compensation.errors],
          };
        }
      });
    }

    /** 撤销最近一次真实 Chrome 编排；执行后无论结果如何都清空该撤销项。 */
    async function undo() {
      return runExclusive('undo', async () => {
        const entry = await undoStore.getUndoEntry();
        if (!entry?.snapshot || !Array.isArray(entry.snapshot)) {
          return { restoredTabCount: 0, skippedTabIds: [], errors: [], empty: true };
        }
        const result = await restoreSnapshot(entry.snapshot, entry.groupMetadata);
        await undoStore.setUndoEntry(null);
        return { ...result, empty: false };
      });
    }

    return Object.freeze({
      executeWindowPlan,
      createNativeGroupForWorkspace,
      undo,
      getUndoEntry: () => undoStore.getUndoEntry(),
      isBusy: () => Boolean(activeOperation),
    });
  }

  const api = { OPERATION_LOCK_NAME, createWorkspaceOperations };
  globalScope.SuperTabOutWorkspaceOperations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

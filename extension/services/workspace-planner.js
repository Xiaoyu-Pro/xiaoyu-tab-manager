/* Xiaoyu Tab Manager 工作/窗口规划器；基于 Super Tab Out，由 Xiaoyu-Pro 修改。
   所有函数均为纯函数：只根据快照计算最低移动成本计划，不访问 Chrome API。 */
(function initWorkspacePlanner(globalScope) {
  'use strict';

  /** 判断标签是否应被自动编排保护。 */
  function getProtectedReason(tab) {
    if (!tab || !Number.isFinite(tab.id)) return 'invalid';
    if (tab.pinned) return 'pinned';
    if (tab.incognito) return 'incognito';
    if (tab.windowType && tab.windowType !== 'normal') return 'window-type';
    const url = String(tab.url || '');
    if (!url) return 'internal';
    try {
      if (!['http:', 'https:', 'file:'].includes(new URL(url).protocol)) return 'internal';
    } catch {
      return 'internal';
    }
    return '';
  }

  /**
   * 用本次 `windows.getAll({ windowTypes: ['normal'] })` 快照标注来源窗口；
   * `tabs.query({})` 本身没有窗口类型，不能据此假设 popup 也可移动。
   */
  function annotateTabWindowTypes(tabs, windows) {
    const normalWindowIds = new Set((Array.isArray(windows) ? windows : [])
      .filter(windowInfo => windowInfo?.type === 'normal' && windowInfo.incognito !== true && Number.isFinite(windowInfo.id))
      .map(windowInfo => windowInfo.id));
    return (Array.isArray(tabs) ? tabs : []).map(tab => ({
      ...tab,
      windowType: normalWindowIds.has(tab?.windowId) ? 'normal' : 'other',
    }));
  }

  /** 将任意矩形权重补齐为方阵，便于统一处理虚拟工作或虚拟窗口。 */
  function squareWeights(weights, size) {
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, column) => Number(weights[row]?.[column]) || 0)
    );
  }

  /**
   * 使用匈牙利算法求方阵最大权一一匹配。
   * 通过 maxWeight - weight 转为最小费用，时间复杂度 O(n³)。
   */
  function maximumWeightMatching(weights) {
    const size = Math.max(weights.length, ...weights.map(row => row.length), 0);
    if (size === 0) return { score: 0, pairs: [] };
    const matrix = squareWeights(weights, size);
    const maxWeight = Math.max(0, ...matrix.flat());
    const costs = matrix.map(row => row.map(weight => maxWeight - weight));
    const u = new Array(size + 1).fill(0);
    const v = new Array(size + 1).fill(0);
    const p = new Array(size + 1).fill(0);
    const way = new Array(size + 1).fill(0);

    for (let row = 1; row <= size; row += 1) {
      p[0] = row;
      let column0 = 0;
      const minValues = new Array(size + 1).fill(Infinity);
      const used = new Array(size + 1).fill(false);
      do {
        used[column0] = true;
        const row0 = p[column0];
        let delta = Infinity;
        let column1 = 0;
        for (let column = 1; column <= size; column += 1) {
          if (used[column]) continue;
          const current = costs[row0 - 1][column - 1] - u[row0] - v[column];
          if (current < minValues[column]) {
            minValues[column] = current;
            way[column] = column0;
          }
          if (minValues[column] < delta) {
            delta = minValues[column];
            column1 = column;
          }
        }
        for (let column = 0; column <= size; column += 1) {
          if (used[column]) {
            u[p[column]] += delta;
            v[column] -= delta;
          } else {
            minValues[column] -= delta;
          }
        }
        column0 = column1;
      } while (p[column0] !== 0);

      do {
        const column1 = way[column0];
        p[column0] = p[column1];
        column0 = column1;
      } while (column0 !== 0);
    }

    const pairs = [];
    let score = 0;
    for (let column = 1; column <= size; column += 1) {
      const row = p[column] - 1;
      const columnIndex = column - 1;
      pairs.push([row, columnIndex]);
      score += matrix[row][columnIndex];
    }
    return { score, pairs: pairs.sort((a, b) => a[0] - b[0]) };
  }

  /** 只有全部工作标签共享且独占同一有效原生组时才可复用。 */
  function findReusableGroup(workspaceTabs, allTabs = workspaceTabs) {
    const tabs = (Array.isArray(workspaceTabs) ? workspaceTabs : []).filter(tab => !getProtectedReason(tab));
    if (tabs.length === 0) return null;
    const groupId = tabs[0].groupId;
    if (!Number.isFinite(groupId) || groupId < 0 || tabs.some(tab => tab.groupId !== groupId)) return null;
    const workspaceId = tabs[0].workspaceId;
    const groupMembers = (Array.isArray(allTabs) ? allTabs : []).filter(tab => tab.groupId === groupId);
    if (groupMembers.some(tab => tab.workspaceId !== workspaceId || getProtectedReason(tab))) return null;
    return groupId;
  }

  /** 找出会在按工作移动时被拆分的混合原生组。 */
  function findSplitGroups(tabs) {
    const groups = new Map();
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!Number.isFinite(tab?.groupId) || tab.groupId < 0) continue;
      if (!groups.has(tab.groupId)) groups.set(tab.groupId, []);
      groups.get(tab.groupId).push(tab);
    }
    const splitGroups = [];
    for (const [groupId, members] of groups) {
      const workspaceIds = new Set(members.map(tab => tab.workspaceId || 'unassigned'));
      if (workspaceIds.size > 1 || members.some(tab => getProtectedReason(tab))) {
        splitGroups.push({ groupId, tabIds: members.map(tab => tab.id).filter(Number.isFinite) });
      }
    }
    return splitGroups.sort((a, b) => a.groupId - b.groupId);
  }

  /**
   * 把目标窗口不同的标签拆成“完整纯净组移动”和普通标签移动；
   * 只有规划快照包含组内全部成员时才允许整体移动，避免带走待整理页面。
   */
  function partitionMovesByGroup(workspace, workspaceTabs, allTabs, targetWindowId) {
    const movingTabs = workspaceTabs.filter(tab => tab.windowId !== targetWindowId);
    const movingIds = new Set(movingTabs.map(tab => tab.id));
    const groupedIds = new Set();
    const groupMoves = [];
    const candidateGroupIds = [...new Set(movingTabs.map(tab => tab.groupId).filter(groupId => Number.isFinite(groupId) && groupId >= 0))];

    for (const groupId of candidateGroupIds) {
      const members = allTabs.filter(tab => tab.groupId === groupId);
      const isPureCompleteGroup = members.length > 0
        && members.every(tab => tab.workspaceId === workspace.id && !getProtectedReason(tab) && movingIds.has(tab.id));
      if (!isPureCompleteGroup) continue;
      const tabIds = members.map(tab => tab.id);
      tabIds.forEach(tabId => groupedIds.add(tabId));
      groupMoves.push({ workspaceId: workspace.id, groupId, tabIds, toWindowId: targetWindowId });
    }

    return {
      groupMoves,
      tabIds: movingTabs.map(tab => tab.id).filter(tabId => !groupedIds.has(tabId)),
    };
  }

  /**
   * 为所有非空工作计算目标窗口和移动步骤。
   * workspaceId 必须已经由工作模型解析到 tab 快照中。
   */
  function planWorkspaceWindows({ workspaces = [], windows = [], tabs = [] } = {}) {
    const normalWindows = windows
      .filter(windowInfo => Number.isFinite(windowInfo?.id) && windowInfo.type === 'normal' && !windowInfo.incognito)
      .slice()
      .sort((a, b) => a.id - b.id);
    const typedTabs = annotateTabWindowTypes(tabs, normalWindows);
    const workspaceOrder = new Map(workspaces.map((item, index) => [item.id, index]));
    const validWorkspaceIds = new Set(workspaces.map(item => item.id));
    const excludedTabs = [];
    const eligibleTabs = [];

    for (const tab of typedTabs) {
      if (!validWorkspaceIds.has(tab?.workspaceId)) continue;
      const reason = getProtectedReason(tab);
      if (reason) excludedTabs.push({ tabId: tab?.id, workspaceId: tab?.workspaceId, reason });
      else eligibleTabs.push(tab);
    }

    const tabsByWorkspace = new Map();
    for (const tab of eligibleTabs) {
      if (!tabsByWorkspace.has(tab.workspaceId)) tabsByWorkspace.set(tab.workspaceId, []);
      tabsByWorkspace.get(tab.workspaceId).push(tab);
    }
    const activeWorkspaces = workspaces
      .filter(item => tabsByWorkspace.get(item.id)?.length)
      .slice()
      .sort((a, b) => (workspaceOrder.get(a.id) || 0) - (workspaceOrder.get(b.id) || 0));
    const size = Math.max(activeWorkspaces.length, normalWindows.length);
    const weights = squareWeights(activeWorkspaces.map(workspace =>
      normalWindows.map(windowInfo =>
        tabsByWorkspace.get(workspace.id).filter(tab => tab.windowId === windowInfo.id).length
      )
    ), size);
    const matching = maximumWeightMatching(weights);
    const matchedColumnByRow = new Map(matching.pairs);
    const assignments = [];
    const moves = [];
    const groupMoves = [];
    const newWindows = [];

    activeWorkspaces.forEach((workspace, rowIndex) => {
      const targetColumn = matchedColumnByRow.get(rowIndex);
      const targetWindow = targetColumn < normalWindows.length ? normalWindows[targetColumn] : null;
      const workspaceTabs = tabsByWorkspace.get(workspace.id).slice().sort((a, b) => a.index - b.index);
      const assignment = {
        workspaceId: workspace.id,
        windowId: targetWindow?.id ?? null,
        createsWindow: !targetWindow,
        keptTabCount: targetWindow ? workspaceTabs.filter(tab => tab.windowId === targetWindow.id).length : 0,
      };
      assignments.push(assignment);
      if (targetWindow) {
        const partitioned = partitionMovesByGroup(workspace, workspaceTabs, typedTabs, targetWindow.id);
        groupMoves.push(...partitioned.groupMoves);
        if (partitioned.tabIds.length) moves.push({ workspaceId: workspace.id, tabIds: partitioned.tabIds, toWindowId: targetWindow.id });
      } else {
        const [seedTab, ...remainingTabs] = workspaceTabs;
        newWindows.push({
          workspaceId: workspace.id,
          seedTabId: seedTab.id,
          remainingTabIds: remainingTabs.map(tab => tab.id),
        });
      }
    });

    const movingTabIds = new Set([
      ...moves.flatMap(move => move.tabIds),
      ...groupMoves.flatMap(move => move.tabIds),
      ...newWindows.flatMap(item => [item.seedTabId, ...item.remainingTabIds]),
    ]);
    // 只披露这次计划实际会触碰的混合组，避免确认框夸大无关风险。
    const splitGroups = findSplitGroups(typedTabs)
      .filter(group => group.tabIds.some(tabId => movingTabIds.has(tabId)));
    const movedTabCount = movingTabIds.size;
    return {
      assignments,
      moves,
      groupMoves,
      newWindows,
      splitGroups,
      excludedTabs,
      summary: {
        workspaceCount: activeWorkspaces.length,
        movedTabCount,
        reusedWindowCount: assignments.filter(item => !item.createsWindow).length,
        newWindowCount: newWindows.length,
        protectedTabCount: excludedTabs.length,
        splitGroupCount: splitGroups.length,
      },
    };
  }

  const api = {
    getProtectedReason,
    annotateTabWindowTypes,
    maximumWeightMatching,
    findReusableGroup,
    findSplitGroups,
    partitionMovesByGroup,
    planWorkspaceWindows,
  };

  globalScope.SuperTabOutWorkspacePlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

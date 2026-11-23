/* Xiaoyu Tab Manager 工作组织服务；基于 Super Tab Out，由 Xiaoyu-Pro 修改。
   负责版本化持久化、精确页面匹配和工作 CRUD，不访问 DOM 或 Chrome 标签 API。 */
(function initWorkspaceService(globalScope) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LOCAL_KEY = 'workspaceState';
  const SESSION_KEY = 'workspaceSession';
  const WRITE_LOCK_NAME = 'super-tab-out-workspace-state';

  /** 创建没有共享引用的初始长期状态。 */
  function createEmptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      initializedAt: null,
      workspaces: [],
      pageAssignments: {},
    };
  }

  /** 创建没有共享引用的初始会话状态。 */
  function createEmptySession() {
    return { tabAssignments: {}, undoEntry: null };
  }

  /** 只移除 fragment；query 是精确页面身份的一部分，不能丢弃。 */
  function normalizePageUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return '';
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') return '';
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }

  /** 生成本地长期页面键，避免把路径和查询参数以明文写入 storage.local。 */
  async function createPageKey(rawUrl, cryptoApi = globalScope.crypto) {
    const normalized = normalizePageUrl(rawUrl);
    if (!normalized || !cryptoApi?.subtle) return '';
    const bytes = new TextEncoder().encode(normalized);
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /** 防御性复制 JSON 兼容数据，避免调用方改写服务内部快照。 */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** 将未知的旧数据收敛到当前 schema；无损保留仍指向有效工作的归属。 */
  function normalizeState(candidate) {
    const state = createEmptyState();
    if (!candidate || typeof candidate !== 'object') return state;
    if (Number.isFinite(candidate.schemaVersion) && candidate.schemaVersion > SCHEMA_VERSION) {
      // 旧扩展不能理解未来字段，必须只读失败，不能在下一次 CRUD 时静默降级覆盖。
      throw new Error('WORKSPACE_SCHEMA_NEWER_THAN_SUPPORTED');
    }
    state.initializedAt = Number.isFinite(candidate.initializedAt) ? candidate.initializedAt : null;
    const seenIds = new Set();
    const seenNames = new Set();
    state.workspaces = (Array.isArray(candidate.workspaces) ? candidate.workspaces : [])
      .map((workspace, index) => {
        const id = typeof workspace?.id === 'string' ? workspace.id.trim() : '';
        const name = typeof workspace?.name === 'string' ? workspace.name.trim() : '';
        const nameKey = name.toLocaleLowerCase();
        if (!id || !name || seenIds.has(id) || seenNames.has(nameKey)) return null;
        seenIds.add(id);
        seenNames.add(nameKey);
        return {
          id,
          name,
          createdAt: Number.isFinite(workspace.createdAt) ? workspace.createdAt : 0,
          updatedAt: Number.isFinite(workspace.updatedAt) ? workspace.updatedAt : 0,
          order: Number.isFinite(workspace.order) ? workspace.order : index,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const validIds = new Set(state.workspaces.map(workspace => workspace.id));
    for (const [pageKey, workspaceId] of Object.entries(candidate.pageAssignments || {})) {
      if (/^[a-f0-9]{64}$/.test(pageKey) && validIds.has(workspaceId)) {
        state.pageAssignments[pageKey] = workspaceId;
      }
    }
    return state;
  }

  /** 清理会话数据中无效的 tabId 和工作引用。 */
  function normalizeSession(candidate, workspaceIds = null) {
    const session = createEmptySession();
    const validIds = workspaceIds instanceof Set ? workspaceIds : null;
    for (const [tabId, workspaceId] of Object.entries(candidate?.tabAssignments || {})) {
      if (!/^\d+$/.test(tabId) || typeof workspaceId !== 'string') continue;
      if (!validIds || validIds.has(workspaceId)) session.tabAssignments[tabId] = workspaceId;
    }
    session.undoEntry = candidate?.undoEntry && typeof candidate.undoEntry === 'object'
      ? clone(candidate.undoEntry)
      : null;
    return session;
  }

  /** 为首次域名快照生成不重名的工作名。 */
  function createUniqueName(rawName, usedNames) {
    const base = String(rawName || '').trim() || '未命名工作';
    let candidate = base;
    let suffix = 2;
    while (usedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  /** 创建工作组织服务；测试可注入 storage、时间和 ID 生成器。 */
  function createWorkspaceService(options = {}) {
    const storage = options.storage || globalScope.chrome?.storage || {};
    const localArea = options.localArea || storage.local;
    const memorySessionArea = createMemoryStorageArea();
    const sessionArea = options.sessionArea || storage.session || memorySessionArea;
    const cryptoApi = options.cryptoApi || globalScope.crypto;
    const lockManager = options.lockManager || globalScope.navigator?.locks;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const createId = typeof options.createId === 'function'
      ? options.createId
      : () => cryptoApi?.randomUUID?.() || `workspace-${now()}-${Math.random().toString(36).slice(2)}`;

    if (!localArea?.get || !localArea?.set) {
      throw new Error('WORKSPACE_STORAGE_UNAVAILABLE');
    }

    let memoryWriteQueue = Promise.resolve();

    /**
     * 串行执行 read-modify-write；Web Lock 可覆盖同源的多个 Dashboard 页面，
     * 不支持该 API 的环境退化为当前页面内队列。
     */
    function runMutation(operation) {
      if (lockManager?.request) return lockManager.request(WRITE_LOCK_NAME, operation);
      const current = memoryWriteQueue.then(operation, operation);
      memoryWriteQueue = current.catch(() => undefined);
      return current;
    }

    /** 从 storage.local 读取并规范化当前模型。 */
    async function load() {
      const result = await localArea.get(LOCAL_KEY);
      return normalizeState(result?.[LOCAL_KEY]);
    }

    /** 从 storage.session 读取并剔除已经不存在的工作引用。 */
    async function loadSession(state = null) {
      const currentState = state || await load();
      const result = await sessionArea.get(SESSION_KEY);
      return normalizeSession(result?.[SESSION_KEY], new Set(currentState.workspaces.map(item => item.id)));
    }

    /** 原子式写入长期模型的单个 storage 键。 */
    async function save(state) {
      const normalized = normalizeState(state);
      await localArea.set({ [LOCAL_KEY]: normalized });
      return clone(normalized);
    }

    /** 原子式写入会话模型的单个 storage 键。 */
    async function saveSession(session, state = null) {
      const currentState = state || await load();
      const normalized = normalizeSession(session, new Set(currentState.workspaces.map(item => item.id)));
      await sessionArea.set({ [SESSION_KEY]: normalized });
      return clone(normalized);
    }

    /** 以当前域名卡片初始化一次工作模型；已初始化时只返回现状。 */
    async function initializeFromDomainGroups(domainGroups = []) {
      return runMutation(async () => {
        const existing = await load();
        if (existing.initializedAt !== null) return existing;
        const initializedAt = now();
        const state = createEmptyState();
        state.initializedAt = initializedAt;
        const session = createEmptySession();
        const usedNames = new Set();

        for (const [index, group] of (Array.isArray(domainGroups) ? domainGroups : []).entries()) {
          const groupTabs = Array.isArray(group?.tabs) ? group.tabs : [];
          if (groupTabs.length === 0) continue;
          const workspace = {
            id: createId(),
            name: createUniqueName(group.name || group.label || group.hostname || group.domain, usedNames),
            createdAt: initializedAt,
            updatedAt: initializedAt,
            order: index,
          };
          state.workspaces.push(workspace);
          for (const tab of groupTabs) {
            const pageKey = await createPageKey(tab?.url, cryptoApi);
            if (pageKey) state.pageAssignments[pageKey] = workspace.id;
            if (Number.isFinite(tab?.id)) session.tabAssignments[String(tab.id)] = workspace.id;
          }
        }

        await save(state);
        await saveSession(session, state);
        return clone(state);
      });
    }

    /** 校验名称，保证工作列表在 UI 和持久化层都没有空名或重名。 */
    function validateWorkspaceName(name, workspaces, excludeId = '') {
      const normalized = String(name || '').trim();
      if (!normalized) throw new Error('WORKSPACE_NAME_REQUIRED');
      const nameKey = normalized.toLocaleLowerCase();
      if (workspaces.some(item => item.id !== excludeId && item.name.toLocaleLowerCase() === nameKey)) {
        throw new Error('WORKSPACE_NAME_DUPLICATE');
      }
      return normalized;
    }

    /** 新建一个空工作并追加到稳定顺序末尾。 */
    async function createWorkspace(name) {
      return runMutation(async () => {
        const state = await load();
        const normalizedName = validateWorkspaceName(name, state.workspaces);
        const timestamp = now();
        const workspace = {
          id: createId(),
          name: normalizedName,
          createdAt: timestamp,
          updatedAt: timestamp,
          order: state.workspaces.length,
        };
        state.workspaces.push(workspace);
        await save(state);
        return clone(workspace);
      });
    }

    /** 重命名现有工作；不存在时抛出可识别错误。 */
    async function renameWorkspace(workspaceId, name) {
      return runMutation(async () => {
        const state = await load();
        const workspace = state.workspaces.find(item => item.id === workspaceId);
        if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
        workspace.name = validateWorkspaceName(name, state.workspaces, workspaceId);
        workspace.updatedAt = now();
        await save(state);
        return clone(workspace);
      });
    }

    /** 删除工作并清理所有长期和当前会话归属，使标签回到待整理。 */
    async function deleteWorkspace(workspaceId) {
      return runMutation(async () => {
        const state = await load();
        if (!state.workspaces.some(item => item.id === workspaceId)) return false;
        state.workspaces = state.workspaces
          .filter(item => item.id !== workspaceId)
          .map((item, order) => ({ ...item, order }));
        for (const [pageKey, assignedId] of Object.entries(state.pageAssignments)) {
          if (assignedId === workspaceId) delete state.pageAssignments[pageKey];
        }
        const session = await loadSession(state);
        for (const [tabId, assignedId] of Object.entries(session.tabAssignments)) {
          if (assignedId === workspaceId) delete session.tabAssignments[tabId];
        }
        await save(state);
        await saveSession(session, state);
        return true;
      });
    }

    /** 返回标签当前有效归属；会话 tabId 优先于长期精确页面键。 */
    async function resolveWorkspace(tab) {
      const state = await load();
      const byId = new Map(state.workspaces.map(item => [item.id, item]));
      const session = await loadSession(state);
      const sessionId = Number.isFinite(tab?.id) ? session.tabAssignments[String(tab.id)] : '';
      if (sessionId && byId.has(sessionId)) return clone(byId.get(sessionId));
      const pageKey = await createPageKey(tab?.url, cryptoApi);
      const persistentId = pageKey ? state.pageAssignments[pageKey] : '';
      return persistentId && byId.has(persistentId) ? clone(byId.get(persistentId)) : null;
    }

    /** 更新单个标签的逻辑归属；传入 null 表示回到待整理。 */
    async function assignTab(tab, workspaceId) {
      return runMutation(async () => {
        const state = await load();
        const session = await loadSession(state);
        if (workspaceId !== null && !state.workspaces.some(item => item.id === workspaceId)) {
          throw new Error('WORKSPACE_NOT_FOUND');
        }
        const tabKey = Number.isFinite(tab?.id) ? String(tab.id) : '';
        const pageKey = await createPageKey(tab?.url, cryptoApi);
        const previousWorkspaceId = (tabKey && session.tabAssignments[tabKey])
          || (pageKey && state.pageAssignments[pageKey])
          || null;
        if (workspaceId === null) {
          if (tabKey) delete session.tabAssignments[tabKey];
          if (pageKey) delete state.pageAssignments[pageKey];
        } else {
          if (tabKey) session.tabAssignments[tabKey] = workspaceId;
          if (pageKey) state.pageAssignments[pageKey] = workspaceId;
        }
        await save(state);
        await saveSession(session, state);
        return { previousWorkspaceId, workspaceId };
      });
    }

    /** 将当前标签一次性解析为工作卡片和待整理列表，避免 UI 重复读 storage。 */
    async function buildOrganization(tabs = []) {
      const state = await load();
      const session = await loadSession(state);
      const byId = new Map(state.workspaces.map(item => [item.id, { ...clone(item), tabs: [] }]));
      const unassignedTabs = [];
      for (const tab of Array.isArray(tabs) ? tabs : []) {
        const pageKey = await createPageKey(tab?.url, cryptoApi);
        const workspaceId = (Number.isFinite(tab?.id) && session.tabAssignments[String(tab.id)])
          || (pageKey && state.pageAssignments[pageKey]);
        if (workspaceId && byId.has(workspaceId)) byId.get(workspaceId).tabs.push(tab);
        else unassignedTabs.push(tab);
      }
      return { workspaces: state.workspaces.map(item => byId.get(item.id)), unassignedTabs };
    }

    /** 清理已关闭标签的会话归属，长期页面默认归属不受影响。 */
    async function cleanupClosedTabs(activeTabIds = []) {
      return runMutation(async () => {
        const state = await load();
        const session = await loadSession(state);
        const active = new Set(activeTabIds.filter(Number.isFinite).map(String));
        for (const tabId of Object.keys(session.tabAssignments)) {
          if (!active.has(tabId)) delete session.tabAssignments[tabId];
        }
        await saveSession(session, state);
        return clone(session);
      });
    }

    /** 读取最近一次撤销项，供真实 Chrome 操作协调器复用同一会话键。 */
    async function getUndoEntry() {
      return (await loadSession()).undoEntry;
    }

    /** 保存或清空最近一次撤销项；内容不得包含 URL 明文。 */
    async function setUndoEntry(undoEntry) {
      return runMutation(async () => {
        const state = await load();
        const session = await loadSession(state);
        session.undoEntry = undoEntry ? clone(undoEntry) : null;
        await saveSession(session, state);
        return session.undoEntry;
      });
    }

    return Object.freeze({
      load,
      loadSession,
      initializeFromDomainGroups,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      resolveWorkspace,
      assignTab,
      buildOrganization,
      cleanupClosedTabs,
      getUndoEntry,
      setUndoEntry,
    });
  }

  /** 在不支持 chrome.storage.session 的环境中提供当前进程内降级。 */
  function createMemoryStorageArea(seed = {}) {
    const store = { ...seed };
    return {
      async get(key) {
        if (typeof key === 'string') return { [key]: store[key] };
        return { ...store };
      },
      async set(values) {
        Object.assign(store, values);
      },
    };
  }

  const api = {
    SCHEMA_VERSION,
    LOCAL_KEY,
    SESSION_KEY,
    WRITE_LOCK_NAME,
    createEmptyState,
    createEmptySession,
    normalizePageUrl,
    createPageKey,
    normalizeState,
    normalizeSession,
    createMemoryStorageArea,
    createWorkspaceService,
  };

  globalScope.SuperTabOutWorkspace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

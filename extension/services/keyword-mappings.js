/* Xiaoyu Tab Manager：仅在本地保存用户指定的关键词与页面映射。 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'keywordPageMappings';
  const BACKUP_FORMAT = 'xiaoyu-tab-manager-shortcuts';
  const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
  const MAX_BACKUP_MAPPINGS = 5000;

  /** 忽略大小写和多余空白，但不对关键词做模糊语义推断。 */
  function normalizeKeyword(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  }

  /** 规范化多别名，拒绝未知类型并按忽略大小写的完整文本去重。 */
  function normalizeAliases(value = []) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('keywordInvalidAliases');
    const seen = new Set();
    return value.map(item => item.trim().replace(/\s+/g, ' ')).filter(item => {
      const key = normalizeKeyword(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** 校验表单边界，只允许网页网址并保留参数、顺序和片段。 */
  function validateMapping(value) {
    const keyword = typeof value?.keyword === 'string' ? value.keyword.trim().replace(/\s+/g, ' ') : '';
    const title = typeof value?.title === 'string' ? value.title.trim() : '';
    if (!keyword) throw new Error('keywordRequired');
    if (!title) throw new Error('keywordTitleRequired');
    let url;
    try { url = new URL(typeof value.url === 'string' ? value.url.trim() : ''); }
    catch { throw new Error('keywordInvalidUrl'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('keywordInvalidUrl');
    return { keyword, title, url: url.href, aliases: normalizeAliases(value.aliases) };
  }

  /** 合并组名、跨组页面名和别名匹配，保持保存顺序且每条映射只出现一次。 */
  function findMappings(rows, query) {
    const key = normalizeKeyword(query);
    if (!key) return [];
    const hasExactGroup = rows.some(row => normalizeKeyword(row.keyword) === key);
    return rows.filter(row => {
      const group = normalizeKeyword(row.keyword);
      return (hasExactGroup ? group === key : group.startsWith(key))
        || normalizeKeyword(row.title).includes(key)
        || (row.aliases || []).some(alias => normalizeKeyword(alias).includes(key));
    });
  }

  /** 完整校验版本化备份，任何坏记录都拒绝整份导入。 */
  function parseBackup(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('keywordBackupTooLarge');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('keywordBackupInvalid'); }
    if (data?.format !== BACKUP_FORMAT || data.version !== 1 || !Array.isArray(data.mappings)) throw new Error('keywordBackupInvalid');
    if (data.mappings.length > MAX_BACKUP_MAPPINGS) throw new Error('keywordBackupTooLarge');
    try { return data.mappings.map(validateMapping); } catch { throw new Error('keywordBackupInvalid'); }
  }

  /** 保留本机身份与标题，只添加新映射和新别名；预览不生成持久 ID。 */
  function mergeMappings(current, incoming, makeId) {
    const rows = current.map(row => ({ ...row, aliases: [...row.aliases] }));
    // 分组忽略大小写和多余空白，完整 URL 则保留参数及片段区别。
    const pairKey = row => JSON.stringify([normalizeKeyword(row.keyword), row.url]);
    const byPair = new Map(rows.map(row => [pairKey(row), row]));
    const original = new Set(byPair.keys());
    const visited = new Set();
    const summary = { added: 0, existing: 0, aliasesAdded: 0, total: 0 };
    for (const value of incoming) {
      const key = pairKey(value);
      let row = byPair.get(key);
      if (!visited.has(key)) {
        summary[row ? 'existing' : 'added'] += 1;
        visited.add(key);
      }
      if (!row) {
        row = { ...value, aliases: [...value.aliases], id: makeId ? makeId() : '' };
        rows.push(row);
        byPair.set(key, row);
      } else {
        const merged = normalizeAliases([...row.aliases, ...value.aliases]);
        if (original.has(key)) summary.aliasesAdded += merged.length - row.aliases.length;
        row.aliases = merged;
      }
    }
    summary.total = rows.length;
    return { rows, summary };
  }

  /** 通过现有存储边界创建服务，串行写入避免本页快速操作互相覆盖。 */
  function createService(storage = global.SuperTabOutStorage, makeId = () => global.crypto.randomUUID()) {
    let pending = Promise.resolve();

    /** 读取并严格检查已保存数据；损坏时停止写入而不是覆盖为默认空值。 */
    async function list() {
      const raw = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
      if (raw === undefined) return [];
      if (!Array.isArray(raw)) throw new Error('keywordDataError');
      const ids = new Set();
      const pairs = new Set();
      return raw.map(row => {
        let validated;
        try { validated = validateMapping(row); }
        catch { throw new Error('keywordDataError'); }
        if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('keywordDataError');
        const pair = JSON.stringify([normalizeKeyword(validated.keyword), validated.url]);
        if (pairs.has(pair)) throw new Error('keywordDataError');
        ids.add(row.id);
        pairs.add(pair);
        return { id: row.id, ...validated };
      });
    }

    /** 同源扩展页面使用 Web Lock 协调写入，测试环境使用本服务的串行队列。 */
    function mutate(operation) {
      const run = () => global.navigator?.locks
        ? global.navigator.locks.request(STORAGE_KEY, operation) : operation();
      const result = pending.then(run);
      pending = result.catch(() => {});
      return result;
    }

    /** 添加或更新单条映射；写入成功前不修改调用方列表。 */
    function save(draft) {
      return mutate(async () => {
        const validated = validateMapping(draft);
        const rows = await list();
        const index = draft.id ? rows.findIndex(row => row.id === draft.id) : -1;
        if (draft.id && index < 0) throw new Error('keywordMissing');
        if (rows.some(row => row.id !== draft.id
          && normalizeKeyword(row.keyword) === normalizeKeyword(validated.keyword)
          && row.url === validated.url)) throw new Error('keywordDuplicate');
        const row = { id: draft.id || makeId(), ...validated };
        if (index < 0) rows.push(row);
        else rows[index] = row;
        await storage.set({ [STORAGE_KEY]: rows });
        return row;
      });
    }

    /** 只删除指定 ID，其他页面刚保存的映射会被保留。 */
    function remove(id) {
      return mutate(async () => {
        const rows = await list();
        if (!rows.some(row => row.id === id)) throw new Error('keywordMissing');
        await storage.set({ [STORAGE_KEY]: rows.filter(row => row.id !== id) });
      });
    }

    /** 只导出映射，不包含 ID、窗口身份或其他扩展数据。 */
    async function exportBackup() {
      const rows = await list();
      return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(),
        mappings: rows.map(({ keyword, title, url, aliases }) => ({ keyword, title, url, aliases })) }, null, 2);
    }

    /** 在不写存储的前提下提供合并统计。 */
    async function previewImport(text) {
      const incoming = parseBackup(text);
      return mergeMappings(await list(), incoming).summary;
    }

    /** 确认时锁内重新合并并原子写入，失败不修改现有记录。 */
    function importBackup(text) {
      return mutate(async () => {
        const incoming = parseBackup(text);
        const result = mergeMappings(await list(), incoming, makeId);
        await storage.set({ [STORAGE_KEY]: result.rows });
        console.info('[Xiaoyu shortcuts] Backup merge persisted', result.summary);
        return result.summary;
      });
    }

    return { list, save, remove, exportBackup, previewImport, importBackup };
  }

  const api = { STORAGE_KEY, MAX_BACKUP_BYTES, normalizeKeyword, normalizeAliases, validateMapping, findMappings, parseBackup, createService };
  global.XiaoyuKeywordMappings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

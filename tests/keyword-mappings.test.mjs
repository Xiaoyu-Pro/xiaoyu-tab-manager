import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mappings = require('../extension/services/keyword-mappings.js');

/** 回归分组与跨组页面名匹配、完整网址、增改删持久化及失败隔离。 */
export async function testKeywordMappings() {
  const data = {};
  let failWrite = false;
  let nextId = 0;
  const storage = {
    /** 模拟扩展的本地键读取。 */
    async get(key) { return structuredClone({ [key]: data[key] }); },
    /** 模拟写入成功和配额失败。 */
    async set(value) {
      if (failWrite) throw new Error('quota exceeded');
      Object.assign(data, structuredClone(value));
    },
  };
  const service = mappings.createService(storage, () => `mapping-${++nextId}`);
  assert.deepEqual(await service.list(), []);
  assert.equal(mappings.normalizeKeyword('  BM   Main  '), 'bm main');

  const first = await service.save({ keyword: ' 看板 ', title: '主链路', url: 'https://example.test/a?b=2&a=1#hour' });
  const second = await service.save({ keyword: '看板', title: '<评测 & 对比>', url: 'https://example.test/b?token=sample&from=now' });
  await service.save({ keyword: '看板测试', title: '测试', url: 'https://test.example.test/' });
  let rows = await service.list();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].url, 'https://example.test/a?b=2&a=1#hour');
  assert.equal(rows[1].title, '<评测 & 对比>');
  assert.deepEqual(mappings.findMappings(rows, ' 看板 ').map(row => row.id), [first.id, second.id]);
  assert.equal(mappings.findMappings(rows, '看').length, 3);
  assert.deepEqual(mappings.findMappings(rows, ''), []);
  assert.deepEqual(mappings.findMappings(rows, 'unknown'), []);
  assert.deepEqual(mappings.findMappings(rows, '主链路').map(row => row.id), [first.id]);
  const crossGroup = [
    { id: 'dashboard', keyword: '看板', title: 'ARGALL 主链路', url: 'https://same.test/' },
    { id: 'service', keyword: 'tce', title: '服务 argall', url: 'https://same.test/' },
    { id: 'other', keyword: 'tce', title: '其他页面', url: 'https://example.test/argall' },
    { id: 'group-prefix', keyword: '看板测试', title: '测试', url: 'https://test.example/' },
  ];
  assert.deepEqual(mappings.findMappings(crossGroup, '  aRgAlL ').map(row => row.id), ['dashboard', 'service']);
  assert.deepEqual(mappings.findMappings(crossGroup, 'gall').map(row => row.id), ['dashboard', 'service']);
  assert.deepEqual(mappings.findMappings(crossGroup, '看板').map(row => row.id), ['dashboard']);
  assert.deepEqual(mappings.findMappings(crossGroup, 'tce').map(row => row.id), ['service', 'other']);
  const union = [...crossGroup, { id: 'exact-group', keyword: 'argall', title: 'argall 文档', url: 'https://doc.test/' }];
  assert.deepEqual(mappings.findMappings(union, 'argall').map(row => row.id), ['dashboard', 'service', 'exact-group']);
  assert.equal(mappings.findMappings(union, 'argall').filter(row => row.id === 'exact-group').length, 1);
  assert.deepEqual(mappings.findMappings(union, ''), []);
  assert.deepEqual(mappings.findMappings(union, 'https://same.test'), []);
  assert.equal(mappings.findMappings(Array.from({ length: 30 }, (_, index) => ({ id: `${index}`, keyword: '多页面', title: `${index}`, url: `https://example.test/${index}` })), '多页面').length, 30);

  await service.save({ keyword: 'BM Main', title: 'English', url: 'https://english.test/' });
  assert.equal(mappings.findMappings(await service.list(), ' bm   MAIN ').length, 1);
  await assert.rejects(service.save({ keyword: '看板', title: '重复', url: first.url }), /keywordDuplicate/);
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'file:///tmp/x', 'not a url']) {
    await assert.rejects(service.save({ keyword: 'bad', title: 'bad', url }), /keywordInvalidUrl/);
  }
  await assert.rejects(service.save({ keyword: ' ', title: 'bad', url: first.url }), /keywordRequired/);
  await assert.rejects(service.save({ keyword: 'bad', title: ' ', url: first.url }), /keywordTitleRequired/);

  await service.save({ ...second, keyword: '新词', title: '已修改' });
  rows = await service.list();
  assert.equal(rows.find(row => row.id === second.id).keyword, '新词');
  assert.equal(rows.find(row => row.id === second.id).title, '已修改');
  await service.remove(second.id);
  assert.equal((await service.list()).some(row => row.id === second.id), false);
  await assert.rejects(service.save({ ...second, title: '已被其他页面删除' }), /keywordMissing/);

  const reopened = mappings.createService(storage);
  assert.deepEqual(await reopened.list(), await service.list());
  const snapshot = structuredClone(data);
  failWrite = true;
  await assert.rejects(service.save({ keyword: '失败', title: '失败', url: 'https://fail.test/' }), /quota exceeded/);
  await assert.rejects(service.remove(first.id), /quota exceeded/);
  assert.deepEqual(data, snapshot);
  failWrite = false;
  await Promise.all([
    service.save({ keyword: '并发', title: 'A', url: 'https://a.test/' }),
    service.save({ keyword: '并发', title: 'B', url: 'https://b.test/' }),
  ]);
  assert.equal(mappings.findMappings(await service.list(), '并发').length, 2);

  data[mappings.STORAGE_KEY] = [{ id: 'damaged', keyword: '坏数据', title: '坏数据', url: 'javascript:alert(1)' }];
  const damaged = structuredClone(data);
  await assert.rejects(service.list(), /keywordDataError/);
  await assert.rejects(service.save({ keyword: '新增', title: '新增', url: 'https://new.test/' }), /keywordDataError/);
  assert.deepEqual(data, damaged);
  data[mappings.STORAGE_KEY] = null;
  await assert.rejects(service.list(), /keywordDataError/);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await testKeywordMappings();
  console.log('Keyword mapping tests passed.');
}

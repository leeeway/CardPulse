import { it } from 'node:test';
import assert from 'node:assert/strict';
import { filterExplanations } from '../src/core/explanation-filters.js';
const entries = [
  { included: true, reason: 'spend', transaction: { description: 'SHOP ONE' } },
  {
    included: true,
    reason: 'refund',
    transaction: { description: 'Shop Refund' },
  },
  {
    included: false,
    reason: 'channel',
    transaction: { description: 'SHOP TWO' },
  },
  { included: false, reason: 'merchant', transaction: {} },
];
it('逐笔说明可组合计入状态、精确原因与忽略大小写的描述搜索', () => {
  assert.deepEqual(filterExplanations(entries), entries);
  assert.deepEqual(
    filterExplanations(entries, {
      status: 'included',
      reason: 'refund',
      query: ' shop ',
    }),
    [entries[1]],
  );
  assert.deepEqual(
    filterExplanations(entries, { status: 'excluded', query: 'shop' }),
    [entries[2]],
  );
  assert.deepEqual(
    filterExplanations(entries, { status: 'included', reason: 'channel' }),
    [],
  );
  assert.deepEqual(filterExplanations(entries, { query: 'no match' }), []);
});
it('纠正后消失的原因产生空结果，不改变原说明、顺序或金额', () => {
  const original = structuredClone(entries);
  assert.deepEqual(filterExplanations(entries, { reason: 'future' }), []);
  assert.deepEqual(
    filterExplanations(entries, { status: 'excluded' }),
    entries.slice(2),
  );
  assert.deepEqual(entries, original);
});

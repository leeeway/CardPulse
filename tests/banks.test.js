import { it } from 'node:test';
import assert from 'node:assert/strict';
import { matchCardRule } from '../src/core/rules/registry.js';
import { calculateRewards } from '../src/core/rewards.js';
import { emptyWorkspace, normalizeWorkspace } from '../src/core/workspace.js';
import { mergeStatement } from '../src/core/imports.js';
it('其他银行和未识别银行绝不默认套用 Pulse 规则', () => {
  for (const [text, bank] of [
    ['BOCHK Cheers', 'bochk'],
    ['CNCBI Motion', 'cncb'],
    ['HANG SENG', 'hangseng'],
    ['STANDARD CHARTERED', 'sc'],
    ['CITIBANK', 'citi'],
    ['DBS', 'dbs'],
    ['UNIONPAY CARD', 'other'],
  ]) {
    const rule = matchCardRule(text);
    assert.equal(rule.bankId, bank);
    assert.notEqual(rule.id, 'hsbc_pulse');
  }
  assert.equal(matchCardRule('HSBC Pulse').id, 'hsbc_pulse');
  assert.equal(matchCardRule('HSBC Red Card').id, 'hsbc_red');
  const result = calculateRewards(
    [
      {
        bankId: 'bochk',
        day: '2026-01-01',
        amount: '1000',
        currency: 'CNY',
        direction: 'debit',
      },
    ],
    { today: '2026-01-02' },
  );
  assert.equal(result.totalCny, 0n);
});
it('兼容旧保险库，导入合并保留活动配置，异常结构不覆盖现有数据', () => {
  assert.deepEqual(normalizeWorkspace({ transactions: [] }), emptyWorkspace());
  const state = { ...emptyWorkspace(), campaigns: [{ id: 'keep' }] };
  const merged = mergeStatement(
    state,
    { fileName: 'new.csv', transactions: [], warnings: [] },
    'hash',
  );
  assert.deepEqual(merged.campaigns, state.campaigns);
  assert.throws(() => normalizeWorkspace(null));
  assert.throws(() => normalizeWorkspace({ transactions: [], campaigns: {} }));
});

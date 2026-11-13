import { it } from 'node:test';
import assert from 'node:assert/strict';
import { findPotentialDuplicates } from '../src/core/duplicate-transactions.js';
const statements = [
  { id: 's1', fileName: 'a.csv' },
  { id: 's2', fileName: 'b.csv' },
];
const tx = (patch = {}) => ({
  id: 's1:0',
  statementId: 's1',
  bankId: 'bochk',
  ruleId: 'bochk_custom',
  last4: '1234',
  day: '2026-11-01',
  description: 'SHOP  ONE',
  amount: '100.00',
  currency: 'HKD',
  direction: 'debit',
  category: 'spend',
  ...patch,
});
it('同名不同来源仍分开编号，来源对象保持原样', () => {
  const sources = statements.map((statement) => ({
    ...statement,
    fileName: 'same.csv',
  }));
  const result = findPotentialDuplicates(
    [tx(), tx({ id: 's2:0', statementId: 's2' })],
    sources,
  );
  assert.deepEqual(
    result.groups[0].entries.map((entry) => entry.statementNumber),
    [1, 2],
  );
  assert.ok(
    result.groups[0].entries.every(
      (entry) => entry.statement.fileName === 'same.csv',
    ),
  );
  assert.ok(sources.every((statement) => !Object.hasOwn(statement, 'number')));
});
it('跨结单按标准化证据分组，保留每份结单内所有记录，不修改原数据', () => {
  const transactions = [
    tx(),
    tx({ id: 's1:1' }),
    tx({
      id: 's2:0',
      statementId: 's2',
      description: ' shop\tone ',
      amount: '0100.0',
    }),
  ];
  const original = structuredClone({ transactions, statements });
  const result = findPotentialDuplicates(transactions, statements);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].entries.length, 3);
  assert.equal(result.checkedCount, 3);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.groups[0].entries[2].statement.fileName, 'b.csv');
  assert.deepEqual({ transactions, statements }, original);
  assert.equal(
    findPotentialDuplicates(transactions.slice(0, 2), statements).groups.length,
    0,
  );
});
it('银行、卡片、末四位、日期、币种、方向、金额或描述不同不会合并', () => {
  for (const patch of [
    { bankId: 'hsbc' },
    { ruleId: 'another' },
    { last4: '5678' },
    { last4: '' },
    { day: '2026-11-02' },
    { currency: 'CNY' },
    { direction: 'credit' },
    { amount: '100.01' },
    { description: 'SHOP-ONE' },
  ])
    assert.equal(
      findPotentialDuplicates(
        [tx(), tx({ id: 's2:0', statementId: 's2', ...patch })],
        statements,
      ).groups.length,
      0,
    );
});
it('人工修正及不计奖赏标记不隐藏证据，交易日期差异保留供人工判断', () => {
  const result = findPotentialDuplicates(
    [
      tx(),
      tx({
        id: 's2:0',
        statementId: 's2',
        category: 'fee',
        channel: { key: 'exclude' },
        transactionDay: '2026-10-31',
      }),
    ],
    statements,
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].entries[1].transaction.channel.key, 'exclude');
});
it('旧版关联支持精确的含冒号指纹，不猜测未知来源或相似前缀', () => {
  const legacy = [
    tx({ id: 'csv:bochk:card:hash:0', statementId: undefined }),
    tx({ id: 's2:0', statementId: undefined }),
  ];
  assert.equal(
    findPotentialDuplicates(legacy, [
      ...statements,
      { id: 'csv:bochk:card:hash' },
    ]).groups.length,
    1,
  );
  const result = findPotentialDuplicates(
    [
      tx({ id: 's1-extra:0', statementId: undefined }),
      tx({ id: 's2:0', statementId: 'missing' }),
    ],
    statements,
  );
  assert.equal(result.checkedCount, 0);
  assert.equal(result.skippedCount, 2);
});
it('缺失字段、空商户及损坏金额明确计为跳过，不误报全部已检查', () => {
  const records = [
    null,
    tx({ day: '2026-02-30' }),
    tx({ amount: 'bad' }),
    tx({ amount: '0' }),
    tx({ description: '  ' }),
    tx({ currency: 'USD' }),
    tx({ direction: 'unknown' }),
  ];
  const result = findPotentialDuplicates(records, statements);
  assert.equal(result.groups.length, 0);
  assert.equal(result.skippedCount, records.length);
});
it('一万笔记录检查保持稳定，整份结单移除后候选组消失', () => {
  const records = Array.from({ length: 10000 }, (_, index) =>
    tx({
      id: `${index < 5000 ? 's1' : 's2'}:${index}`,
      statementId: index < 5000 ? 's1' : 's2',
      description: `SHOP ${index % 5000}`,
    }),
  );
  const result = findPotentialDuplicates(records, statements);
  assert.equal(result.groups.length, 5000);
  assert.equal(result.checkedCount, 10000);
  assert.equal(
    findPotentialDuplicates(records.slice(0, 5000), statements.slice(0, 1))
      .groups.length,
    0,
  );
});

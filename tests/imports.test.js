import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatementImportSelection,
  fingerprintFile,
  mergeStatement,
  removeStatement,
  stageStatementSupplement,
} from '../src/core/imports.js';

it('同内容改名后导入不会重复计账，同名不同内容保留不同交易 ID', async () => {
  const first = new File(['pdf content'], 'a.pdf');
  const renamed = new File(['pdf content'], 'b.pdf');
  const different = new File(['different content'], 'a.pdf');
  const hash = await fingerprintFile(first);
  assert.equal(hash, await fingerprintFile(renamed));
  const statement = { fileName: first.name, transactions: [{ id: 'old', amount: '10.00' }], warnings: [] };
  const workspace = mergeStatement({ transactions: [], statements: [] }, statement, hash);
  const duplicate = mergeStatement(workspace, statement, await fingerprintFile(renamed));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.transactions.length, 1);
  const merged = mergeStatement(workspace, statement, await fingerprintFile(different));
  assert.equal(merged.transactions.length, 2);
  assert.notEqual(merged.transactions[0].id, merged.transactions[1].id);
  assert.equal(merged.statements[0].transactionCount, 1);
  assert.equal(statement.transactions[0].id, 'old');
});

it('标准 CSV 按银行及卡片隔离指纹，避免把不同银行的相同明细当成重复', async () => {
  const file = new File(['same normalized rows'], 'transactions.csv');
  const renamed = new File(['same normalized rows'], 'renamed.csv');
  const boc = { bankId: 'bochk', cardId: 'bochk_custom' };
  const hsbc = { bankId: 'hsbc', cardId: 'hsbc_pulse' };
  assert.equal(await fingerprintFile(file, boc), await fingerprintFile(renamed, boc));
  assert.notEqual(await fingerprintFile(file, boc), await fingerprintFile(file, hsbc));
});

it('筛选待入账交易保留其 ID、原始对账和文件指纹，整份跳过不登记文件', () => {
  const statement = {
    fileName: 'statement.pdf',
    reconciliation: [
      { currency: 'HKD', status: 'matched', difference: '0.00' },
    ],
    transactions: [{ amount: '10.00' }, { amount: '20.00' }],
  };
  const existing = mergeStatement(
    { statements: [], transactions: [] },
    statement,
    'existing',
  );
  const staged = mergeStatement(
    mergeStatement(existing, statement, 'partial'),
    statement,
    'full',
  );
  const original = structuredClone(staged);
  const filtered = applyStatementImportSelection(
    staged,
    new Set(['partial:0', 'partial:1', 'full:0', 'full:1']),
    new Set(['existing:0', 'partial:0', 'full:0', 'full:1', 'unknown:0']),
  );
  assert.deepEqual(
    filtered.transactions.map(({ id }) => id),
    ['existing:0', 'existing:1', 'partial:1'],
  );
  assert.equal(filtered.statements[0], existing.statements[0]);
  assert.deepEqual(filtered.statements[1], {
    ...staged.statements[1],
    transactionCount: 1,
    skippedTransactionCount: 1,
  });
  assert.equal(filtered.statements.length, 2);
  assert.equal(mergeStatement(filtered, statement, 'partial').duplicate, true);
  assert.equal(mergeStatement(filtered, statement, 'full').duplicate, false);
  assert.deepEqual(
    removeStatement(filtered, 'partial').transactions,
    existing.transactions,
  );
  assert.deepEqual(staged, original);
});

it('补录使用原始行号，保留已有修正、结单和对账，只追加选择的交易', () => {
  const statement = {
    fileName: 'original.csv',
    bankId: 'hsbc',
    ruleId: 'hsbc_pulse',
    reconciliation: [
      { currency: 'HKD', status: 'unverified', difference: null },
    ],
    transactions: [10, 20, 30].map((amount, index) => ({
      amount: `${amount}.00`,
      description: `Merchant ${index}`,
      category: 'spend',
      sources: [{ fileName: 'original.csv', row: index + 2 }],
    })),
  };
  const staged = mergeStatement(
    { statements: [], transactions: [] },
    statement,
    'hash',
  );
  const workspace = applyStatementImportSelection(
    staged,
    new Set(['hash:0', 'hash:1', 'hash:2']),
    new Set(['hash:0', 'hash:2']),
  );
  const reviewed = {
    ...workspace.transactions[0],
    category: 'fee',
    reviewHistory: [
      { before: { category: 'spend' }, after: { category: 'fee' } },
    ],
  };
  workspace.transactions = [reviewed];
  const original = structuredClone(workspace);

  const supplement = stageStatementSupplement(workspace, statement, 'hash');
  assert.deepEqual(
    supplement.transactions.map(({ id }) => id),
    ['hash:1', 'hash:0', 'hash:2'],
  );
  const first = applyStatementImportSelection(
    supplement,
    new Set(['hash:0', 'hash:2']),
    new Set(['hash:2', 'hash:1']),
  );
  assert.equal(first.transactions[0], reviewed);
  assert.equal(first.statements.length, 1);
  assert.equal(first.statements[0].skippedTransactionCount, 1);
  assert.equal(first.statements[0].transactionCount, 2);
  assert.equal(
    first.statements[0].reconciliation,
    workspace.statements[0].reconciliation,
  );

  const full = stageStatementSupplement(first, statement, 'hash');
  assert.deepEqual(
    full.transactions.map(({ id }) => id),
    ['hash:1', 'hash:0', 'hash:2'],
  );
  assert.equal(full.statements[0].transactionCount, 3);
  assert.equal(full.statements[0].skippedTransactionCount, undefined);
  assert.equal(mergeStatement(full, statement, 'hash').duplicate, true);
  assert.deepEqual(workspace, original);

  for (const parsed of [
    { ...statement, transactions: statement.transactions.slice(1) },
    {
      ...statement,
      transactions: [
        statement.transactions[1],
        statement.transactions[0],
        statement.transactions[2],
      ],
    },
    {
      ...statement,
      transactions: [
        statement.transactions[0],
        { ...statement.transactions[1], amount: '99.00' },
        statement.transactions[2],
      ],
    },
  ])
    assert.throws(
      () => stageStatementSupplement(workspace, parsed, 'hash'),
      /无法安全补录/,
    );
  assert.throws(
    () =>
      stageStatementSupplement(
        {
          ...workspace,
          transactions: [reviewed, { id: 'hash:2', statementId: 'another' }],
        },
        statement,
        'hash',
      ),
    /无法安全补录/,
  );
});

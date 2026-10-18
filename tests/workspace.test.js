import { it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, normalizeWorkspace } from '../src/core/workspace.js';
import { encryptData } from '../src/core/crypto.js';
import { decryptWorkspace } from '../src/core/backup.js';
import { validateCampaign } from '../src/core/campaigns.js';

const transaction = () => ({
  id: 'tx1',
  day: '2026-10-01',
  description: 'Example',
  amount: '10.00',
  currency: 'HKD',
  direction: 'debit',
});
const workspace = () => ({
  ...emptyWorkspace(),
  transactions: [transaction()],
});
const campaign = () => ({
  id: 'c1',
  name: 'Example',
  bankId: 'bochk',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  ratePercent: '2',
  period: 'monthly',
  dateBasis: 'posting',
  channel: 'any',
});

it('旧版缺省字段仍可读取，未知库版本不会被静默降级', () => {
  for (const version of [undefined, 1, 2]) {
    const result = normalizeWorkspace({
      version,
      transactions: [transaction()],
    });
    assert.equal(result.version, 2);
    assert.deepEqual(result.statements, []);
    assert.deepEqual(result.campaigns, []);
  }
  for (const version of [0, 3, '2', {}, 2.5])
    assert.throws(
      () => normalizeWorkspace({ ...workspace(), version }),
      /版本/,
    );
});
it('拒绝重复、空白和非字符串记录标识', () => {
  for (const field of ['transactions', 'statements', 'campaigns']) {
    const value =
      field === 'transactions'
        ? transaction()
        : field === 'campaigns'
          ? campaign()
          : { id: 's1' };
    for (const records of [
      [value, value],
      [{ ...value, id: ' ' }],
      [{ ...value, id: 2 }],
    ])
      assert.throws(() =>
        normalizeWorkspace({ ...workspace(), [field]: records }),
      );
  }
});
it('拒绝会破坏搜索、导出、渲染或计算的交易字段', () => {
  for (const patch of [
    { transactionDay: '2026-02-30' },
    { bankId: {} },
    { ruleId: [] },
    { last4: 1234 },
    { category: {} },
    { notes: ['ok', null] },
    { sources: 'file' },
    { sources: [null] },
    { sources: [{ fileName: {} }] },
    { channel: 'online' },
    { channel: [] },
    { channel: { key: {} } },
    { channel: { key: 'online', uncertain: 'false' } },
    { channel: { key: 'standard', pulse: 'false' } },
  ])
    assert.throws(() =>
      normalizeWorkspace({
        ...workspace(),
        transactions: [{ ...transaction(), ...patch }],
      }),
    );
});
it('拒绝无法显示的结单摘要与对账记录', () => {
  for (const statement of [
    null,
    { id: 's1', warnings: 'warning' },
    { id: 's1', warnings: [{}] },
    { id: 's1', fileName: {} },
    { id: 's1', reconciliation: {} },
    { id: 's1', reconciliation: [null] },
    {
      id: 's1',
      reconciliation: [{ currency: 'HKD', status: 'matched', difference: {} }],
    },
    { id: 's1', transactionCount: -1 },
  ])
    assert.throws(() =>
      normalizeWorkspace({ ...workspace(), statements: [statement] }),
    );
});
it('损坏活动返回可理解的错误，字段不会通过隐式转换被接受', () => {
  for (const value of [
    null,
    [],
    42,
    { ...campaign(), name: {} },
    { ...campaign(), merchant: 123 },
    { ...campaign(), last4: 1234 },
    { ...campaign(), ratePercent: [2] },
    { ...campaign(), registrationConfirmed: 'true' },
  ])
    assert.throws(
      () => validateCampaign(value),
      (error) => !(error instanceof TypeError),
    );
});
it('加密正确但内容损坏的备份在恢复前被拒绝；有效嵌套信息完整保留', async () => {
  const data = workspace();
  data.transactions[0] = {
    ...transaction(),
    transactionDay: '',
    last4: '',
    channel: { key: 'standard', uncertain: true, pulse: false },
    notes: ['Note'],
    sources: [{ fileName: 'example.csv', row: 2 }],
  };
  data.statements = [
    {
      id: 's1',
      fileName: 'example.csv',
      warnings: ['Verify'],
      transactionCount: 1,
      reconciliation: [
        { currency: 'HKD', status: 'unverified', difference: null },
      ],
    },
  ];
  const payload = await encryptData(data, 'password');
  assert.deepEqual(await decryptWorkspace(payload, 'password'), data);
  const corrupt = await encryptData(
    { ...data, statements: [null] },
    'password',
  );
  await assert.rejects(decryptWorkspace(corrupt, 'password'), /格式无效/);
});

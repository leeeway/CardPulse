import { channelText, translate } from '../src/core/i18n.js';
import { cardName } from '../src/core/banks.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewTransaction, categoryText } from '../src/core/review.js';
import { emptyWorkspace, normalizeWorkspace } from '../src/core/workspace.js';
import { mergeStatement, removeStatement } from '../src/core/imports.js';
import { calculateRewards, fromScaledBigInt } from '../src/core/rewards.js';
import { calculateCampaign } from '../src/core/campaigns.js';
import { encryptWorkspace, decryptWorkspace } from '../src/core/backup.js';
import {
  exportToSafeCsv,
  filterTransactions,
} from '../src/core/transactions.js';
const tx = (patch = {}) => ({
  id: 't1',
  bankId: 'hsbc',
  ruleId: 'hsbc_pulse',
  day: '2026-10-01',
  amount: '100.00',
  currency: 'CNY',
  description: 'TEST SHOP',
  direction: 'debit',
  category: 'spend',
  channel: { key: 'standard', uncertain: true },
  sources: [{ fileName: 'example.csv', row: 2 }],
  ...patch,
});
const data = () => ({ ...emptyWorkspace(), transactions: [tx()] });
const options = { today: '2026-10-18' };
const reward = (workspace) =>
  fromScaledBigInt(calculateRewards(workspace.transactions, options).totalCny);

it('修正渠道重算 Pulse 和活动奖赏，保留原始证据及有序修改记录', async () => {
  const original = data();
  assert.equal(reward(original), '2.40');
  const reviewed = reviewTransaction(
    original,
    't1',
    { category: 'spend', channel: 'applePay' },
    '2026-10-18T00:00:00Z',
  );
  assert.equal(reward(reviewed), '4.40');
  assert.equal(
    calculateRewards(reviewed.transactions, options).pendingCount,
    0,
  );
  const campaign = {
    id: 'c1',
    name: 'Example',
    bankId: 'hsbc',
    currency: 'CNY',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    period: 'campaign',
    dateBasis: 'posting',
    channel: 'applePay',
    ratePercent: '5',
    registrationConfirmed: true,
  };
  assert.equal(
    fromScaledBigInt(
      calculateCampaign(original.transactions, campaign, options).cashback,
    ),
    '0.00',
  );
  assert.equal(
    fromScaledBigInt(
      calculateCampaign(reviewed.transactions, campaign, options).cashback,
    ),
    '5.00',
  );
  assert.equal(original.transactions[0].channel.key, 'standard');
  assert.deepEqual(
    reviewed.transactions[0].reviewHistory[0].before.channel,
    original.transactions[0].channel,
  );
  for (const field of ['amount', 'day', 'sources', 'description'])
    assert.deepEqual(
      reviewed.transactions[0][field],
      original.transactions[0][field],
    );
  const excluded = reviewTransaction(reviewed, 't1', {
    category: 'fee',
    channel: 'exclude',
  });
  assert.equal(reward(excluded), '0.00');
  assert.equal(excluded.transactions[0].reviewHistory.length, 2);
  assert.equal(
    filterTransactions(excluded.transactions, { category: 'fee' }).length,
    1,
  );
  const restored = await decryptWorkspace(
    await encryptWorkspace(excluded, 'password'),
    'password',
  );
  assert.deepEqual(restored, excluded);
  assert.match(exportToSafeCsv(restored.transactions), /不计奖赏/);
});
it('还款改为退款后扣回奖赏，方向冲突、未知渠道及缺失交易不能修改', () => {
  const original = {
    ...data(),
    transactions: [
      tx({ channel: { key: 'applePay' } }),
      tx({
        id: 't2',
        direction: 'credit',
        category: 'repayment',
        amount: '10.00',
        channel: { key: 'applePay' },
      }),
    ],
  };
  assert.equal(reward(original), '4.40');
  const reviewed = reviewTransaction(original, 't2', {
    category: 'credit',
    channel: 'applePay',
  });
  assert.equal(reward(reviewed), '3.96');
  assert.equal(
    reviewTransaction(reviewed, 't2', {
      category: 'credit',
      channel: 'applePay',
    }),
    reviewed,
  );
  for (const [id, patch] of [
    ['t1', { category: 'repayment', channel: 'standard' }],
    ['t2', { category: 'spend', channel: 'standard' }],
    ['t1', { category: 'spend', channel: 'unknown' }],
    ['missing', { category: 'spend', channel: 'standard' }],
  ])
    assert.throws(() => reviewTransaction(original, id, patch));
});
it('删除按导入关联，兼容旧指纹、同名文件及前缀相似的 ID，允许重新导入', () => {
  const statement = {
    fileName: 'same.csv',
    transactions: [tx()],
    warnings: [],
  };
  const first = mergeStatement(
    {
      ...data(),
      campaigns: [{ id: 'keep' }],
      exchangeRate: { rate: 0.9, date: '2026-10-18', source: 'manual' },
    },
    statement,
    'hash',
  );
  const both = mergeStatement(first, statement, 'hash:other');
  // Legacy imports did not carry statementId.
  const legacy = { ...both.transactions[1] };
  delete legacy.statementId;
  const state = {
    ...both,
    transactions: [both.transactions[0], legacy, both.transactions[2]],
  };
  const removed = removeStatement(state, 'hash');
  assert.deepEqual(
    removed.transactions.map((entry) => entry.id),
    ['t1', 'hash:other:0'],
  );
  assert.deepEqual(
    removed.statements.map((entry) => entry.id),
    ['hash:other'],
  );
  assert.equal(removed.campaigns, state.campaigns);
  assert.equal(removed.exchangeRate, state.exchangeRate);
  assert.equal(state.transactions.length, 3);
  assert.equal(removeStatement(state, 'missing'), state);
  assert.equal(
    mergeStatement(removed, statement, 'hash').transactions.length,
    3,
  );
});
it('损坏的修改记录不能恢复进本地库', () => {
  for (const history of [
    {},
    [null],
    [{ at: 'bad', before: {}, after: {} }],
    [
      {
        at: '2026-10-18T00:00:00Z',
        before: { category: {} },
        after: { category: 'fee' },
      },
    ],
    [{ at: '2026-10-18T00:00:00Z', before: { channel: [] }, after: {} }],
  ])
    assert.throws(() =>
      normalizeWorkspace({
        ...data(),
        transactions: [tx({ reviewHistory: history })],
      }),
    );
});

it('未知字段不会读取标签字典的继承属性或导致页面报错', () => {
  for (const key of ['constructor', '__proto__', 'toString']) {
    assert.equal(categoryText(key), '未知');
    assert.equal(channelText(key), '待确认渠道');
    assert.equal(cardName(key), '自定义卡片');
    assert.equal(translate('zh-TW', key), key);
  }
});

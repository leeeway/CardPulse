import { channelText, translate } from '../src/core/i18n.js';
import { cardName } from '../src/core/banks.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewTransaction,
  reviewTransactions,
  undoBatchReview,
  restoreImportedReview,
  canRestoreImportedReview,
  categoryText,
} from '../src/core/review.js';
import { previewReviewRewards } from '../src/core/review-rewards.js';
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

it('整批撤销恢复各笔先前状态和奖赏，保留其后对无关交易的修改', () => {
  const first = tx({
    channel: { key: 'applePay', label: '原备注', uncertain: true, pulse: true },
  });
  const second = tx({ id: 't2', category: 'fee' });
  const original = {
    ...data(),
    transactions: [first, second, tx({ id: 'other' })],
  };
  const { workspace, changes } = reviewTransactions(original, ['t1', 't2'], {
    category: 'spend',
    channel: 'exclude',
  });
  const withIndependentEdit = reviewTransaction(workspace, 'other', {
    category: 'fee',
    channel: 'online',
  });
  const undone = undoBatchReview(withIndependentEdit, changes);
  assert.deepEqual(undone.transactions[0].channel, first.channel);
  assert.equal(undone.transactions[1].category, 'fee');
  assert.equal(undone.transactions[2], withIndependentEdit.transactions[2]);
  assert.ok(
    undone.transactions
      .slice(0, 2)
      .every(
        (tx) =>
          tx.reviewHistory.length === 2 &&
          tx.reviewHistory[1].action === 'undoBatch',
      ),
  );
  assert.equal(reward(undone), '4.40');
  assert.equal(workspace.transactions[0].channel.key, 'exclude');
});

it('涉及交易被删除或重改时整批拒绝，旧撤销记录不能重复应用', () => {
  const original = { ...data(), transactions: [tx(), tx({ id: 't2' })] };
  const { workspace, changes } = reviewTransactions(original, ['t1', 't2'], {
    channel: 'exclude',
  });
  const edited = reviewTransaction(workspace, 't2', {
    category: 'fee',
    channel: 'standard',
  });
  const deleted = { ...workspace, transactions: [workspace.transactions[0]] };
  for (const current of [
    edited,
    deleted,
    undoBatchReview(workspace, changes),
  ]) {
    assert.throws(() => undoBatchReview(current, changes), /已改动或删除/);
  }
  assert.equal(edited.transactions[0], workspace.transactions[0]);
  assert.equal(edited.transactions[1].reviewHistory.length, 2);
});

it('从首次历史恢复缺省分类或渠道，原始记录和恢复历史可经加密备份往返', async () => {
  const original = {
    ...data(),
    transactions: [tx({ category: undefined, channel: null })],
  };
  const updated = reviewTransaction(original, 't1', {
    category: 'spend',
    channel: 'applePay',
  });
  const reopened = await decryptWorkspace(
    await encryptWorkspace(updated, 'test password'),
    'test password',
  );
  assert.equal(canRestoreImportedReview(reopened.transactions[0]), true);
  const restored = restoreImportedReview(reopened, 't1');
  assert.equal(restored.transactions[0].category, null);
  assert.equal(restored.transactions[0].channel, null);
  assert.equal(restored.transactions[0].amount, '100.00');
  assert.deepEqual(
    restored.transactions[0].sources,
    original.transactions[0].sources,
  );
  assert.equal(
    restored.transactions[0].reviewHistory[1].action,
    'restoreImported',
  );
  assert.equal(restoreImportedReview(restored, 't1'), restored);
  assert.deepEqual(
    await decryptWorkspace(
      await encryptWorkspace(restored, 'test password'),
      'test password',
    ),
    restored,
  );
});

it('批次只修改指定字段并逐笔保留原始证据，重复选择或无变化不会重复写入日志', () => {
  const first = tx();
  const second = tx({
    id: 't2',
    category: 'fee',
    channel: { key: 'online', uncertain: true },
  });
  const unrelated = tx({ id: 'other' });
  const original = { ...data(), transactions: [first, second, unrelated] };
  const at = '2026-11-20T04:00:00.000Z';
  const result = reviewTransactions(
    original,
    ['t1', 't2', 't2'],
    { category: 'fee' },
    at,
  );
  assert.equal(result.changes.length, 1);
  assert.equal(result.workspace.transactions[0].category, 'fee');
  assert.equal(result.workspace.transactions[0].channel, first.channel);
  assert.equal(result.workspace.transactions[0].sources, first.sources);
  assert.deepEqual(result.workspace.transactions[0].reviewHistory[0], {
    at,
    before: { category: 'spend', channel: first.channel },
    after: { category: 'fee', channel: first.channel },
  });
  assert.equal(result.workspace.transactions[1], second);
  assert.equal(result.workspace.transactions[2], unrelated);
  assert.equal(first.category, 'spend');
  assert.equal(
    reviewTransactions(result.workspace, ['t1', 't2'], { category: 'fee' })
      .workspace,
    result.workspace,
  );
});

it('批次方向冲突、币种限制或过期选择整体拒绝，混合收支可修改渠道', () => {
  const original = {
    ...data(),
    transactions: [
      tx(),
      tx({ id: 'credit', direction: 'credit', category: 'repayment' }),
    ],
  };
  for (const [ids, patch] of [
    [['t1', 'credit'], { category: 'fee' }],
    [['t1', 'missing'], { channel: 'exclude' }],
    [['t1', 'credit'], { channel: 'baseOnly' }],
    [Array.from({ length: 101 }, (_, i) => `t${i}`), { channel: 'exclude' }],
  ])
    assert.throws(() => reviewTransactions(original, ids, patch));
  assert.ok(
    original.transactions.every(
      (tx) => tx.channel.uncertain && !tx.reviewHistory,
    ),
  );
  const result = reviewTransactions(original, ['t1', 'credit'], {
    channel: 'exclude',
  });
  assert.equal(result.changes.length, 2);
  assert.deepEqual(
    result.workspace.transactions.map((tx) => tx.category),
    ['spend', 'repayment'],
  );
  assert.ok(
    result.workspace.transactions.every(
      (tx) => tx.channel.key === 'exclude' && !tx.channel.uncertain,
    ),
  );
});

it('批量奖赏预览按原币区分 Pulse，活动单独重算且不改原工作区', () => {
  const original = {
    ...data(),
    transactions: [tx(), tx({ id: 'hkd', currency: 'HKD' })],
    campaigns: [
      {
        id: 'eligible',
        name: 'Apple Pay offer',
        bankId: 'hsbc',
        currency: 'CNY',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        period: 'monthly',
        dateBasis: 'posting',
        channel: 'applePay',
        ratePercent: '5',
        registrationConfirmed: true,
      },
    ],
  };
  const result = reviewTransactions(original, ['t1', 'hkd'], {
    channel: 'applePay',
  });
  assert.deepEqual(
    previewReviewRewards(
      original,
      result.workspace,
      result.changes,
      options.today,
    ).map(({ key, previous, next }) => [
      key,
      fromScaledBigInt(previous),
      fromScaledBigInt(next),
    ]),
    [
      ['pulse:cny', '2.40', '4.40'],
      ['campaign:eligible', '0.00', '5.00'],
    ],
  );
  const excluded = reviewTransactions(original, ['hkd'], {
    channel: 'exclude',
  });
  assert.deepEqual(
    previewReviewRewards(
      original,
      excluded.workspace,
      excluded.changes,
      options.today,
    ).map(({ key, previous, next }) => [
      key,
      fromScaledBigInt(previous),
      fromScaledBigInt(next),
    ]),
    [['pulse:hkd', '0.40', '0.00']],
  );
  assert.ok(original.transactions.every((tx) => !tx.reviewHistory));
});

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

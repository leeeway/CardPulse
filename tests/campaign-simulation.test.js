import { it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateCampaignSpend } from '../src/core/campaign-simulation.js';
import { fromScaledBigInt } from '../src/core/rewards.js';
const campaign = (patch = {}) => ({
  id: 'simulation-rule',
  name: 'Example',
  bankId: 'bochk',
  cardId: '',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  period: 'monthly',
  dateBasis: 'posting',
  channel: 'any',
  ratePercent: '5',
  spendingCap: '',
  rewardCap: '',
  minSpend: '',
  registrationConfirmed: true,
  ...patch,
});
const tx = (amount, patch = {}) => ({
  id: crypto.randomUUID(),
  bankId: 'bochk',
  currency: 'HKD',
  day: '2026-11-10',
  description: 'SHOP',
  amount,
  direction: 'debit',
  category: 'spend',
  ...patch,
});
const simulate = (transactions, patch = {}, options = {}) =>
  simulateCampaignSpend(transactions, campaign(patch), {
    amount: '100',
    date: '2026-11-11',
    today: '2026-11-11',
    ...options,
  });
const money = fromScaledBigInt;

it('试算重用筛选条件，原始工作区及规则保持不变，不返回改写后的账本', () => {
  const transactions = [
    tx('900', {
      last4: '1234',
      ruleId: 'bochk_custom',
      channel: { key: 'online' },
    }),
    tx('9999', { bankId: 'hsbc' }),
  ];
  const input = campaign({
    last4: '1234',
    cardId: 'bochk_custom',
    channel: 'online',
    merchant: 'SHOP',
  });
  const original = structuredClone({ transactions, input });
  Object.freeze(transactions);
  const result = simulateCampaignSpend(transactions, input, {
    amount: 100,
    date: '2026-11-11',
    today: '2026-11-11',
  });
  assert.equal(money(result.before.cashback), '45.00');
  assert.equal(money(result.after.cashback), '50.00');
  assert.equal(money(result.delta), '5.00');
  assert.equal(result.amount, '100.00');
  assert.equal(result.after.remaining, null);
  assert.deepEqual({ transactions, input }, original);
  assert.ok(!Object.hasOwn(result, 'transactions'));
});
it('跨过净消费门槛时重算整个周期，上限耗尽时增量为零', () => {
  const result = simulate([tx('900')], { minSpend: '1000' });
  assert.equal(money(result.before.cashback), '0.00');
  assert.equal(money(result.delta), '50.00');
  assert.equal(money(result.before.thresholdGap), '100.00');
  assert.equal(result.after.thresholdGap, 0n);
  const capped = simulate([tx('1000')], { spendingCap: '1000' });
  assert.equal(capped.delta, 0n);
  assert.equal(capped.after.remaining, 0n);
  assert.equal(simulate([tx('1000')], { rewardCap: '20' }).delta, 0n);
});
it('无交易周期从零开始，消费门槛和额度均按目标周期判断', () => {
  const result = simulate(
    [tx('900')],
    { spendingCap: '1000', minSpend: '500' },
    { date: '2026-12-01', amount: '500' },
  );
  assert.equal(result.period, '2026-12');
  assert.equal(result.before.cashback, 0n);
  assert.equal(money(result.before.remaining), '1000.00');
  assert.equal(money(result.after.remaining), '500.00');
  assert.equal(money(result.after.cashback), '25.00');
});
it('结单边界及交易日期口径沿用活动模型，不把旧周期消费带入新周期', () => {
  const existing = [
    tx('900', { day: '2026-11-26', transactionDay: '2026-11-25' }),
  ];
  const patch = {
    period: 'statement',
    statementDay: '25',
    dateBasis: 'transaction',
  };
  const old = simulate(existing, patch, { date: '2026-11-25' });
  assert.equal(old.period, '2026-10-26 → 2026-11-25');
  assert.equal(money(old.before.cashback), '45.00');
  const next = simulate(existing, patch, { date: '2026-11-26' });
  assert.equal(next.period, '2026-11-26 → 2026-12-25');
  assert.equal(next.before.cashback, 0n);
});
it('未来日期对前后两组使用相同截止日，已导入的未来交易不冒充新增奖赏', () => {
  const existing = [
    tx('200', { day: '2026-12-01' }),
    tx('9999', { day: '2026-12-02' }),
  ];
  const result = simulate(existing, {}, { date: '2026-12-01' });
  assert.equal(result.cutoff, '2026-12-01');
  assert.equal(money(result.before.cashback), '10.00');
  assert.equal(money(result.after.cashback), '15.00');
  assert.equal(money(result.delta), '5.00');
  const past = simulate([], {}, { date: '2026-01-01' });
  assert.equal(past.cutoff, '2026-11-11');
});
it('分段、退款和奖赏封顶可使增量为负，完整保留模型结果', () => {
  const patch = {
    rewardType: 'progressive',
    ratePercent: '0',
    tiers: [
      { from: '0', ratePercent: '1' },
      { from: '1000', ratePercent: '3' },
    ],
  };
  const progressive = simulate([tx('900')], patch, { amount: '200' });
  assert.equal(money(progressive.delta), '4.00');
  const negative = simulate(
    [tx('1000'), tx('600', { direction: 'credit' })],
    { ...patch, rewardCap: '10' },
    { amount: '500' },
  );
  assert.equal(money(negative.before.cashback), '4.00');
  assert.equal(negative.after.cashback, 0n);
  assert.equal(money(negative.delta), '-4.00');
});
it('拒绝未确认资格、无效日期、越界日期及非正或精度不符的金额', () => {
  assert.throws(
    () => simulate([], { registrationConfirmed: false }),
    /确认活动资格/,
  );
  for (const amount of ['', 0, '-1', '0.001', 'bad', false, null, {}, Infinity])
    assert.throws(() => simulate([], {}, { amount }));
  for (const date of ['2026-02-30', '2025-12-31', '2027-01-01', null])
    assert.throws(() => simulate([], {}, { date }), /试算日期/);
  assert.throws(() => simulate([], {}, { today: 'invalid' }), /试算截止日/);
  assert.equal(money(simulate([], {}, { amount: '0.01' }).delta), '0.00');
});

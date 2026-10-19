import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCampaign,
  validateCampaign,
  explainCampaignTransactions,
} from '../src/core/campaigns.js';
import { fromScaledBigInt } from '../src/core/rewards.js';

const campaign = (patch) => ({
  id: 'c1',
  name: 'Custom',
  bankId: 'bochk',
  cardId: '',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  ratePercent: '2.50',
  period: 'monthly',
  dateBasis: 'posting',
  channel: 'any',
  spendingCap: '1000.00',
  rewardCap: '',
  minSpend: '',
  merchant: '',
  last4: '',
  registrationConfirmed: true,
  ...patch,
});
const tx = (amount, patch = {}) => ({
  id: crypto.randomUUID(),
  bankId: 'bochk',
  ruleId: 'bochk_custom',
  day: '2026-01-03',
  transactionDay: '2026-01-02',
  description: 'Example Shop',
  amount,
  currency: 'HKD',
  direction: 'debit',
  category: 'spend',
  last4: '1234',
  channel: { key: 'online' },
  ...patch,
});
const calculate = (transactions, patch = {}) =>
  calculateCampaign(transactions, campaign(patch), { today: '2026-12-31' });

describe('自定义活动精确计算', () => {
  it('按银行、币种、卡片、卡号、渠道及商户筛选', () => {
    const transactions = [
      tx('100.00'),
      tx('1000.00', { bankId: 'hsbc' }),
      tx('1000.00', { currency: 'CNY' }),
      tx('1000.00', { last4: '5678' }),
      tx('1000.00', { channel: { key: 'other' } }),
      tx('1000.00', { description: 'Other' }),
      tx('1000.00', { ruleId: 'wrong' }),
    ];
    const result = calculate(transactions, {
      cardId: 'bochk_custom',
      last4: '1234',
      channel: 'online',
      merchant: 'SHOP',
    });
    assert.equal(result.matchedCount, 1);
    assert.equal(fromScaledBigInt(result.cashback), '2.50');
  });
  it('消费封顶、退款扣回且不释放额度，结果不受输入顺序影响', () => {
    const transactions = [
      tx('1500.00'),
      tx('100.00', { direction: 'credit', category: 'credit' }),
      tx('200.00'),
    ];
    for (const entries of [transactions, [...transactions].reverse()]) {
      const result = calculate(entries);
      assert.equal(fromScaledBigInt(result.cashback), '22.50');
      assert.equal(result.periods[0].remaining, 0n);
      assert.equal(fromScaledBigInt(result.periods[0].gross), '1700.00');
    }
  });
  it('奖赏封顶后再扣退款，退款不回补封顶奖赏', () => {
    const result = calculate(
      [
        tx('2000.00'),
        tx('100.00', { direction: 'credit', category: 'credit' }),
      ],
      { spendingCap: '', rewardCap: '20.00' },
    );
    assert.equal(fromScaledBigInt(result.cashback), '17.50');
  });
  it('自然月、半年、年度和活动周期分别重置', () => {
    const transactions = [
      tx('2000.00'),
      tx('2000.00', { day: '2026-02-01' }),
      tx('2000.00', { day: '2026-07-01' }),
    ];
    assert.equal(fromScaledBigInt(calculate(transactions).cashback), '75.00');
    assert.equal(
      fromScaledBigInt(
        calculate(transactions, { period: 'halfYear' }).cashback,
      ),
      '50.00',
    );
    assert.equal(
      fromScaledBigInt(calculate(transactions, { period: 'yearly' }).cashback),
      '25.00',
    );
    assert.equal(
      fromScaledBigInt(
        calculate(transactions, { period: 'campaign' }).cashback,
      ),
      '25.00',
    );
    const crossYear = calculateCampaign(
      [tx('2000.00', { day: '2025-12-31' }), tx('2000.00')],
      campaign({ startDate: '2025-01-01', period: 'yearly' }),
      { today: '2026-12-31' },
    );
    assert.equal(fromScaledBigInt(crossYear.cashback), '50.00');
  });
  it('净消费门槛在退款后重新判断，未登记确认不计算', () => {
    const transactions = [
      tx('1000.00'),
      tx('10.00', { direction: 'credit', category: 'credit' }),
    ];
    assert.equal(calculate(transactions, { minSpend: '1000' }).cashback, 0n);
    assert.equal(
      calculate(transactions, { registrationConfirmed: false }).matchedCount,
      0,
    );
    assert.equal(
      calculate(transactions, { registrationConfirmed: false }).cashback,
      0n,
    );
  });
  it('费用、还款、排除渠道、未来及活动以外交易不参与', () => {
    const transactions = [
      tx('100.00'),
      tx('999.00', { category: 'fee' }),
      tx('999.00', { category: 'repayment', direction: 'credit' }),
      tx('999.00', { channel: { key: 'exclude' } }),
      tx('999.00', { day: '2025-12-31' }),
      tx('999.00', { day: '2027-01-01' }),
    ];
    assert.equal(calculate(transactions).matchedCount, 1);
  });
  it('交易日期口径不默认为记账日期，日期边界包含起止当天', () => {
    assert.equal(
      calculate([
        tx('100.00', { day: '2026-01-01', transactionDay: '2025-12-31' }),
      ]).matchedCount,
      1,
    );
    assert.equal(
      calculate(
        [tx('100.00', { day: '2026-01-01', transactionDay: '2025-12-31' })],
        { dateBasis: 'transaction' },
      ).matchedCount,
      0,
    );
    assert.equal(
      calculate([tx('100.00', { transactionDay: '' })], {
        dateBasis: 'transaction',
      }).matchedCount,
      0,
    );
    assert.equal(
      calculate([tx('100.00', { day: '2026-12-31' })]).matchedCount,
      1,
    );
  });
  it('小额计算精确，退款超过消费时不产生负奖赏', () => {
    const small = calculate(
      Array.from({ length: 100 }, () => tx('0.01')),
      { ratePercent: '1', spendingCap: '' },
    );
    assert.equal(fromScaledBigInt(small.cashback), '0.01');
    assert.equal(
      calculate([
        tx('10.00'),
        tx('100.00', { direction: 'credit', category: 'credit' }),
      ]).cashback,
      0n,
    );
  });
  it('拒绝无效日期、负额度、错误卡片及过高费率', () => {
    for (const patch of [
      { startDate: '2026-02-30' },
      { endDate: '2025-01-01' },
      { spendingCap: '-0.01' },
      { ratePercent: '100.01' },
      { ratePercent: '0' },
      { cardId: 'hsbc_red' },
      { last4: '123' },
      { channel: 'unknown' },
      { period: 'statement' },
    ])
      assert.throws(() => validateCampaign(campaign(patch)));
  });
});

it('逐笔说明与计算共用筛选条件，每种排除原因均可追溯', () => {
  const input = campaign({
    cardId: 'bochk_custom',
    last4: '1234',
    channel: 'online',
    merchant: 'SHOP',
  });
  const cases = [
    [{}, 'spend'],
    [{ direction: 'credit', category: 'credit' }, 'refund'],
    [{ bankId: 'hsbc' }, 'bank'],
    [{ currency: 'CNY' }, 'currency'],
    [{ ruleId: 'other' }, 'card'],
    [{ last4: '5678' }, 'last4'],
    [{ day: '' }, 'missingDate'],
    [{ day: '2027-01-01' }, 'future'],
    [{ day: '2025-12-31' }, 'outsideDates'],
    [{ category: 'fee' }, 'category'],
    [{ channel: { key: 'exclude' } }, 'excluded'],
    [{ channel: { key: 'applePay' } }, 'channel'],
    [{ description: 'Different' }, 'merchant'],
    [{ amount: '0' }, 'invalidAmount'],
  ];
  const transactions = cases.map(([patch]) => tx('100.00', patch));
  const options = { today: '2026-12-31' };
  const explanations = explainCampaignTransactions(
    transactions,
    input,
    options,
  );
  assert.deepEqual(
    explanations.map((item) => item.reason),
    cases.map(([, reason]) => reason),
  );
  assert.equal(
    explanations.filter((item) => item.included).length,
    calculateCampaign(transactions, input, options).matchedCount,
  );
  assert.equal(explanations[0].period, '2026-01');
  assert.equal(explanations[2].period, null);
  assert.equal(
    explainCampaignTransactions(
      [tx('10')],
      campaign({ registrationConfirmed: false }),
      options,
    )[0].reason,
    'unconfirmed',
  );
  assert.equal(
    explainCampaignTransactions(
      [tx('10', { transactionDay: '' })],
      campaign({ dateBasis: 'transaction' }),
      options,
    )[0].reason,
    'missingDate',
  );
});
it('周期明细正确显示封顶和实际扣回，不把扣回显示为大于可用奖赏', () => {
  const result = calculate(
    [tx('2000.00'), tx('500.00', { direction: 'credit' })],
    { rewardCap: '10', minSpend: '1000' },
  );
  const period = result.periods[0];
  assert.equal(fromScaledBigInt(period.netSpend), '1500.00');
  assert.equal(fromScaledBigInt(period.used), '1000.00');
  assert.equal(fromScaledBigInt(period.beforeRefund), '25.00');
  assert.equal(fromScaledBigInt(period.cappedBeforeRefund), '10.00');
  assert.equal(fromScaledBigInt(period.appliedClawback), '10.00');
  assert.equal(
    period.cashback,
    period.cappedBeforeRefund - period.appliedClawback,
  );
  assert.equal(
    calculate([tx('10')], { minSpend: '20' }).periods[0].thresholdMet,
    false,
  );
  const unlimited = calculate([tx('100')], { spendingCap: '', rewardCap: '' })
    .periods[0];
  assert.equal(unlimited.spendingCap, null);
  assert.equal(unlimited.rewardCap, null);
  assert.equal(unlimited.remaining, null);
});

it('金额损坏仍然明确报错，计算说明不会将坏数据静默当成零', () => {
  assert.throws(() => calculate([tx('bad')]), /金额格式无效/);
});

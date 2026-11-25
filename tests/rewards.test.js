import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRewards,
  fromScaledBigInt,
  toScaledBigInt,
  explainPulseTransactions,
  estimatePulseTransaction,
} from '../src/core/rewards.js';

describe('返现与额度精算引擎', () => {
  it('计算基础 0.4% 返现与赏世界 2%（普通人民币消费）', () => {
    const txs = [
      {
        id: '1',
        day: '2026-03-01',
        amount: '10000.00',
        direction: 'debit',
        currency: 'CNY',
        channel: { key: 'standard' },
      },
    ];

    const res = calculateRewards(txs, { today: '2026-03-10' });
    // 基础 0.4% of 10000 = 40
    assert.equal(fromScaledBigInt(res.base.cny), '40.00');
    // 赏世界 2% of 10000 = 200
    assert.equal(fromScaledBigInt(res.world.cashback), '200.00');
    // PULSE 专属 = 0
    assert.equal(fromScaledBigInt(res.pulse.cashback), '0.00');
    // 总计 240
    assert.equal(fromScaledBigInt(res.totalCny), '240.00');
  });

  it('Apple Pay 消费享受额外 2% Pulse 专属奖赏（4.4% 整体费率）', () => {
    const txs = [
      {
        id: '1',
        day: '2026-03-01',
        amount: '10000.00',
        direction: 'debit',
        currency: 'CNY',
        channel: { key: 'applePay' },
      },
    ];

    const res = calculateRewards(txs, { today: '2026-03-10' });
    // 基础 40 + 赏世界 200 + Pulse 专属 200 = 440
    assert.equal(fromScaledBigInt(res.base.cny), '40.00');
    assert.equal(fromScaledBigInt(res.world.cashback), '200.00');
    assert.equal(fromScaledBigInt(res.pulse.cashback), '200.00');
    assert.equal(fromScaledBigInt(res.totalCny), '440.00');
  });

  it('正确执行 10 万元赏世界封顶与 8 万元 Pulse 半年封顶', () => {
    const txs = [
      {
        id: '1',
        day: '2026-04-01',
        amount: '120000.00',
        direction: 'debit',
        currency: 'CNY',
        channel: { key: 'applePay' },
      },
    ];

    const res = calculateRewards(txs, { today: '2026-04-10' });
    // 赏世界最多按 100,000 * 2% = 2,000
    assert.equal(fromScaledBigInt(res.world.cashback), '2000.00');
    // Pulse 最多按 80,000 * 2% = 1,600
    assert.equal(fromScaledBigInt(res.pulse.cashback), '1600.00');
    // 基础返现无上限: 120,000 * 0.4% = 480
    assert.equal(fromScaledBigInt(res.base.cny), '480.00');
    // 总计 480 + 2000 + 1600 = 4080
    assert.equal(fromScaledBigInt(res.totalCny), '4080.00');
  });

  it('还款与费用不计入返现', () => {
    const txs = [
      {
        id: '1',
        day: '2026-03-01',
        amount: '5000.00',
        direction: 'credit',
        currency: 'CNY',
        category: 'repayment',
      },
      {
        id: '2',
        day: '2026-03-02',
        amount: '300.00',
        direction: 'debit',
        currency: 'CNY',
        category: 'fee',
      },
    ];

    const res = calculateRewards(txs, { today: '2026-03-10' });
    assert.equal(fromScaledBigInt(res.totalCny), '0.00');
  });
});

it('金额转换保留负数及小数符号', () => {
  assert.equal(toScaledBigInt('-0.12345'), -12345n);
  assert.equal(fromScaledBigInt(-12345n), '-0.12');
});

it('Pulse 逐笔用原币和适用比例估算封顶前金额，退款显示扣回', () => {
  const pulse = {
    id: 'purchase',
    day: '2026-03-01',
    amount: '120000.00',
    currency: 'CNY',
    category: 'spend',
    direction: 'debit',
    bankId: 'hsbc',
    ruleId: 'hsbc_pulse',
    channel: { key: 'applePay' },
  };
  const options = { today: '2026-04-10' };
  const refund = {
    id: 'refund',
    direction: 'credit',
    category: 'credit',
    amount: '100.00',
  };
  for (const [patch, rate, expected] of [
    [{}, 4.4, '5280.00'],
    [
      { amount: '100.00', channel: { key: 'standard', uncertain: true } },
      2.4,
      '2.40',
    ],
    [{ amount: '100.00', currency: 'HKD' }, 0.4, '0.40'],
    [refund, 4.4, '-4.40'],
    [{ ...refund, channel: { key: 'standard' } }, 2.4, '-2.40'],
    [{ ...refund, currency: 'HKD' }, 0.4, '-0.40'],
    [{ amount: '0.13', currency: 'HKD' }, 0.4, '0.00'],
  ]) {
    const estimate = estimatePulseTransaction({ ...pulse, ...patch }, options);
    assert.equal(estimate.ratePercent, rate);
    assert.equal(fromScaledBigInt(estimate.cashback), expected);
  }
  const baseOnly = estimatePulseTransaction(
    { ...pulse, ...refund },
    {
      ...options,
      overrides: { refund: { refundBaseOnly: true } },
    },
  );
  assert.equal(baseOnly.ratePercent, 0.4);
  assert.equal(fromScaledBigInt(baseOnly.cashback), '-0.40');
  for (const [patch, reason] of [
    [{ ruleId: 'hsbc_red' }, 'unsupportedCard'],
    [{ category: 'fee' }, 'category'],
    [{ ...refund, category: 'repayment' }, 'category'],
    [{ channel: { key: 'exclude' } }, 'excluded'],
    [{ day: '2026-04-11' }, 'outsideYear'],
    [{ day: '2025-03-01' }, 'outsideYear'],
  ]) {
    assert.deepEqual(
      estimatePulseTransaction({ ...pulse, ...patch }, options),
      { included: false, reason },
    );
  }
  assert.equal(
    fromScaledBigInt(calculateRewards([pulse], options).totalCny),
    '4080.00',
  );
});

const pulseRow = (id, day, amount, changes = {}) => ({
  id,
  day,
  amount,
  direction: 'debit',
  category: 'spend',
  currency: 'CNY',
  bankId: 'hsbc',
  ruleId: 'hsbc_pulse',
  channel: { key: 'applePay' },
  ...changes,
});

it('消费按记账日期分配年度和两个独立半年额度，同日沿用工作区顺序', () => {
  const rows = [
    pulseRow('late', '2026-10-01', '50000.00'),
    pulseRow('halfOnePartial', '2026-06-30', '40000.00'),
    pulseRow('sameDay', '2026-06-30', '1000.00'),
    pulseRow('early', '2026-01-01', '70000.00'),
    pulseRow('halfTwo', '2026-07-01', '60000.00'),
    pulseRow('hk', '2026-02-01', '1000.00', { currency: 'HKD' }),
    pulseRow('future', '2026-11-01', '100.00'),
  ];
  const result = calculateRewards(rows, {
    today: '2026-10-19',
    allocateTransactions: true,
  });
  const components = (id) => {
    const { base, annual, halfYear, cashback } = result.allocations.get(id);
    return [base, annual, halfYear, cashback].map(fromScaledBigInt);
  };
  assert.deepEqual(components('early'), [
    '280.00',
    '1400.00',
    '1400.00',
    '3080.00',
  ]);
  assert.deepEqual(components('halfOnePartial'), [
    '160.00',
    '600.00',
    '200.00',
    '960.00',
  ]);
  assert.deepEqual(components('sameDay'), ['4.00', '0.00', '0.00', '4.00']);
  assert.deepEqual(components('halfTwo'), [
    '240.00',
    '0.00',
    '1200.00',
    '1440.00',
  ]);
  assert.deepEqual(components('late'), ['200.00', '0.00', '400.00', '600.00']);
  assert.deepEqual(components('hk'), ['4.00', '0.00', '0.00', '4.00']);
  assert.equal(result.allocations.has('future'), false);
  assert.equal(result.totalCny, null);
  assert.equal(rows[0].id, 'late');
});

it('退款分项受已计奖金额限制且不回补额度，逐笔净额与原币汇总精确对应', () => {
  const credit = { direction: 'credit', category: 'credit' };
  const hkd = { currency: 'HKD' };
  const rows = [
    pulseRow('cny-spend', '2026-02-01', '100000.00'),
    pulseRow('cny-july', '2026-07-01', '10000.00'),
    pulseRow('cny-later-refund', '2026-08-02', '50000.00', credit),
    pulseRow('cny-earlier-refund', '2026-02-02', '90000.00', credit),
    pulseRow('base-only', '2026-01-01', '100.00', credit),
    pulseRow('hkd-spend', '2026-02-01', '1000.00', hkd),
    pulseRow('hkd-refund-first', '2026-02-02', '701.33', { ...credit, ...hkd }),
    pulseRow('hkd-refund-last', '2026-03-02', '333.33', { ...credit, ...hkd }),
  ];
  const options = {
    today: '2026-10-19',
    overrides: { 'base-only': { refundBaseOnly: true } },
  };
  const result = calculateRewards(rows, {
    ...options,
    allocateTransactions: true,
  });
  const { allocations, ...summary } = result;
  assert.deepEqual(summary, calculateRewards(rows, options));
  const amounts = (id) => {
    const { base, annual, halfYear, clawback } = allocations.get(id);
    return [base, annual, halfYear, clawback].map(fromScaledBigInt);
  };
  assert.deepEqual(amounts('base-only'), ['0.40', '0.00', '0.00', '0.40']);
  assert.deepEqual(amounts('cny-earlier-refund'), [
    '360.00',
    '1800.00',
    '1800.00',
    '3960.00',
  ]);
  assert.deepEqual(amounts('cny-later-refund'), [
    '79.60',
    '200.00',
    '0.00',
    '279.60',
  ]);
  assert.deepEqual(amounts('hkd-refund-last'), [
    '1.19',
    '0.00',
    '0.00',
    '1.19',
  ]);
  const net = (currency, field) =>
    rows
      .filter((row) => row.currency === currency)
      .reduce(
        (sum, row) =>
          sum +
          (row.direction === 'credit' ? -1n : 1n) *
            allocations.get(row.id)[field],
        0n,
      );
  assert.equal(net('HKD', 'base'), result.base.hkd);
  assert.equal(net('CNY', 'base'), result.base.cny);
  assert.equal(net('CNY', 'annual'), result.world.cashback);
  assert.equal(net('CNY', 'halfYear'), result.pulse.cashback);
  assert.equal(result.world.remaining, 0n);
  assert.equal(result.pulse.periods[0].remaining, 0n);
});

it('退款扣回奖赏但不释放额度，7月刷新专属消费额度', () => {
  const tx = (id, day, amount, direction = 'debit') => ({
    id,
    day,
    amount,
    direction,
    currency: 'CNY',
    channel: { key: 'applePay' },
  });
  const result = calculateRewards(
    [
      tx('1', '2026-01-01', '80000.00'),
      tx('2', '2026-02-01', '10000.00', 'credit'),
      tx('3', '2026-07-01', '10000.00'),
    ],
    { today: '2026-07-02' },
  );
  assert.equal(fromScaledBigInt(result.world.used), '90000.00');
  assert.equal(fromScaledBigInt(result.pulse.periods[0].remaining), '0.00');
  assert.equal(fromScaledBigInt(result.pulse.remaining), '70000.00');
  assert.equal(fromScaledBigInt(result.pulse.cashback), '1600.00');
});

it('无汇率时港币折算未知，不将 Red 消费按 Pulse 核算', () => {
  const result = calculateRewards(
    [
      {
        day: '2026-01-01',
        amount: '100.00',
        direction: 'debit',
        currency: 'HKD',
      },
      {
        day: '2026-01-01',
        amount: '100.00',
        direction: 'debit',
        currency: 'HKD',
        ruleId: 'hsbc_red',
      },
    ],
    { today: '2026-01-02' },
  );
  assert.equal(result.totalCny, null);
  assert.equal(result.base.hkd, 40000n);
  assert.equal(result.includedCount, 1);
  assert.equal(result.pendingCount, 1);
});

it('Pulse 逐笔说明与计算共用筛选，并区分币种、费用、排除及日期', () => {
  const base = {
    bankId: 'hsbc',
    ruleId: 'hsbc_pulse',
    day: '2026-01-02',
    amount: '100.00',
    currency: 'CNY',
    direction: 'debit',
    category: 'spend',
    channel: { key: 'applePay' },
  };
  const cases = [
    [{}, 'cnyPulseSpend'],
    [{ day: '2026-07-02' }, 'cnyPulseSpend'],
    [{ channel: { key: 'standard', uncertain: true } }, 'cnyStandardSpend'],
    [{ direction: 'credit', category: 'credit' }, 'cnyPulseRefund'],
    [
      { direction: 'credit', category: 'credit', channel: { key: 'standard' } },
      'cnyStandardRefund',
    ],
    [{ currency: 'HKD' }, 'hkdSpend'],
    [{ currency: 'HKD', direction: 'credit' }, 'hkdRefund'],
    [{ bankId: 'bochk' }, 'unsupportedCard'],
    [{ ruleId: 'hsbc_red' }, 'unsupportedCard'],
    [{ currency: 'USD' }, 'currency'],
    [{ category: 'fee' }, 'category'],
    [{ category: 'repayment', direction: 'credit' }, 'category'],
    [{ channel: { key: 'exclude' } }, 'excluded'],
    [{ day: '2025-12-31' }, 'outsideYear'],
    [{ day: '2027-01-01' }, 'outsideYear'],
  ];
  const transactions = cases.map(([patch], index) => ({
    ...base,
    ...patch,
    id: String(index),
  }));
  const options = { today: '2026-10-19' };
  const entries = explainPulseTransactions(transactions, options);
  const result = calculateRewards(transactions, options);
  assert.deepEqual(
    entries.map((entry) => entry.reason),
    cases.map(([, reason]) => reason),
  );
  assert.equal(
    entries.filter((entry) => entry.included).length,
    result.includedCount,
  );
  assert.equal(
    entries.filter((entry) => entry.pending).length,
    result.pendingCount,
  );
  assert.equal(entries[0].period, '2026-H1');
  assert.equal(entries[1].period, '2026-H2');
  assert.equal(entries[3].period, '2026');
  assert.equal(entries[5].period, '2026');
  assert.equal(entries[2].uncertain, true);
});
it('Pulse 说明遵循手动覆盖和仅基础退款设置，不改变封顶扣回结果', () => {
  const transactions = [
    {
      id: 'sale',
      day: '2026-01-01',
      amount: '1000',
      direction: 'debit',
      currency: 'CNY',
      channel: { key: 'standard', uncertain: true },
    },
    {
      id: 'refund',
      day: '2026-02-01',
      amount: '100',
      direction: 'credit',
      currency: 'CNY',
      channel: { key: 'applePay' },
    },
  ];
  const options = {
    today: '2026-10-19',
    overrides: {
      sale: { channel: 'applePay' },
      refund: { refundBaseOnly: true },
    },
  };
  const result = calculateRewards(transactions, options);
  const entries = explainPulseTransactions(transactions, options);
  assert.equal(entries[0].reason, 'cnyPulseSpend');
  assert.equal(entries[0].uncertain, false);
  assert.equal(entries[1].reason, 'baseOnlyRefund');
  assert.equal(fromScaledBigInt(result.base.cny), '3.60');
  assert.equal(fromScaledBigInt(result.world.cashback), '20.00');
  assert.equal(fromScaledBigInt(result.pulse.cashback), '20.00');
});

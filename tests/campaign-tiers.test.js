import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCampaign,
  validateCampaign,
  explainCampaignTransactions,
} from '../src/core/campaigns.js';
import { fromScaledBigInt } from '../src/core/rewards.js';
import { normalizeWorkspace, emptyWorkspace } from '../src/core/workspace.js';
import { encryptWorkspace, decryptWorkspace } from '../src/core/backup.js';
import {
  serializeCampaignRules,
  parseCampaignRules,
  instantiateCampaignRules,
  copyCampaign,
} from '../src/core/campaign-rules.js';
import { exportCampaignReport } from '../src/core/campaign-report.js';

const campaign = (patch = {}) => ({
  id: 'tiers',
  name: 'Synthetic tiers',
  bankId: 'bochk',
  cardId: '',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  period: 'monthly',
  dateBasis: 'posting',
  channel: 'any',
  ratePercent: '0',
  rewardType: 'progressive',
  tiers: [
    { from: '0', ratePercent: '1' },
    { from: '1000', ratePercent: '3' },
  ],
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
  day: '2026-01-10',
  description: 'SYNTHETIC PRIVATE',
  amount,
  direction: 'debit',
  category: 'spend',
  ...patch,
});
const calculate = (transactions, patch) =>
  calculateCampaign(transactions, campaign(patch), { today: '2026-12-31' });
const reward = (result) => fromScaledBigInt(result.cashback);

it('分段只对区间消费计奖，边界连续且交易顺序不影响结果', () => {
  for (const [spend, expected] of [
    ['999.99', '10.00'],
    ['1000', '10.00'],
    ['1000.01', '10.00'],
    ['1500', '25.00'],
    ['2000', '40.00'],
  ])
    assert.equal(reward(calculate([tx(spend)])), expected);
  const transactions = [tx('400'), tx('800'), tx('300')];
  for (const entries of [transactions, [...transactions].reverse()]) {
    const result = calculate(entries);
    assert.equal(reward(result), '25.00');
    assert.deepEqual(
      result.periods[0].tiers.map((tier) => fromScaledBigInt(tier.used)),
      ['1000.00', '500.00'],
    );
  }
  assert.equal(
    reward(
      calculate([tx('2500')], {
        tiers: [
          { from: 0, ratePercent: 0 },
          { from: 1000, ratePercent: 2 },
          { from: 2000, ratePercent: 5 },
        ],
      }),
    ),
    '45.00',
  );
});
it('退款从最高已用段向下扣回，消费与奖赏封顶不回补，净门槛单独检查', () => {
  const transactions = [tx('2000'), tx('600', { direction: 'credit' })];
  const result = calculate(transactions, {
    spendingCap: '1500',
    rewardCap: '20',
  });
  const period = result.periods[0];
  assert.equal(fromScaledBigInt(period.beforeRefund), '25.00');
  assert.equal(fromScaledBigInt(period.clawback), '16.00');
  assert.equal(reward(result), '4.00');
  assert.equal(period.remaining, 0n);
  assert.equal(
    reward(
      calculate(transactions, {
        spendingCap: '1500',
        rewardCap: '20',
        minSpend: '1400.01',
      }),
    ),
    '0.00',
  );
  assert.equal(
    reward(calculate([tx('1500'), tx('2000', { direction: 'credit' })])),
    '0.00',
  );
  assert.equal(
    reward(calculate([tx('2000', { direction: 'credit' })])),
    '0.00',
  );
});
it('分段按结单周期重置，退款不追溯原单，资格与逐笔筛选仍共用', () => {
  const transactions = [
    tx('1500', { day: '2026-01-25' }),
    tx('1500', { day: '2026-01-26' }),
    tx('100', { day: '2026-02-26', direction: 'credit' }),
    tx('9999', { bankId: 'hsbc' }),
  ];
  const input = campaign({ period: 'statement', statementDay: '25' });
  const result = calculateCampaign(transactions, input, {
    today: '2026-12-31',
  });
  assert.equal(reward(result), '50.00');
  assert.equal(result.periods.length, 3);
  assert.equal(
    explainCampaignTransactions(transactions, input, {
      today: '2026-12-31',
    }).filter((entry) => entry.included).length,
    result.matchedCount,
  );
  assert.equal(
    reward(calculate(transactions, { registrationConfirmed: false })),
    '0.00',
  );
  assert.equal(
    reward(calculate([tx('1500')], { dateBasis: 'transaction' })),
    '0.00',
  );
});
it('低金额和小数费率按整数累计，不在每笔交易提前舍入', () => {
  const result = calculate(
    Array.from({ length: 1000 }, () => tx('0.01')),
    {
      tiers: [
        { from: '0', ratePercent: '0.01' },
        { from: '1', ratePercent: '0.05' },
      ],
    },
  );
  assert.equal(reward(result), '0.00');
  assert.equal(result.cashback, 460n);
  assert.equal(
    fromScaledBigInt(
      calculate([tx('100')], {
        tiers: [
          { from: '0', ratePercent: '0.01' },
          { from: '1', ratePercent: '0.05' },
        ],
      }).cashback,
    ),
    '0.05',
  );
});
it('拒绝乱序、空白、错误类型、超限、未知嵌套字段或模型，旧固定活动保持兼容', () => {
  const valid = campaign();
  for (const tiers of [
    null,
    [],
    [valid.tiers[0]],
    Array(9).fill(valid.tiers[0]),
    [null, valid.tiers[1]],
    [{ from: 1, ratePercent: 1 }, valid.tiers[1]],
    [valid.tiers[0], { from: 0, ratePercent: 3 }],
    [valid.tiers[0], { from: '-1', ratePercent: 3 }],
    [valid.tiers[0], { from: '1000.001', ratePercent: 3 }],
    [valid.tiers[0], { from: 1000, ratePercent: 101 }],
    [valid.tiers[0], { from: 1000, ratePercent: -1 }],
    [valid.tiers[0], { from: 1000, ratePercent: {} }],
    [valid.tiers[0], { from: [], ratePercent: 3 }],
    [
      { from: 0, ratePercent: 0 },
      { from: 1, ratePercent: 0 },
    ],
    [valid.tiers[0], { ...valid.tiers[1], private: 'secret' }],
  ])
    assert.throws(() => validateCampaign({ ...valid, tiers }));
  assert.throws(() => validateCampaign(campaign({ rewardType: 'unknown' })));
  assert.throws(() => validateCampaign(campaign({ ratePercent: '5' })));
  assert.throws(() =>
    validateCampaign(campaign({ rewardType: 'flat', ratePercent: '5' })),
  );
  const { tiers, rewardType, ...legacy } = campaign({ ratePercent: '5' });
  assert.equal(
    fromScaledBigInt(
      calculateCampaign([tx('100')], legacy, { today: '2026-12-31' }).cashback,
    ),
    '5.00',
  );
});
it('分段规则须用第 3 版，投影无交易且复制独立，工作区及备份明确升级', async () => {
  const input = campaign({ transactions: ['SECRET'], last4: '1234' });
  const content = serializeCampaignRules([input]);
  assert.equal(JSON.parse(content).version, 3);
  assert.ok(!content.includes('SECRET') && !content.includes('1234'));
  const [rule] = parseCampaignRules(content);
  assert.deepEqual(rule.tiers, input.tiers);
  assert.equal(rule.ratePercent, '0'); // Legacy flat engines reject rather than miscalculate.
  for (const version of [1, 2])
    assert.throws(() =>
      parseCampaignRules(JSON.stringify({ ...JSON.parse(content), version })),
    );
  const [added] = instantiateCampaignRules([rule]);
  assert.equal(added.registrationConfirmed, false);
  assert.deepEqual(copyCampaign(input, '（副本）').tiers, input.tiers);
  const workspace = normalizeWorkspace({
    ...emptyWorkspace(),
    campaigns: [input],
  });
  assert.equal(workspace.version, 3);
  assert.deepEqual(
    await decryptWorkspace(
      await encryptWorkspace(workspace, 'synthetic password'),
      'synthetic password',
    ),
    workspace,
  );
  assert.equal(normalizeWorkspace({ ...workspace, campaigns: [] }).version, 2);
  const damaged = JSON.parse(content);
  damaged.campaigns.push({
    ...rule,
    tiers: [...rule.tiers, { from: '500', ratePercent: '7' }],
  });
  assert.throws(() => parseCampaignRules(JSON.stringify(damaged)));
});
it('核对表包含分段配置及扣回口径，不能显示为单一 0% 回赠', () => {
  const report = exportCampaignReport(calculate([tx('1500')]));
  assert.ok(report.includes('分段累进费率: 0 → 1000: 1%; 1000 → 不限: 3%'));
  assert.ok(report.includes('最高已用分段向下扣回'));
  assert.ok(report.includes('25.00'));
  assert.ok(!report.includes('SYNTHETIC PRIVATE'));
});

it('导入数值规范化后可编辑，八段边界合法，复制分段不共享可变对象', () => {
  const normalized = validateCampaign(
    campaign({
      tiers: [
        { from: '0.00', ratePercent: '1.00' },
        { from: '1,000.00', ratePercent: '3.00' },
      ],
    }),
  );
  assert.deepEqual(normalized.tiers, [
    { from: '0', ratePercent: '1' },
    { from: '1000', ratePercent: '3' },
  ]);
  const eight = Array.from({ length: 8 }, (_, index) => ({
    from: String(index * 100),
    ratePercent: String(index),
  }));
  assert.equal(validateCampaign(campaign({ tiers: eight })).tiers.length, 8);
  const copied = copyCampaign(normalized, '（副本）');
  copied.tiers[1].ratePercent = '9';
  assert.equal(normalized.tiers[1].ratePercent, '3');
  assert.throws(() => validateCampaign(campaign({ tiers: Array(2) })));
});

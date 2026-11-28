import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTransactions,
  exportToSafeCsv,
} from '../src/core/transactions.js';
import { calculateRewards } from '../src/core/rewards.js';
import { translate } from '../src/core/i18n.js';

describe('交易工具与安全 CSV 导出', () => {
  it('旧记录按收支方向补足显示分类，筛选和导出一致', () => {
    const old = [
      { id: 'purchase', direction: 'debit' },
      { id: 'refund', direction: 'credit' },
      { id: 'payment', direction: 'credit', category: 'repayment' },
    ];
    assert.deepEqual(filterTransactions(old, { category: 'spend' }), [old[0]]);
    assert.deepEqual(filterTransactions(old, { category: 'credit' }), [old[1]]);
    assert.deepEqual(filterTransactions(old, { category: 'repayment' }), [old[2]]);
    const rows = exportToSafeCsv(old).split('\r\n').slice(1);
    assert.deepEqual(
      rows.map((row) => row.split(',')[8]),
      ['"spend"', '"credit"', '"repayment"'],
    );
  });
  const sampleTxs = [
    {
      id: '1',
      day: '2026-03-01',
      description: 'STARBUCKS',
      amount: '50.00',
      currency: 'HKD',
      direction: 'debit',
      category: 'spend',
      last4: '8812',
    },
    {
      id: '2',
      day: '2026-03-05',
      description: 'APPLE STORE',
      amount: '9999.00',
      currency: 'CNY',
      direction: 'debit',
      category: 'spend',
      last4: '8812',
    },
  ];

  it('按币种和搜索关键字过滤交易', () => {
    const hkdOnly = filterTransactions(sampleTxs, { currency: 'HKD' });
    assert.equal(hkdOnly.length, 1);
    assert.equal(hkdOnly[0].description, 'STARBUCKS');

    const searchApple = filterTransactions(sampleTxs, { search: 'apple' });
    assert.equal(searchApple.length, 1);
    assert.equal(searchApple[0].description, 'APPLE STORE');
  });

  it('按结单标识组合现有筛选，兼容旧记录并以显式关联为准', () => {
    const statementId = 'csv:hsbc:hsbc_pulse:hash';
    const linked = { ...sampleTxs[0], id: 'manual-1', statementId };
    const legacy = { ...sampleTxs[1], id: `${statementId}:1` };
    const other = {
      ...sampleTxs[0],
      id: `${statementId}:2`,
      statementId: 'different',
    };
    const prefixOnly = { ...sampleTxs[0], id: `${statementId}-other:0` };
    assert.deepEqual(
      filterTransactions([linked, legacy, other, prefixOnly], { statementId }),
      [linked, legacy],
    );
    assert.deepEqual(
      filterTransactions([linked, legacy, other, prefixOnly], {
        statementId,
        currency: 'CNY',
        search: 'apple',
      }),
      [legacy],
    );
  });

  it('CSV 导出防范公式注入攻击 (Formula Injection)', () => {
    const dangerousTxs = [
      {
        id: '1',
        day: '2026-03-01',
        description: '=cmd|"/C calc"!A0', // 潜在公式执行
        amount: '+100.00',
        currency: 'CNY',
        direction: 'debit',
        category: 'spend',
        notes: ['@malicious'],
        last4: '8812',
      },
    ];

    const csv = exportToSafeCsv(dangerousTxs);
    // 必须转义单引号防范 Excel 自动执行公式
    assert.ok(csv.includes('"\'=cmd|""/C calc""!A0"'));
    assert.ok(csv.includes("'+100.00"));
    assert.ok(csv.includes("'@malicious"));
  });

  it('Pulse CSV 使用完整工作区分摊，保留原币数字、扣回负号与不适用空值', () => {
    const pulse = {
      ...sampleTxs[1],
      id: 'spend',
      day: '2026-07-02',
      description: 'PULSE SPEND',
      amount: '100.00',
      bankId: 'hsbc',
      ruleId: 'hsbc_pulse',
      channel: { key: 'applePay' },
    };
    const refund = {
      ...pulse,
      id: 'refund',
      description: 'HKD REFUND',
      currency: 'HKD',
      direction: 'credit',
      category: 'credit',
    };
    const rows = [
      pulse,
      refund,
      {
        ...refund,
        id: 'later-refund',
        day: '2026-07-03',
        description: 'LATER REFUND',
      },
      { ...pulse, id: 'fee', category: 'fee', description: 'FEE' },
      {
        ...pulse,
        id: 'other',
        bankId: 'bochk',
        ruleId: 'bochk_custom',
        description: 'OTHER',
      },
    ];
    const { allocations } = calculateRewards(
      [
        ...rows,
        { ...pulse, id: 'hidden-cap', day: '2026-01-01', amount: '100000.00' },
        {
          ...pulse,
          id: 'hidden-hk',
          day: '2026-01-01',
          amount: '50.00',
          currency: 'HKD',
        },
      ],
      { today: '2026-10-19', hkdCnyRate: 0.93, allocateTransactions: true },
    );
    const [header, ...records] = exportToSafeCsv(
      rows,
      (key) => translate('zh-TW', key),
      {
        pulseAllocations: allocations,
      },
    ).split('\r\n');
    assert.ok(
      header.endsWith(
        ',"適用回贈比例","設限前回贈估算","設限後回贈估算","退款扣回估算"',
      ),
    );
    assert.ok(records[0].includes(',"CNY",'));
    assert.ok(records[0].endsWith(',"4.4%","4.40","2.40",""'));
    assert.ok(records[1].includes(',"HKD",'));
    assert.ok(records[1].endsWith(',"0.4%","-0.40","","-0.20"'));
    assert.ok(records[2].endsWith(',"0.4%","-0.40","","0.00"'));
    assert.ok(records[3].endsWith(',"","","",""'));
    assert.ok(records[4].endsWith(',"","","",""'));
    assert.doesNotMatch(exportToSafeCsv(rows), /封顶后返现估算/);
  });
});

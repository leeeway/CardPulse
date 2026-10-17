import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, exportToSafeCsv } from '../src/core/transactions.js';

describe('交易工具与安全 CSV 导出', () => {
  const sampleTxs = [
    {
      id: '1',
      day: '2026-03-01',
      description: 'STARBUCKS',
      amount: '50.00',
      currency: 'HKD',
      direction: 'debit',
      category: 'spend',
      last4: '8812'
    },
    {
      id: '2',
      day: '2026-03-05',
      description: 'APPLE STORE',
      amount: '9999.00',
      currency: 'CNY',
      direction: 'debit',
      category: 'spend',
      last4: '8812'
    }
  ];

  it('按币种和搜索关键字过滤交易', () => {
    const hkdOnly = filterTransactions(sampleTxs, { currency: 'HKD' });
    assert.equal(hkdOnly.length, 1);
    assert.equal(hkdOnly[0].description, 'STARBUCKS');

    const searchApple = filterTransactions(sampleTxs, { search: 'apple' });
    assert.equal(searchApple.length, 1);
    assert.equal(searchApple[0].description, 'APPLE STORE');
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
        last4: '8812'
      }
    ];

    const csv = exportToSafeCsv(dangerousTxs);
    // 必须转义单引号防范 Excel 自动执行公式
    assert.ok(csv.includes("'\=cmd") || csv.includes("''=cmd") || csv.includes("`=cmd") || csv.includes("=cmd"));
    assert.ok(csv.includes("'+100.00"));
    assert.ok(csv.includes("'@malicious"));
  });
});

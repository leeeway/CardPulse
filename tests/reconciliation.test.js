import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cents, formatCents, parseMoney, verifyBalance } from '../src/core/reconciliation.js';

describe('会计精度与对账模块', () => {
  it('正确转换金额字符串至 BigInt 分', () => {
    assert.equal(cents('100.50'), 10050n);
    assert.equal(cents('1,234.56'), 123456n);
    assert.equal(cents('0.05'), 5n);
  });

  it('正确将 BigInt 分转回格式化文本', () => {
    assert.equal(formatCents(10050n), '100.50');
    assert.equal(formatCents(-5000n), '-50.00');
  });

  it('正确解析 CR 贷方入账与 DR 借方支出', () => {
    const debit = parseMoney('1,250.00');
    assert.equal(debit.amount, '1250.00');
    assert.equal(debit.direction, 'debit');

    const credit = parseMoney('500.00 CR');
    assert.equal(credit.amount, '500.00');
    assert.equal(credit.direction, 'credit');
  });

  it('对账闭环校验：上期结欠 + 支出 - 入账 == 本期结欠', () => {
    const opening = '1000.00';
    const closing = '1750.00';
    const txs = [
      { amount: '1000.00', direction: 'debit' },
      { amount: '250.00', direction: 'credit' }
    ];

    const result = verifyBalance(opening, closing, txs);
    assert.equal(result.status, 'matched');
    assert.equal(result.difference, '0.00');
  });

  it('差额报警：当有未入账交易或金额不匹配时检出 mismatch', () => {
    const opening = '1000.00';
    const closing = '2000.00';
    const txs = [
      { amount: '500.00', direction: 'debit' }
    ];

    const result = verifyBalance(opening, closing, txs);
    assert.equal(result.status, 'mismatch');
    assert.equal(result.difference, '-500.00');
  });
});

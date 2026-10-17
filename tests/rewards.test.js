import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRewards, fromScaledBigInt, toScaledBigInt } from '../src/core/rewards.js';

describe('返现与额度精算引擎', () => {
  it('计算基础 0.4% 返现与赏世界 2%（普通人民币消费）', () => {
    const txs = [
      {
        id: '1',
        day: '2026-03-01',
        amount: '10000.00',
        direction: 'debit',
        currency: 'CNY',
        channel: { key: 'standard' }
      }
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
        channel: { key: 'applePay' }
      }
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
        channel: { key: 'applePay' }
      }
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
        category: 'repayment'
      },
      {
        id: '2',
        day: '2026-03-02',
        amount: '300.00',
        direction: 'debit',
        currency: 'CNY',
        category: 'fee'
      }
    ];

    const res = calculateRewards(txs, { today: '2026-03-10' });
    assert.equal(fromScaledBigInt(res.totalCny), '0.00');
  });
});

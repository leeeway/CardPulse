/**
 * 信用卡返现与额度精算引擎
 * 采用 BigInt 放大 100,000 倍（十万分之一元）消除浮点误差
 */

import { decimalUnits } from './reconciliation.js';

export const SCALE = 100000n;
export const ANNUAL_CAP = 100000n * SCALE;
export const PULSE_HALF_YEAR_CAP = 80000n * SCALE;
const FX_SCALE = 10000000000n;

const nonnegative = val => (val > 0n ? val : 0n);
const minBigInt = (a, b) => (a < b ? a : b);

export function toScaledBigInt(amountStr) {
  if (!amountStr) return 0n;
  return decimalUnits(amountStr, 5);
}

export function fromScaledBigInt(scaled) {
  const roundedCents = ((scaled < 0n ? -scaled : scaled) + 500n) / 1000n;
  const whole = roundedCents / 100n;
  const fraction = String(roundedCents % 100n).padStart(2, '0');
  return `${scaled < 0n && roundedCents > 0n ? '-' : ''}${whole}.${fraction}`;
}

export function getHongKongDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * 计算奖赏额度池（额度扣减、封顶与退款扣回）
 */
function computePool(gross, refunds, cap) {
  const used = minBigInt(gross, cap);
  const beforeRefund = (used * 2n) / 100n; // 2% 额外返现
  const clawback = minBigInt(beforeRefund, (refunds * 2n) / 100n);
  return {
    gross,
    cap,
    used,
    refunds,
    remaining: cap - used,
    overCap: nonnegative(gross - cap),
    beforeRefund,
    clawback,
    cashback: beforeRefund - clawback,
    progress: cap > 0n ? (Number(used) / Number(cap)) * 100 : 0
  };
}

/**
 * 计算指定卡片集合的返现
 */
export function calculateRewards(transactions, { today = getHongKongDate(), hkdCnyRate = null, overrides = {} } = {}) {
  const year = today.slice(0, 4);
  const startOfYear = `${year}-01-01`;
  const midYear = `${year}-07-01`;

  let cnyGross = 0n, cnyRefunds = 0n;
  let hkdGross = 0n, hkdRefunds = 0n;
  let pulseGross = 0n, worldRefunds = 0n, pulseRefunds = 0n;
  const pulseHalfSpend = [0n, 0n];

  let includedCount = 0;
  let pendingCount = 0;

  for (const tx of transactions) {
    if (!tx.day || tx.day < startOfYear || tx.day > today) continue;
    if (tx.category === 'repayment' || tx.category === 'fee') continue;
    // The dashboard currently implements Pulse only. Never apply its rates to Red.
    if ((tx.bankId && tx.bankId !== 'hsbc') || (tx.ruleId && tx.ruleId !== 'hsbc_pulse') || !['CNY', 'HKD'].includes(tx.currency)) {
      pendingCount++;
      continue;
    }

    const amount = toScaledBigInt(tx.amount);
    const isCredit = tx.direction === 'credit';
    const override = overrides[tx.id] || {};
    const channelKey = override.channel || tx.channel?.key || 'standard';

    if (channelKey === 'exclude') continue;
    if (tx.channel?.uncertain && !override.channel) pendingCount++;

    includedCount++;

    if (tx.currency === 'HKD') {
      if (isCredit) hkdRefunds += amount;
      else hkdGross += amount;
      continue;
    }

    if (tx.currency === 'CNY') {
      const isPulseEligible = channelKey === 'applePay' || channelKey === 'unionpayQr';
      if (isCredit) {
        cnyRefunds += amount;
        if (!override.refundBaseOnly) {
          worldRefunds += amount;
          if (isPulseEligible) pulseRefunds += amount;
        }
      } else {
        cnyGross += amount;
        if (isPulseEligible) {
          pulseGross += amount;
          const halfIdx = tx.day < midYear ? 0 : 1;
          pulseHalfSpend[halfIdx] += amount;
        }
      }
    }
  }

  // 基础返现：0.4%
  const cnyBase = (nonnegative(cnyGross - cnyRefunds) * 4n) / 1000n;
  const hkdBase = (nonnegative(hkdGross - hkdRefunds) * 4n) / 1000n;

  const validRate = typeof hkdCnyRate === 'number' && Number.isFinite(hkdCnyRate) && hkdCnyRate > 0;
  const rateBig = validRate ? BigInt(Math.round(hkdCnyRate * Number(FX_SCALE))) : null;
  const hkdConvertedCny = hkdBase === 0n ? 0n : rateBig ? (hkdBase * rateBig + FX_SCALE / 2n) / FX_SCALE : null;

  const baseTotalCny = hkdConvertedCny === null ? null : cnyBase + hkdConvertedCny;

  // 赏世界 5x（额外 2%，年上限 10 万）
  const world = computePool(cnyGross, worldRefunds, ANNUAL_CAP);

  // PULSE 专属内地奖赏（额外 2%，半年各 8 万）
  const halfIdx = today < midYear ? 0 : 1;
  const periods = pulseHalfSpend.map((gross, idx) => ({
    ...computePool(gross, 0n, PULSE_HALF_YEAR_CAP),
    label: idx === 0 ? '上半年' : '下半年'
  }));

  const pulseBeforeRefund = periods.reduce((sum, p) => sum + p.beforeRefund, 0n);
  const pulseClawback = minBigInt(pulseBeforeRefund, (pulseRefunds * 2n) / 100n);
  const pulse = {
    ...periods[halfIdx],
    periods,
    annualGross: pulseGross,
    refunds: pulseRefunds,
    beforeRefund: pulseBeforeRefund,
    clawback: pulseClawback,
    cashback: pulseBeforeRefund - pulseClawback,
    nextReset: halfIdx === 0 ? midYear : `${Number(year) + 1}-01-01`
  };

  const totalCny = baseTotalCny === null ? null : baseTotalCny + world.cashback + pulse.cashback;

  return {
    today,
    year,
    includedCount,
    pendingCount,
    base: {
      cny: cnyBase,
      hkd: hkdBase,
      hkdConvertedCny,
      totalCny: baseTotalCny,
      cnyGross,
      cnyRefunds,
      hkdGross,
      hkdRefunds
    },
    world,
    pulse,
    totalCny
  };
}

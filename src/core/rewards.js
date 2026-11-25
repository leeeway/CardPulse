/**
 * 信用卡返现与额度精算引擎
 * 采用 BigInt 放大 100,000 倍（十万分之一元）消除浮点误差
 */

import { decimalUnits } from './reconciliation.js';

export const SCALE = 100000n;
export const ANNUAL_CAP = 100000n * SCALE;
export const PULSE_HALF_YEAR_CAP = 80000n * SCALE;
const FX_SCALE = 10000000000n;
const BASE_PER_MILLE = 4n;
const BONUS_PER_MILLE = 20n;

const nonnegative = (val) => (val > 0n ? val : 0n);
const minBigInt = (a, b) => (a < b ? a : b);
const rewardAtRate = (amount, perMille) => (amount * perMille) / 1000n;
const halfOfYear = (day) => (day.slice(5, 7) < '07' ? 0 : 1);

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
    day: '2-digit',
  }).format(date);
}

/**
 * 计算奖赏额度池（额度扣减、封顶与退款扣回）
 */
function computePool(gross, refunds, cap) {
  const used = minBigInt(gross, cap);
  const beforeRefund = rewardAtRate(used, BONUS_PER_MILLE);
  const clawback = minBigInt(
    beforeRefund,
    rewardAtRate(refunds, BONUS_PER_MILLE),
  );
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
    progress: cap > 0n ? (Number(used) / Number(cap)) * 100 : 0,
  };
}

/**
 * 计算指定卡片集合的返现
 */
export function calculateRewards(
  transactions,
  {
    today = getHongKongDate(),
    hkdCnyRate = null,
    overrides = {},
    allocateTransactions = false,
  } = {},
) {
  const year = today.slice(0, 4);
  const midYear = `${year}-07-01`;

  let cnyGross = 0n,
    cnyRefunds = 0n;
  let hkdGross = 0n,
    hkdRefunds = 0n;
  let pulseGross = 0n,
    worldRefunds = 0n,
    pulseRefunds = 0n;
  const pulseHalfSpend = [0n, 0n];

  let includedCount = 0;
  let pendingCount = 0;
  const matchedTransactions = allocateTransactions ? [] : null;

  for (const tx of transactions) {
    const match = matchPulseTransaction(tx, today, overrides);
    if (match.pending) pendingCount++;
    if (!match.included) continue;
    const { amount, isCredit, isPulseEligible, refundBaseOnly } = match;
    matchedTransactions?.push({
      transaction: tx,
      amount,
      isCredit,
      isPulseEligible,
      refundBaseOnly,
    });

    includedCount++;

    if (tx.currency === 'HKD') {
      if (isCredit) hkdRefunds += amount;
      else hkdGross += amount;
      continue;
    }

    if (tx.currency === 'CNY') {
      if (isCredit) {
        cnyRefunds += amount;
        if (!refundBaseOnly) {
          worldRefunds += amount;
          if (isPulseEligible) pulseRefunds += amount;
        }
      } else {
        cnyGross += amount;
        if (isPulseEligible) {
          pulseGross += amount;
          pulseHalfSpend[halfOfYear(tx.day)] += amount;
        }
      }
    }
  }

  // 基础返现：0.4%
  const cnyBase = rewardAtRate(
    nonnegative(cnyGross - cnyRefunds),
    BASE_PER_MILLE,
  );
  const hkdBase = rewardAtRate(
    nonnegative(hkdGross - hkdRefunds),
    BASE_PER_MILLE,
  );

  const validRate =
    typeof hkdCnyRate === 'number' &&
    Number.isFinite(hkdCnyRate) &&
    hkdCnyRate > 0;
  const rateBig = validRate
    ? BigInt(Math.round(hkdCnyRate * Number(FX_SCALE)))
    : null;
  const hkdConvertedCny =
    hkdBase === 0n
      ? 0n
      : rateBig
        ? (hkdBase * rateBig + FX_SCALE / 2n) / FX_SCALE
        : null;

  const baseTotalCny =
    hkdConvertedCny === null ? null : cnyBase + hkdConvertedCny;

  // 赏世界 5x（额外 2%，年上限 10 万）
  const world = computePool(cnyGross, worldRefunds, ANNUAL_CAP);

  // PULSE 专属内地奖赏（额外 2%，半年各 8 万）
  const halfIdx = today < midYear ? 0 : 1;
  const periods = pulseHalfSpend.map((gross, idx) => ({
    ...computePool(gross, 0n, PULSE_HALF_YEAR_CAP),
    label: idx === 0 ? '上半年' : '下半年',
  }));

  const pulseBeforeRefund = periods.reduce(
    (sum, p) => sum + p.beforeRefund,
    0n,
  );
  const pulseClawback = minBigInt(
    pulseBeforeRefund,
    rewardAtRate(pulseRefunds, BONUS_PER_MILLE),
  );
  const pulse = {
    ...periods[halfIdx],
    periods,
    annualGross: pulseGross,
    refunds: pulseRefunds,
    beforeRefund: pulseBeforeRefund,
    clawback: pulseClawback,
    cashback: pulseBeforeRefund - pulseClawback,
    nextReset: halfIdx === 0 ? midYear : `${Number(year) + 1}-01-01`,
  };

  const totalCny =
    baseTotalCny === null
      ? null
      : baseTotalCny + world.cashback + pulse.cashback;

  const result = {
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
      hkdRefunds,
    },
    world,
    pulse,
    totalCny,
  };
  return matchedTransactions
    ? {
        ...result,
        allocations: allocatePulseTransactions(matchedTransactions, result),
      }
    : result;
}

// Each row gets the change in a pool's cumulative reward at full precision.
function allocateByAmount(rewardForTotal) {
  let total = 0n;
  let previous = 0n;
  return (amount) => {
    total += amount;
    const next = rewardForTotal(total);
    const allocated = next - previous;
    previous = next;
    return allocated;
  };
}

function allocatePulseTransactions(matchedTransactions, result) {
  const spend = (used, rate) =>
    allocateByAmount((total) => rewardAtRate(minBigInt(used, total), rate));
  const baseRefund = (gross) => {
    const grossReward = rewardAtRate(gross, BASE_PER_MILLE);
    return allocateByAmount(
      (total) =>
        grossReward - rewardAtRate(nonnegative(gross - total), BASE_PER_MILLE),
    );
  };
  const bonusRefund = (clawback) =>
    allocateByAmount((total) =>
      minBigInt(clawback, rewardAtRate(total, BONUS_PER_MILLE)),
    );

  const baseSpends = {
    CNY: spend(result.base.cnyGross, BASE_PER_MILLE),
    HKD: spend(result.base.hkdGross, BASE_PER_MILLE),
  };
  const baseRefunds = {
    CNY: baseRefund(result.base.cnyGross),
    HKD: baseRefund(result.base.hkdGross),
  };
  const annualSpend = spend(result.world.used, BONUS_PER_MILLE);
  const annualRefund = bonusRefund(result.world.clawback);
  const halfYearSpends = result.pulse.periods.map(({ used }) =>
    spend(used, BONUS_PER_MILLE),
  );
  const halfYearRefund = bonusRefund(result.pulse.clawback);

  // A stable sort keeps the workspace order for records with the same posting date.
  matchedTransactions.sort((left, right) =>
    left.transaction.day.localeCompare(right.transaction.day),
  );
  const allocations = new Map();
  for (const match of matchedTransactions) {
    const { transaction, amount, isCredit, isPulseEligible, refundBaseOnly } =
      match;
    const { id, currency, day } = transaction;
    const base = (isCredit ? baseRefunds : baseSpends)[currency](amount);
    const eligibleForBonus =
      currency === 'CNY' && !(isCredit && refundBaseOnly);
    const annual = eligibleForBonus
      ? (isCredit ? annualRefund : annualSpend)(amount)
      : 0n;
    const halfYear =
      eligibleForBonus && isPulseEligible
        ? (isCredit ? halfYearRefund : halfYearSpends[halfOfYear(day)])(amount)
        : 0n;
    const total = base + annual + halfYear;
    const { ratePercent, cashback: beforeCapCashback } = estimateBeforeCap(
      currency,
      match,
    );
    allocations.set(id, {
      base,
      annual,
      halfYear,
      ratePercent,
      beforeCapCashback,
      cashback: isCredit ? 0n : total,
      clawback: isCredit ? total : 0n,
    });
  }
  return allocations;
}

export const PULSE_REASONS = {
  outsideYear: '不在本年度估算日期内',
  category: '还款或费用不计奖赏',
  unsupportedCard: '不适用 Pulse 内置模型',
  currency: '币种不适用 Pulse 内置模型',
  excluded: '已设为不计奖赏',
  cnyPulseSpend: '计入人民币基础、年度及半年额外奖赏',
  cnyStandardSpend: '计入人民币基础及年度额外奖赏',
  cnyPulseRefund: '扣回人民币基础、年度及半年额外奖赏',
  cnyStandardRefund: '扣回人民币基础及年度额外奖赏',
  baseOnlyRefund: '仅扣回人民币基础返现',
  hkdSpend: '仅计入港币基础返现',
  hkdRefund: '仅扣回港币基础返现',
};
export function isPulseTransaction({ bankId, ruleId }) {
  return (!bankId || bankId === 'hsbc') && (!ruleId || ruleId === 'hsbc_pulse');
}

function matchPulseTransaction(tx, today, overrides) {
  const year = today.slice(0, 4);
  let reason,
    pending = false;
  if (!tx.day || tx.day < `${year}-01-01` || tx.day > today)
    reason = 'outsideYear';
  else if (['repayment', 'fee'].includes(tx.category)) reason = 'category';
  else if (!isPulseTransaction(tx)) {
    reason = 'unsupportedCard';
    pending = true;
  } else if (!['CNY', 'HKD'].includes(tx.currency)) {
    reason = 'currency';
    pending = true;
  }
  if (reason)
    return {
      included: false,
      reason,
      pending,
      day: tx.day || null,
      period: null,
    };
  const amount = toScaledBigInt(tx.amount);
  const override = overrides[tx.id] || {};
  const channel = override.channel || tx.channel?.key || 'standard';
  if (channel === 'exclude')
    return {
      included: false,
      reason: 'excluded',
      pending: false,
      day: tx.day,
      period: null,
    };
  const isCredit = tx.direction === 'credit';
  const isPulseEligible = ['applePay', 'unionpayQr'].includes(channel);
  const refundBaseOnly = Boolean(override.refundBaseOnly);
  const uncertain = Boolean(tx.channel?.uncertain && !override.channel);
  if (tx.currency === 'HKD') reason = isCredit ? 'hkdRefund' : 'hkdSpend';
  else if (isCredit && refundBaseOnly) reason = 'baseOnlyRefund';
  else if (isCredit)
    reason = isPulseEligible ? 'cnyPulseRefund' : 'cnyStandardRefund';
  else reason = isPulseEligible ? 'cnyPulseSpend' : 'cnyStandardSpend';
  return {
    included: true,
    reason,
    pending: uncertain,
    uncertain,
    day: tx.day,
    period:
      tx.currency === 'CNY' && isPulseEligible && !isCredit
        ? `${year}-H${halfOfYear(tx.day) + 1}`
        : year,
    amount,
    isCredit,
    isPulseEligible,
    refundBaseOnly,
  };
}

function estimateBeforeCap(
  currency,
  { amount, isCredit, isPulseEligible, refundBaseOnly },
) {
  const bonuses =
    currency === 'CNY' && !(isCredit && refundBaseOnly)
      ? isPulseEligible
        ? 2n
        : 1n
      : 0n;
  const perMille = BASE_PER_MILLE + bonuses * BONUS_PER_MILLE;
  const cashback = rewardAtRate(amount, perMille);
  return {
    ratePercent: Number(perMille) / 10,
    cashback: isCredit ? -cashback : cashback,
  };
}

/** Estimate a transaction in its original currency before allocating caps or netting refunds. */
export function estimatePulseTransaction(
  transaction,
  { today = getHongKongDate(), overrides = {} } = {},
) {
  const match = matchPulseTransaction(transaction, today, overrides);
  return match.included
    ? { included: true, ...estimateBeforeCap(transaction.currency, match) }
    : { included: false, reason: match.reason };
}

/** Trace eligibility without allocating aggregate caps to individual transactions. */
export function explainPulseTransactions(
  transactions,
  { today = getHongKongDate(), overrides = {} } = {},
) {
  return transactions.map((transaction) => {
    const {
      amount,
      isCredit,
      isPulseEligible,
      refundBaseOnly,
      ...explanation
    } = matchPulseTransaction(transaction, today, overrides);
    return { transaction, ...explanation };
  });
}

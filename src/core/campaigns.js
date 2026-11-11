import { cents } from './reconciliation.js';
import { toScaledBigInt, getHongKongDate } from './rewards.js';
import { getBank, bankOf, cardsFor } from './banks.js';
import {
  isProgressive,
  validateTiers,
  calculateTierReward,
} from './campaign-tiers.js';

export const PERIOD_LABELS = {
  campaign: '整个活动',
  monthly: '每个自然月',
  halfYear: '每半年',
  yearly: '每个自然年',
  statement: '自定义结单周期',
};
export const PERIODS = Object.keys(PERIOD_LABELS);
export const CHANNELS = [
  'any',
  'standard',
  'applePay',
  'unionpayQr',
  'online',
  'supermarket',
  'other',
];
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validateCampaign(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80
  )
    throw new Error('请输入活动名称（最多 80 字）');
  if (
    ['ratePercent', 'spendingCap', 'rewardCap', 'minSpend'].some(
      (key) =>
        value[key] != null && !['string', 'number'].includes(typeof value[key]),
    ) ||
    (value.registrationConfirmed != null &&
      typeof value.registrationConfirmed !== 'boolean')
  )
    throw new Error('本地库不存在或格式无效');
  if (!getBank(value.bankId)) throw new Error('请选择银行');
  if (value.cardId && !cardsFor(value.bankId).includes(value.cardId))
    throw new Error('请选择银行及卡片');
  if (!['CNY', 'HKD'].includes(value.currency)) throw new Error('请选择币种');
  if (
    !isIsoDate(value.startDate) ||
    !isIsoDate(value.endDate) ||
    value.startDate > value.endDate
  )
    throw new Error('请检查活动起止日期');
  if (
    !PERIODS.includes(value.period) ||
    !['posting', 'transaction'].includes(value.dateBasis)
  )
    throw new Error('请选择有效的计算周期');
  if (
    value.period === 'statement' &&
    (!['string', 'number'].includes(typeof value.statementDay) ||
      !/^(?:[1-9]|[12]\d|3[01])$/.test(String(value.statementDay)))
  )
    throw new Error('结单日须为 1 至 31 的整数');
  if (!CHANNELS.includes(value.channel))
    throw new Error('请选择有效的支付渠道');
  if (
    value.last4 != null &&
    (typeof value.last4 !== 'string' ||
      (value.last4 !== '' && !/^\d{4}$/.test(value.last4)))
  )
    throw new Error('卡号末四位须为 4 位数字');
  if (
    value.rewardType != null &&
    !['flat', 'progressive'].includes(value.rewardType)
  )
    throw new Error('奖赏计算方式不受支持');
  let tiers;
  if (isProgressive(value)) {
    // A zero flat rate makes older engines reject this model instead of silently using a fallback.
    if (String(value.ratePercent) !== '0')
      throw new Error('分段活动的固定费率须为 0');
    tiers = validateTiers(value.tiers);
  } else {
    if (value.tiers != null) throw new Error('固定费率活动不能包含分段配置');
    const rate = cents(value.ratePercent);
    if (rate <= 0n || rate > 10000n)
      throw new Error('回赠比例须大于 0 且不超过 100%');
  }
  for (const field of ['spendingCap', 'rewardCap', 'minSpend']) {
    if (value[field] !== '' && value[field] != null && cents(value[field]) < 0n)
      throw new Error('额度和门槛不能为负数');
  }
  if (
    value.merchant != null &&
    (typeof value.merchant !== 'string' || value.merchant.length > 120)
  )
    throw new Error('商户关键词过长');
  return {
    ...value,
    ...(tiers ? { tiers } : {}),
    name: value.name.trim(),
    ratePercent: String(value.ratePercent),
    merchant: (value.merchant || '').trim(),
    registrationConfirmed: value.registrationConfirmed === true,
  };
}
function closingDate(monthIndex, closingDay) {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(closingDay, days[month - 1])).padStart(2, '0')}`;
}

function periodKey(day, { period, statementDay }) {
  if (period === 'statement') {
    const month = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
    // The closing day belongs to the ending cycle; short months close on their last day.
    const endMonth =
      day <= closingDate(month, statementDay) ? month : month + 1;
    const previousClose = closingDate(endMonth - 1, statementDay);
    const start =
      previousClose === closingDate(endMonth - 1, 31)
        ? closingDate(endMonth, 1)
        : closingDate(endMonth - 1, Number(previousClose.slice(-2)) + 1);
    return `${start} → ${closingDate(endMonth, statementDay)}`;
  }
  if (period === 'monthly') return day.slice(0, 7);
  if (period === 'yearly') return day.slice(0, 4);
  if (period === 'halfYear')
    return `${day.slice(0, 4)}-H${day.slice(5, 7) < '07' ? 1 : 2}`;
  return 'campaign';
}
const min = (a, b) => (a < b ? a : b);
const positive = (value) => (value > 0n ? value : 0n);

/** Independent cash estimates; no cross-campaign stacking or inferred eligibility. */
export function calculateCampaign(
  transactions,
  input,
  { today = getHongKongDate() } = {},
) {
  const campaign = validateCampaign(input);
  const periods = new Map();
  let matchedCount = 0;
  for (const tx of transactions) {
    const match = matchTransaction(tx, campaign, today);
    if (!match.included) continue;
    const pool = periods.get(match.period) || {
      key: match.period,
      gross: 0n,
      refunds: 0n,
    };
    const amount = toScaledBigInt(tx.amount);
    if (tx.direction === 'credit') pool.refunds += amount;
    else pool.gross += amount;
    periods.set(match.period, pool);
    matchedCount++;
  }
  const rate = cents(campaign.ratePercent);
  const cap =
    campaign.spendingCap === '' || campaign.spendingCap == null
      ? null
      : toScaledBigInt(campaign.spendingCap);
  const rewardCap =
    campaign.rewardCap === '' || campaign.rewardCap == null
      ? null
      : toScaledBigInt(campaign.rewardCap);
  const threshold = toScaledBigInt(campaign.minSpend || '0');
  const results = [...periods.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((pool) => {
      const used = cap === null ? pool.gross : min(pool.gross, cap);
      const tierCalculation = isProgressive(campaign)
        ? calculateTierReward(used, campaign.tiers)
        : null;
      const beforeRefund = tierCalculation
        ? tierCalculation.reward
        : (used * rate) / 10000n;
      // Progressive refunds remove the highest occupied bands from capped eligible spending.
      // The original used amount (and hence remaining allowance) never changes.
      const clawback = tierCalculation
        ? beforeRefund -
          calculateTierReward(positive(used - pool.refunds), campaign.tiers)
            .reward
        : min(beforeRefund, (pool.refunds * rate) / 10000n);
      const netSpend = positive(pool.gross - pool.refunds);
      const thresholdMet = netSpend >= threshold;
      const uncappedReward = thresholdMet ? beforeRefund - clawback : 0n;
      // Apply the reward cap before clawback so refunds never refill a capped reward pool.
      const cappedBeforeRefund =
        rewardCap === null ? beforeRefund : min(beforeRefund, rewardCap);
      const cashback = thresholdMet
        ? positive(cappedBeforeRefund - clawback)
        : 0n;
      return {
        ...pool,
        ...(tierCalculation ? { tiers: tierCalculation.breakdown } : {}),
        netSpend,
        threshold,
        spendingCap: cap,
        rewardCap,
        cappedBeforeRefund,
        appliedClawback: min(cappedBeforeRefund, clawback),
        used,
        remaining: cap === null ? null : cap - used,
        beforeRefund,
        clawback,
        thresholdMet,
        uncappedReward,
        cashback,
      };
    });
  return {
    campaign,
    today,
    matchedCount,
    periods: results,
    cashback: results.reduce((sum, p) => sum + p.cashback, 0n),
  };
}

export const CAMPAIGN_REASONS = {
  unconfirmed: '尚未确认活动资格',
  bank: '银行不匹配',
  currency: '币种不匹配',
  card: '卡片不匹配',
  last4: '卡号末四位不匹配',
  missingDate: '缺少有效的计算日期',
  future: '晚于估算截止日',
  outsideDates: '不在活动日期范围',
  category: '还款或费用不计奖赏',
  excluded: '已设为不计奖赏',
  channel: '支付渠道不匹配',
  merchant: '商户关键词不匹配',
  invalidAmount: '金额或收支方向无效',
  spend: '计入消费',
  refund: '计入退款扣回',
};
function matchTransaction(tx, campaign, today) {
  const day = campaign.dateBasis === 'transaction' ? tx.transactionDay : tx.day;
  let reason;
  if (!campaign.registrationConfirmed) reason = 'unconfirmed';
  else if (bankOf(tx) !== campaign.bankId) reason = 'bank';
  else if (tx.currency !== campaign.currency) reason = 'currency';
  else if (campaign.cardId && tx.ruleId !== campaign.cardId) reason = 'card';
  else if (campaign.last4 && tx.last4 !== campaign.last4) reason = 'last4';
  else if (!isIsoDate(day)) reason = 'missingDate';
  else if (day > today) reason = 'future';
  else if (day < campaign.startDate || day > campaign.endDate)
    reason = 'outsideDates';
  else if (['repayment', 'fee'].includes(tx.category)) reason = 'category';
  else if (tx.channel?.key === 'exclude') reason = 'excluded';
  else if (campaign.channel !== 'any' && tx.channel?.key !== campaign.channel)
    reason = 'channel';
  else if (
    campaign.merchant &&
    !tx.description?.toLowerCase().includes(campaign.merchant.toLowerCase())
  )
    reason = 'merchant';
  else if (
    !['debit', 'credit'].includes(tx.direction) ||
    toScaledBigInt(tx.amount) <= 0n
  )
    reason = 'invalidAmount';
  if (reason)
    return {
      included: false,
      reason,
      day: isIsoDate(day) ? day : null,
      period: null,
    };
  return {
    included: true,
    reason: tx.direction === 'credit' ? 'refund' : 'spend',
    day,
    period: periodKey(day, campaign),
  };
}

/** Explanations are derived on demand; the first failing condition is reported. */
export function explainCampaignTransactions(
  transactions,
  input,
  { today = getHongKongDate() } = {},
) {
  const campaign = validateCampaign(input);
  return transactions.map((transaction) => ({
    transaction,
    ...matchTransaction(transaction, campaign, today),
  }));
}

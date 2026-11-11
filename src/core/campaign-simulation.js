import {
  calculateCampaign,
  explainCampaignTransactions,
  isIsoDate,
  validateCampaign,
} from './campaigns.js';
import { cardsFor } from './banks.js';
import { cents, formatCents } from './reconciliation.js';
import { getHongKongDate, toScaledBigInt } from './rewards.js';

/** Add one hypothetical eligible debit in memory. Never mutate or return a modified ledger. */
export function simulateCampaignSpend(
  transactions,
  input,
  { amount, date, today = getHongKongDate() },
) {
  const campaign = validateCampaign(input);
  if (!campaign.registrationConfirmed)
    throw new Error('请先核对并确认活动资格，再进行试算');
  if (!['string', 'number'].includes(typeof amount) || cents(amount) <= 0n)
    throw new Error('试算金额须大于 0，最多两位小数');
  if (!isIsoDate(date) || date < campaign.startDate || date > campaign.endDate)
    throw new Error('试算日期须在活动起止日期内');
  if (!isIsoDate(today)) throw new Error('试算截止日无效');
  const cutoff = date > today ? date : today;
  const normalizedAmount = formatCents(cents(amount));
  const hypothetical = {
    bankId: campaign.bankId,
    ruleId: campaign.cardId || cardsFor(campaign.bankId)[0],
    currency: campaign.currency,
    last4: campaign.last4 || '',
    day: date,
    transactionDay: date,
    description: campaign.merchant || 'SIMULATION',
    category: 'spend',
    direction: 'debit',
    amount: normalizedAmount,
    channel: {
      key: campaign.channel === 'any' ? 'standard' : campaign.channel,
    },
  };
  const match = explainCampaignTransactions([hypothetical], campaign, {
    today: cutoff,
  })[0];
  if (!match.included) throw new Error('试算消费未满足活动筛选条件');
  const before = calculateCampaign(transactions, campaign, { today: cutoff });
  const after = calculateCampaign([...transactions, hypothetical], campaign, {
    today: cutoff,
  });
  const progress = (result) => {
    const period = result.periods.find((item) => item.key === match.period);
    const netSpend = period?.netSpend ?? 0n;
    const threshold = toScaledBigInt(campaign.minSpend || '0');
    return {
      cashback: period?.cashback ?? 0n,
      netSpend,
      thresholdGap: threshold > netSpend ? threshold - netSpend : 0n,
      remaining: period
        ? period.remaining
        : campaign.spendingCap == null || campaign.spendingCap === ''
          ? null
          : toScaledBigInt(campaign.spendingCap),
    };
  };
  const beforePeriod = progress(before);
  const afterPeriod = progress(after);
  return {
    amount: normalizedAmount,
    date,
    cutoff,
    period: match.period,
    before: beforePeriod,
    after: afterPeriod,
    delta: afterPeriod.cashback - beforePeriod.cashback,
  };
}

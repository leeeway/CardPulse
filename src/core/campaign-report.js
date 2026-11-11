import { fromScaledBigInt } from './rewards.js';
import { PERIOD_LABELS } from './campaigns.js';
import { escapeCsvCell } from './safe-csv.js';
import { isProgressive } from './campaign-tiers.js';

// Deliberate projection: never serialize transactions, card digits, sources or workspace fields.
export function exportCampaignReport(result, t = (text) => text) {
  const { campaign, periods, today, cashback } = result;
  const headers = [
    '活动名称',
    '银行',
    '币种',
    '估算截止日',
    '起始日期',
    '结束日期',
    '封顶周期',
    '计算日期',
    '资格状态',
    '计算周期',
    '匹配消费总额',
    '匹配退款总额',
    '退款后净消费',
    '净消费门槛',
    '门槛状态',
    '消费上限',
    '参与计奖消费',
    '剩余消费额度',
    '回赠比例（%）',
    '封顶前奖赏',
    '奖赏上限',
    '奖赏封顶后',
    '本期退款扣回',
    '本期预计奖赏',
    '说明',
  ];
  const metadata = [
    campaign.name,
    campaign.bankId,
    campaign.currency,
    today,
    campaign.startDate,
    campaign.endDate,
    t(PERIOD_LABELS[campaign.period]),
    t(campaign.dateBasis === 'posting' ? '按记账日期' : '按交易日期'),
    t(campaign.registrationConfirmed ? '已确认资格' : '未确认资格，不计算奖赏'),
  ];
  const money = (value) =>
    value === null ? t('不限') : fromScaledBigInt(value);
  const note = t(
    '独立估算，不代表银行实际入账；退款不回补额度，不自动合并其他活动。',
  );
  const rateDescription = isProgressive(campaign)
    ? `${t('分段累进费率')}: ${campaign.tiers.map((tier, index) => `${tier.from} → ${campaign.tiers[index + 1]?.from ?? t('不限')}: ${tier.ratePercent}%`).join('; ')}`
    : campaign.ratePercent;
  const reportNote = isProgressive(campaign)
    ? `${note} ${t('退款从封顶计奖消费的最高已用分段向下扣回；不追溯原单、不释放额度。')}`
    : note;
  const rows = periods.map((p) => [
    ...metadata,
    p.key === 'campaign' ? t('整个活动') : p.key,
    money(p.gross),
    money(p.refunds),
    money(p.netSpend),
    money(p.threshold),
    t(p.thresholdMet ? '已达门槛' : '未达门槛'),
    money(p.spendingCap),
    money(p.used),
    money(p.remaining),
    rateDescription,
    money(p.beforeRefund),
    money(p.rewardCap),
    money(p.cappedBeforeRefund),
    money(p.appliedClawback),
    money(p.cashback),
    reportNote,
  ]);
  rows.push([
    ...metadata,
    t('活动合计'),
    ...Array(8).fill(''),
    rateDescription,
    ...Array(4).fill(''),
    money(cashback),
    reportNote,
  ]);
  return (
    '\uFEFF' +
    [headers.map((header) => t(header)), ...rows]
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\r\n')
  );
}

import React, { useCallback } from 'react';
import TransactionExplanations from './TransactionExplanations.jsx';
import {
  CAMPAIGN_REASONS,
  explainCampaignTransactions,
} from '../core/campaigns.js';
import { fromScaledBigInt } from '../core/rewards.js';

export default function CampaignBreakdown({ result, transactions, t }) {
  const getEntries = useCallback(
    () =>
      explainCampaignTransactions(transactions, result.campaign, {
        today: result.today,
      }),
    [transactions, result.campaign, result.today],
  );
  const money = (value) =>
    value === null
      ? t('不限')
      : `${result.campaign.currency} ${fromScaledBigInt(value)}`;
  return (
    <div className="campaign-breakdown">
      <details className="period-breakdown">
        <summary>{t('本期估算')}</summary>
        <p className="muted small">
          {t('估算截止日')}：{result.today} ·{' '}
          {t(
            result.campaign.dateBasis === 'transaction'
              ? '按交易日期'
              : '按记账日期',
          )}
        </p>
        {result.periods.length === 0 && (
          <p className="muted small">
            {t(
              result.campaign.registrationConfirmed
                ? '没有符合活动条件的交易，请展开逐笔说明核查。'
                : '尚未确认活动资格',
            )}
          </p>
        )}
        {result.periods.map((period) => (
          <section
            key={period.key}
            className="period-calculation"
            aria-label={`${t('计算周期')} ${period.key}`}
          >
            <h4>{period.key === 'campaign' ? t('整个活动') : period.key}</h4>
            <dl>
              {[
                ['匹配消费总额', money(period.gross)],
                ['匹配退款总额', money(period.refunds)],
                ['退款后净消费', money(period.netSpend)],
                ['净消费门槛', money(period.threshold)],
                ['消费上限', money(period.spendingCap)],
                ['参与计奖消费', money(period.used)],
                ['剩余消费额度', money(period.remaining)],
                [
                  '封顶前奖赏',
                  `${money(period.used)} × ${result.campaign.ratePercent}% = ${money(period.beforeRefund)}`,
                ],
                ['奖赏上限', money(period.rewardCap)],
                ['奖赏封顶后', money(period.cappedBeforeRefund)],
                ['本期退款扣回', money(period.appliedClawback)],
                ['本期预计奖赏', money(period.cashback)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{t(label)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {!period.thresholdMet && (
              <p className="notice-inline">
                {t('净消费门槛未达标，本周期奖赏为零。')}
              </p>
            )}
          </section>
        ))}
        <p className="muted small">
          {t(
            '先应用消费及奖赏上限，再扣退款；退款不回补额度。计算保留精度，分项显示舍入可能产生尾差。',
          )}
        </p>
      </details>
      <TransactionExplanations
        getEntries={getEntries}
        matchedCount={result.matchedCount}
        reasonLabels={CAMPAIGN_REASONS}
        t={t}
      />
    </div>
  );
}

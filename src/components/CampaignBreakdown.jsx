import React, { useMemo, useState } from 'react';
import {
  CAMPAIGN_REASONS,
  explainCampaignTransactions,
} from '../core/campaigns.js';
import { fromScaledBigInt } from '../core/rewards.js';

const PAGE_SIZE = 25;
export default function CampaignBreakdown({ result, transactions, t }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const entries = useMemo(
    () =>
      open
        ? explainCampaignTransactions(transactions, result.campaign, {
            today: result.today,
          })
        : [],
    [open, transactions, result.campaign, result.today],
  );
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          status === 'all' || entry.included === (status === 'included'),
      ),
    [entries, status],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const excludedCounts = useMemo(() => {
    const counts = new Map();
    for (const entry of entries)
      if (!entry.included)
        counts.set(entry.reason, (counts.get(entry.reason) || 0) + 1);
    return [...counts];
  }, [entries]);
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
      <details
        className="transaction-explanations"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>{t('逐笔计算说明')}</summary>
        {open && (
          <>
            <p className="muted small">
              {t('计入 {included} 笔，排除 {excluded} 笔。', {
                included: result.matchedCount,
                excluded: entries.length - result.matchedCount,
              })}
            </p>
            <p className="muted small">
              {t(
                '排除记录显示首个不满足的条件。奖赏按周期汇总，未向单笔交易分配封顶额度。',
              )}
            </p>
            {excludedCounts.length > 0 && (
              <ul className="exclusion-summary">
                {excludedCounts.map(([reason, count]) => (
                  <li key={reason}>
                    {t(CAMPAIGN_REASONS[reason])} · {count}
                  </li>
                ))}
              </ul>
            )}
            <label className="field">
              <span>{t('说明记录范围')}</span>
              <select
                aria-label={t('说明记录范围')}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">{t('全部记录')}</option>
                <option value="included">{t('仅计入记录')}</option>
                <option value="excluded">{t('仅排除记录')}</option>
              </select>
            </label>
            {filtered.length ? (
              <div className="explanation-table">
                <table>
                  <thead>
                    <tr>
                      {[
                        '计算日期',
                        '商户与描述',
                        '金额',
                        '计算周期',
                        '计入或排除原因',
                      ].map((label) => (
                        <th key={label}>{t(label)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .slice(
                        currentPage * PAGE_SIZE,
                        (currentPage + 1) * PAGE_SIZE,
                      )
                      .map((entry) => (
                        <tr key={entry.transaction.id}>
                          <td>{entry.day || '—'}</td>
                          <td>{entry.transaction.description}</td>
                          <td>
                            {entry.transaction.currency}{' '}
                            {entry.transaction.direction === 'credit'
                              ? '−'
                              : '+'}
                            {entry.transaction.amount}
                          </td>
                          <td>
                            {entry.period === 'campaign'
                              ? t('整个活动')
                              : entry.period || '—'}
                          </td>
                          <td>
                            {t(CAMPAIGN_REASONS[entry.reason])}
                            {entry.included &&
                              entry.transaction.channel?.uncertain && (
                                <small>
                                  {t('渠道待人工确认，当前按识别结果估算。')}
                                </small>
                              )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">{t('此范围没有记录')}</p>
            )}
            <div className="explanation-pagination">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t('上一页')}
              </button>
              <span>
                {t('第 {page} / {pages} 页', {
                  page: currentPage + 1,
                  pages: pageCount,
                })}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {t('下一页')}
              </button>
            </div>
          </>
        )}
      </details>
    </div>
  );
}

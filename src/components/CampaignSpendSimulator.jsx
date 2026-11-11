import React, { useMemo, useState } from 'react';
import { simulateCampaignSpend } from '../core/campaign-simulation.js';
import { fromScaledBigInt } from '../core/rewards.js';

export default function CampaignSpendSimulator({
  campaign,
  transactions,
  today,
  disabled,
  t,
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() =>
    today < campaign.startDate
      ? campaign.startDate
      : today > campaign.endDate
        ? campaign.endDate
        : today,
  );
  const [request, setRequest] = useState(null);
  // Recompute a submitted scenario if transactions, rules or the shared cutoff change.
  const calculation = useMemo(() => {
    if (!open || !request) return null;
    try {
      return {
        result: simulateCampaignSpend(transactions, campaign, {
          ...request,
          today,
        }),
      };
    } catch (error) {
      return { error: error.message };
    }
  }, [open, request, transactions, campaign, today]);
  const money = (value) =>
    value === null
      ? t('不限')
      : `${campaign.currency} ${fromScaledBigInt(value)}`;
  const result = calculation?.result;
  const unavailable = disabled || !campaign.registrationConfirmed;
  return (
    <details
      className="campaign-simulator"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t('活动消费试算')}</summary>
      {open && (
        <>
          <p className="muted small">
            {t(
              '假设新增一笔满足此活动银行、卡片、渠道及商户筛选的消费；不核验真实交易资格，不合并其他活动。',
            )}
          </p>
          <p className="muted small">
            {t(
              '仅在内存中比较，不写入交易、保险库、规则或核对表；锁定或刷新后清除。',
            )}
          </p>
          <p className="muted small">
            {t(
              '试算日期使用活动所选的记账／交易日期口径。未来日期会同时延长前后两组估算的截止日，纳入已导入的相应记录。',
            )}
          </p>
          {!campaign.registrationConfirmed && (
            <p className="notice-inline">
              {t('请先核对并确认活动资格，再进行试算')}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!unavailable) setRequest({ amount, date });
            }}
          >
            <div className="form-grid">
              <label className="field">
                <span>{t('试算消费金额')}</span>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={amount}
                  disabled={unavailable}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setRequest(null);
                  }}
                />
              </label>
              <label className="field">
                <span>{t('试算消费日期')}</span>
                <input
                  type="date"
                  required
                  min={campaign.startDate}
                  max={campaign.endDate}
                  value={date}
                  disabled={unavailable}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setRequest(null);
                  }}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={unavailable}
              >
                {t('计算试算结果')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setRequest(null);
                  setAmount('');
                }}
              >
                {t('清除试算')}
              </button>
            </div>
          </form>
          {calculation?.error && (
            <p className="error" role="alert">
              {t(calculation.error)}
            </p>
          )}
          {result && (
            <section
              className="simulation-result"
              aria-label={t('试算结果')}
              aria-live="polite"
            >
              <p className="muted small">
                {t('试算截止日')}：{result.cutoff} · {t('计算周期')}：
                {result.period === 'campaign' ? t('整个活动') : result.period}
              </p>
              <dl>
                {[
                  ['该周期原预计奖赏', money(result.before.cashback)],
                  ['试算后预计奖赏', money(result.after.cashback)],
                  ['预计奖赏变化', money(result.delta)],
                  ['试算后净消费', money(result.after.netSpend)],
                  ['试算后距净消费门槛', money(result.after.thresholdGap)],
                  ['试算后剩余消费额度', money(result.after.remaining)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{t(label)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">
                {t(
                  '整个周期重新计算；门槛或退款扣回可能使奖赏变化为零、负数或大于新增消费按费率计算的金额。不代表银行承诺。',
                )}
              </p>
            </section>
          )}
        </>
      )}
    </details>
  );
}

import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Gift } from 'lucide-react';
import { BANKS, cardsFor, cardName } from '../core/banks.js';
import {
  calculateCampaign,
  validateCampaign,
  PERIODS,
  CHANNELS,
} from '../core/campaigns.js';
import { fromScaledBigInt, getHongKongDate } from '../core/rewards.js';
import { channelText } from '../core/i18n.js';
import CampaignBreakdown from './CampaignBreakdown.jsx';

export default function CampaignPanel({
  campaigns,
  transactions,
  disabled,
  bankName,
  t,
  onSave,
  onDelete,
}) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const results = useMemo(
    () =>
      campaigns.map((campaign) => {
        try {
          return { ...calculateCampaign(transactions, campaign) };
        } catch (error) {
          return { campaign, error: error.message };
        }
      }),
    [campaigns, transactions],
  );
  const create = () => {
    const today = getHongKongDate();
    setError('');
    setDraft({
      id: crypto.randomUUID(),
      name: '',
      bankId: 'hsbc',
      cardId: '',
      currency: 'HKD',
      startDate: `${today.slice(0, 4)}-01-01`,
      endDate: `${today.slice(0, 4)}-12-31`,
      ratePercent: '',
      period: 'monthly',
      dateBasis: 'posting',
      channel: 'any',
      spendingCap: '',
      rewardCap: '',
      minSpend: '',
      merchant: '',
      last4: '',
      registrationConfirmed: false,
    });
  };
  const change = (field, value) =>
    setDraft((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'bankId' ? { cardId: '' } : {}),
    }));
  const field = (label, key, props = {}) => (
    <label className="field">
      <span>{t(label)}</span>
      <input
        value={draft[key]}
        onChange={(e) => change(key, e.target.value)}
        {...props}
      />
    </label>
  );
  const select = (label, key, options) => (
    <label className="field">
      <span>{t(label)}</span>
      <select
        aria-label={t(label)}
        value={draft[key]}
        onChange={(e) => change(key, e.target.value)}
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const periodNames = ['整个活动', '每个自然月', '每半年', '每个自然年'];
  return (
    <section
      className="panel campaign-panel"
      aria-labelledby="campaign-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">REWARD STUDIO</p>
          <h2 id="campaign-heading">{t('自定义活动')}</h2>
          <p>{t('配置银行、日期、费率与封顶，用自己的条款计算现金奖赏。')}</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={disabled}
          onClick={create}
        >
          <Plus size={16} />
          {t('添加活动')}
        </button>
      </div>
      <p className="notice-inline">
        {t('活动独立估算，请勿直接与其他活动或 Pulse 奖赏相加。')}
      </p>
      <p className="muted small">
        {t(
          '退款按所选日期周期扣回、不释放消费或奖赏额度；跨期原单追溯、阶梯费率、积分和结单周期暂不支持。',
        )}
      </p>
      {draft && !disabled && (
        <form
          className="campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onSave(validateCampaign(draft));
              setDraft(null);
              setError('');
            } catch (error) {
              setError(error.message);
            }
          }}
        >
          <h3>
            {t(
              campaigns.some((c) => c.id === draft.id)
                ? '编辑活动'
                : '添加活动',
            )}
          </h3>
          <div className="form-grid">
            {field('活动名称', 'name', {
              required: true,
              maxLength: 80,
              placeholder: t('例如：十月网购额外回赠'),
            })}
            {select(
              '银行',
              'bankId',
              BANKS.map((bank) => [bank.id, bankName(bank)]),
            )}
            {select('适用卡片', 'cardId', [
              ['', t('全部卡片')],
              ...cardsFor(draft.bankId).map((id) => [id, t(cardName(id))]),
            ])}
            {select('币种', 'currency', [
              ['HKD', 'HKD'],
              ['CNY', 'CNY'],
            ])}
            {field('起始日期', 'startDate', { type: 'date', required: true })}
            {field('结束日期', 'endDate', { type: 'date', required: true })}
            {field('回赠比例（%）', 'ratePercent', {
              type: 'number',
              min: '0.01',
              max: '100',
              step: '0.01',
              required: true,
            })}
            {select(
              '封顶周期',
              'period',
              PERIODS.map((value, index) => [value, t(periodNames[index])]),
            )}
            {field('每周期消费上限', 'spendingCap', {
              type: 'number',
              min: '0',
              step: '0.01',
              placeholder: t('留空为不限'),
            })}
            {field('每周期奖赏上限', 'rewardCap', {
              type: 'number',
              min: '0',
              step: '0.01',
              placeholder: t('留空为不限'),
            })}
            {field('每周期净消费门槛', 'minSpend', {
              type: 'number',
              min: '0',
              step: '0.01',
              placeholder: '0.00',
            })}
            {select('计算日期', 'dateBasis', [
              ['posting', t('按记账日期')],
              ['transaction', t('按交易日期')],
            ])}
            {select(
              '渠道',
              'channel',
              CHANNELS.map((key) => [key, t(channelText(key))]),
            )}
            {field('卡号末四位', 'last4', {
              inputMode: 'numeric',
              maxLength: 4,
              placeholder: t('不限卡号'),
            })}
            {field('商户关键词', 'merchant', {
              maxLength: 120,
              placeholder: t('留空为所有商户'),
            })}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.registrationConfirmed}
              onChange={(e) =>
                change('registrationConfirmed', e.target.checked)
              }
            />
            {t('我已核对条款及登记要求，确认上述筛选范围合资格')}
          </label>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft(null)}
            >
              {t('取消')}
            </button>
            <button className="btn btn-primary" type="submit">
              {t('保存活动')}
            </button>
          </div>
        </form>
      )}
      <div className="campaign-grid">
        {results.map((result) => (
          <article className="activity-card" key={result.campaign.id}>
            <div className="activity-top">
              <Gift size={18} />
              <span className="badge-tag">
                {t(
                  result.campaign.registrationConfirmed
                    ? '已确认资格'
                    : '未确认资格，不计算奖赏',
                )}
              </span>
            </div>
            <h3>{result.campaign.name}</h3>
            <p className="muted small">
              {bankName(
                BANKS.find((bank) => bank.id === result.campaign.bankId),
              )}{' '}
              · {result.campaign.ratePercent}% ·{' '}
              {t(
                periodNames[PERIODS.indexOf(result.campaign.period)] ||
                  '整个活动',
              )}
            </p>
            {result.error ? (
              <p className="error">{t(result.error)}</p>
            ) : (
              <>
                <div className="reward-card-value">
                  <small>{result.campaign.currency}</small>
                  {fromScaledBigInt(result.cashback)}
                </div>
                <p className="muted small">
                  {result.campaign.startDate} → {result.campaign.endDate} ·{' '}
                  {t('匹配 {count} 笔', { count: result.matchedCount })}
                </p>
                <CampaignBreakdown
                  result={result}
                  transactions={transactions}
                  t={t}
                />
              </>
            )}
            <div className="form-actions">
              <button
                className="btn btn-ghost"
                disabled={disabled}
                onClick={() => {
                  setError('');
                  setDraft({ ...result.campaign });
                }}
              >
                <Pencil size={14} />
                {t('编辑活动')}
              </button>
              <button
                className="btn btn-ghost"
                disabled={disabled}
                onClick={() => {
                  if (confirm(t('确认删除这个活动？'))) {
                    onDelete(result.campaign.id);
                    if (draft?.id === result.campaign.id) setDraft(null);
                  }
                }}
              >
                <Trash2 size={14} />
                {t('删除活动')}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!campaigns.length && !draft && (
        <div className="empty-activities">
          <Gift size={24} />
          <span>{t('尚未添加活动')}</span>
        </div>
      )}
      <p className="muted small">{t('已保存到加密库的活动会随解锁恢复。')}</p>
    </section>
  );
}

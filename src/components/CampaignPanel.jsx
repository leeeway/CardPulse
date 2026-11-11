import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Gift, Copy } from 'lucide-react';
import { BANKS, cardsFor, cardName } from '../core/banks.js';
import {
  calculateCampaign,
  validateCampaign,
  PERIODS,
  PERIOD_LABELS,
  CHANNELS,
} from '../core/campaigns.js';
import { fromScaledBigInt } from '../core/rewards.js';
import { channelText } from '../core/i18n.js';
import CampaignBreakdown from './CampaignBreakdown.jsx';
import CampaignRulesPreview from './CampaignRulesPreview.jsx';
import CampaignTierEditor from './CampaignTierEditor.jsx';
import CampaignSpendSimulator from './CampaignSpendSimulator.jsx';
import { isProgressive } from '../core/campaign-tiers.js';
import { exportCampaignReport } from '../core/campaign-report.js';
import { campaignStatus, filterCampaigns } from '../core/campaign-list.js';
import {
  MAX_RULES_BYTES,
  parseCampaignRules,
  serializeCampaignRules,
  copyCampaign,
} from '../core/campaign-rules.js';

export default function CampaignPanel({
  today,
  campaigns,
  transactions,
  disabled,
  bankName,
  t,
  onSave,
  onDelete,
  onEditingChange,
  onImportRules,
  onExportRules,
  onExportReport,
  allCampaignNames,
}) {
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const listedCampaigns = useMemo(
    () => filterCampaigns(campaigns, { query, status, today }),
    [campaigns, query, status, today],
  );
  const [error, setError] = useState('');
  const [rules, setRules] = useState(null);
  const [rulesError, setRulesError] = useState('');
  const [readingRules, setReadingRules] = useState(false);
  const rulesInput = useRef(null);
  const readSequence = useRef(0);
  useEffect(
    () => () => {
      readSequence.current++;
    },
    [],
  );
  const editing = Boolean(draft || rules || readingRules);
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const exportRules = (values) => {
    try {
      onExportRules(serializeCampaignRules(values));
      setRulesError('');
    } catch (error) {
      setRulesError(error.message);
    }
  };
  const readRules = async (file) => {
    if (!file || disabled || draft) return;
    const request = ++readSequence.current;
    setReadingRules(true);
    setRulesError('');
    try {
      if (file.size > MAX_RULES_BYTES)
        throw new Error('活动规则文件不能超过 256 KB');
      const parsed = parseCampaignRules(await file.text());
      if (request === readSequence.current) setRules(parsed);
    } catch (error) {
      if (request === readSequence.current) setRulesError(error.message);
    } finally {
      if (request === readSequence.current) setReadingRules(false);
    }
  };
  const results = useMemo(
    () =>
      campaigns.map((campaign) => {
        try {
          return { ...calculateCampaign(transactions, campaign, { today }) };
        } catch (error) {
          return { campaign, error: error.message };
        }
      }),
    [campaigns, transactions, today],
  );
  const canReplaceDraft = () =>
    !draft || confirm(t('已有活动编辑草稿，继续将替换草稿。确认继续？'));
  const create = () => {
    if (!canReplaceDraft()) return;
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
      rewardType: 'flat',
      period: 'monthly',
      statementDay: '',
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
      ...(field === 'rewardType'
        ? {
            ratePercent: value === 'progressive' ? '0' : '',
            tiers:
              value === 'progressive'
                ? [
                    { from: '0', ratePercent: '' },
                    { from: '', ratePercent: '' },
                  ]
                : undefined,
            registrationConfirmed: false,
          }
        : {}),
    }));
  const field = (label, key, props = {}) => (
    <label className="field">
      <span>{t(label)}</span>
      <input
        value={draft[key] ?? ''}
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
        value={draft[key] ?? (key === 'rewardType' ? 'flat' : '')}
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
          disabled={disabled || readingRules}
          onClick={create}
        >
          <Plus size={16} />
          {t('添加活动')}
        </button>
      </div>
      <div className="rules-controls">
        <input
          ref={rulesInput}
          type="file"
          hidden
          accept=".json"
          aria-label={t('选择活动规则文件')}
          disabled={disabled || readingRules || Boolean(draft)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            readRules(file);
          }}
        />
        <button
          className="btn btn-secondary"
          disabled={disabled || readingRules || Boolean(draft)}
          onClick={() => rulesInput.current?.click()}
        >
          {t(readingRules ? '正在读取规则…' : '导入活动规则')}
        </button>
        <button
          className="btn btn-secondary"
          disabled={disabled || readingRules || !campaigns.length}
          onClick={() => exportRules(campaigns)}
        >
          {t('导出活动规则')}
        </button>
      </div>
      <p className="muted small">
        {t(
          '规则文件为明文，包含活动名称及商户关键词；不含交易、卡号末四位或资格确认。只导出当前银行范围内的活动，不含编辑草稿。',
        )}
      </p>
      <p className="muted small">
        {t('每次导入或导出最多 50 个活动，文件上限 256 KB。')}
      </p>
      {rulesError && (
        <p className="error" role="alert">
          {t(rulesError)}
        </p>
      )}
      {rules && (
        <CampaignRulesPreview
          rules={rules}
          existingNames={allCampaignNames}
          disabled={disabled}
          bankName={bankName}
          t={t}
          onImport={onImportRules}
          onClose={() => setRules(null)}
        />
      )}
      <p className="notice-inline">
        {t('活动独立估算，请勿直接与其他活动或 Pulse 奖赏相加。')}
      </p>
      <p className="muted small">
        {t(
          '退款按所选日期周期扣回、不释放消费或奖赏额度；跨期原单追溯及积分暂不支持。',
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
            {select('奖赏计算方式', 'rewardType', [
              ['flat', t('固定费率')],
              ['progressive', t('分段累进费率')],
            ])}
            {!isProgressive(draft) &&
              field('回赠比例（%）', 'ratePercent', {
                type: 'number',
                min: '0.01',
                max: '100',
                step: '0.01',
                required: true,
              })}
            {select(
              '封顶周期',
              'period',
              PERIODS.map((value) => [value, t(PERIOD_LABELS[value])]),
            )}
            {draft.period === 'statement' &&
              field('每月结单日', 'statementDay', {
                type: 'number',
                min: '1',
                max: '31',
                step: '1',
                required: true,
                placeholder: t('例如：25'),
              })}
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
          {isProgressive(draft) && (
            <CampaignTierEditor
              tiers={draft.tiers}
              onChange={(tiers) => change('tiers', tiers)}
              t={t}
            />
          )}
          {draft.period === 'statement' && (
            <p className="notice-inline">
              {t(
                '结单日当天计入本周期，次日开启新周期；短月取月末。不自动调整假期或实际结单日，请核对条款。',
              )}
            </p>
          )}
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
      <div className="form-grid">
        <label className="field">
          <span>{t('搜索活动')}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('活动名称或商户关键词')}
          />
        </label>
        <label className="field">
          <span>{t('活动状态')}</span>
          <select
            aria-label={t('活动状态')}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {Object.entries({
              all: '全部活动',
              active: '进行中',
              upcoming: '未开始',
              ended: '已结束',
              unconfirmed: '待确认资格',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small" aria-live="polite">
        {t('显示 {shown} / {total} 个活动', {
          shown: listedCampaigns.length,
          total: campaigns.length,
        })}
      </p>
      <p className="muted small">
        {t(
          '活动搜索和状态仅筛选卡片，不改变计算或规则导出范围；日期状态按香港日期判断，与资格确认独立。',
        )}
      </p>
      {campaigns.length > 0 && listedCampaigns.length === 0 && (
        <div className="empty-activities">
          <span>{t('没有符合筛选的活动')}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuery('');
              setStatus('all');
            }}
          >
            {t('重置活动筛选')}
          </button>
        </div>
      )}
      <div className="campaign-grid">
        {results
          .filter((result) =>
            listedCampaigns.some(
              (campaign) => campaign.id === result.campaign.id,
            ),
          )
          .map((result) => (
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
              <span className="badge-tag">
                {t(
                  { active: '进行中', upcoming: '未开始', ended: '已结束' }[
                    campaignStatus(result.campaign, today)
                  ],
                )}
              </span>
              <p className="muted small">
                {bankName(
                  BANKS.find((bank) => bank.id === result.campaign.bankId),
                )}{' '}
                ·{' '}
                {isProgressive(result.campaign)
                  ? t('分段累进费率')
                  : `${result.campaign.ratePercent}%`}{' '}
                · {t(PERIOD_LABELS[result.campaign.period] || '整个活动')}
                {result.campaign.period === 'statement' &&
                  ` · ${t('每月 {day} 日结单', { day: result.campaign.statementDay })}`}
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
                  <CampaignSpendSimulator
                    campaign={result.campaign}
                    transactions={transactions}
                    today={today}
                    disabled={disabled}
                    t={t}
                  />
                </>
              )}
              <div className="form-actions">
                <button
                  className="btn btn-ghost"
                  disabled={disabled || readingRules}
                  onClick={() => {
                    if (!canReplaceDraft()) return;
                    try {
                      setDraft(copyCampaign(result.campaign, t('（副本）')));
                      setError('');
                    } catch (error) {
                      setRulesError(error.message);
                    }
                  }}
                >
                  <Copy size={14} />
                  {t('复制活动')}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={disabled || readingRules}
                  onClick={() => exportRules([result.campaign])}
                >
                  {t('导出此规则')}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={disabled || Boolean(result.error)}
                  onClick={() => {
                    try {
                      onExportReport(exportCampaignReport(result, t));
                      setRulesError('');
                    } catch (error) {
                      setRulesError(error.message);
                    }
                  }}
                >
                  {t('导出奖赏核对表')}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => {
                    if (!canReplaceDraft()) return;
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
      <p className="muted small">
        {t(
          '核对表为明文，包含活动名称及消费／奖赏汇总，不含逐笔交易或卡号；不替代加密备份。',
        )}
      </p>
      <p className="muted small">{t('已保存到加密库的活动会随解锁恢复。')}</p>
    </section>
  );
}

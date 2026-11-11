import React, { useEffect, useRef, useState } from 'react';
import { BANKS, cardName } from '../core/banks.js';
import { channelText } from '../core/i18n.js';
import { PERIOD_LABELS } from '../core/campaigns.js';
import { isProgressive } from '../core/campaign-tiers.js';
import CampaignTierRules from './CampaignTierRules.jsx';

export default function CampaignRulesPreview({
  rules,
  existingNames = [],
  disabled,
  bankName,
  onImport,
  onClose,
  t,
}) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal-content vault-dialog rules-preview"
      aria-labelledby="rules-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!disabled) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id="rules-preview-title">{t('预览活动规则')}</h2>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={disabled}
          aria-label={t('关闭')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <p>
        {t('将新增 {count} 个活动，不覆盖现有活动；导入后显示全部银行。', {
          count: rules.length,
        })}
      </p>
      <p className="notice-inline">
        {t(
          '不会导入卡号末四位或资格确认。请逐个编辑，核对范围及条款后再确认资格。',
        )}
      </p>
      <div className="rules-preview-list">
        {rules.map((rule, index) => (
          <details className="rule-preview" key={index} open={index === 0}>
            <summary>
              {index + 1}. {rule.name}
            </summary>
            {existingNames.includes(rule.name) && (
              <p className="notice-inline">
                {t('已有同名活动，本次仍将新增独立活动。')}
              </p>
            )}
            <dl>
              {[
                [
                  '银行',
                  bankName(BANKS.find((bank) => bank.id === rule.bankId)),
                ],
                [
                  '适用卡片',
                  rule.cardId ? t(cardName(rule.cardId)) : t('全部卡片'),
                ],
                ['币种', rule.currency],
                ['起始日期', rule.startDate],
                ['结束日期', rule.endDate],
                ...(isProgressive(rule)
                  ? [['奖赏计算方式', t('分段累进费率')]]
                  : [['回赠比例（%）', rule.ratePercent]]),
                ['封顶周期', t(PERIOD_LABELS[rule.period])],
                ...(rule.period === 'statement'
                  ? [['每月结单日', rule.statementDay]]
                  : []),
                ['每周期消费上限', rule.spendingCap || t('不限')],
                ['每周期奖赏上限', rule.rewardCap || t('不限')],
                ['每周期净消费门槛', rule.minSpend || '0'],
                [
                  '计算日期',
                  t(rule.dateBasis === 'posting' ? '按记账日期' : '按交易日期'),
                ],
                ['渠道', t(channelText(rule.channel))],
                ['商户关键词', rule.merchant || t('不限')],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{t(label)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {isProgressive(rule) && <CampaignTierRules campaign={rule} t={t} />}
            {rule.period === 'statement' && (
              <p className="notice-inline">
                {t(
                  '结单日当天计入本周期，次日开启新周期；短月取月末。不自动调整假期或实际结单日，请核对条款。',
                )}
              </p>
            )}
          </details>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="form-actions">
        <button
          className="btn btn-secondary"
          type="button"
          disabled={disabled}
          onClick={onClose}
        >
          {t('取消')}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={disabled}
          onClick={() => {
            try {
              onImport(rules);
              onClose();
            } catch (error) {
              setError(error.message || '操作失败，请重试');
            }
          }}
        >
          {t('确认新增活动')}
        </button>
      </div>
    </dialog>
  );
}

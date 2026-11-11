import React from 'react';
import { MAX_CAMPAIGN_TIERS } from '../core/campaign-tiers.js';

export default function CampaignTierEditor({ tiers, onChange, t }) {
  const change = (index, key, value) =>
    onChange(
      tiers.map((tier, i) => (i === index ? { ...tier, [key]: value } : tier)),
    );
  return (
    <fieldset className="campaign-tiers">
      <legend>{t('分段累进费率')}</legend>
      <p className="muted small">
        {t(
          '首段从 0 开始，起点递增；每段只计算该区间消费，最后一段不限。不是达标后全部消费改用高费率。',
        )}
      </p>
      <p className="muted small">
        {t(
          '分段活动的保存及备份需要支持分段费率的版本读取；建议保留升级前备份。',
        )}
      </p>
      {tiers.map((tier, index) => (
        <div className="tier-editor-row" key={index}>
          <label className="field">
            <span>{t('第 {index} 段起点', { index: index + 1 })}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              readOnly={index === 0}
              value={tier.from}
              onChange={(event) => change(index, 'from', event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('第 {index} 段费率（%）', { index: index + 1 })}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={tier.ratePercent}
              onChange={(event) =>
                change(index, 'ratePercent', event.target.value)
              }
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={tiers.length <= 2 || index === 0}
            aria-label={t('删除第 {index} 段', { index: index + 1 })}
            onClick={() => onChange(tiers.filter((_, i) => i !== index))}
          >
            {t('删除分段')}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={tiers.length >= MAX_CAMPAIGN_TIERS}
        onClick={() => onChange([...tiers, { from: '', ratePercent: '' }])}
      >
        {t('添加分段')}
      </button>
    </fieldset>
  );
}

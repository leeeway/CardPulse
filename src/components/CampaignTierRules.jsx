import React from 'react';

export default function CampaignTierRules({ campaign, t }) {
  return (
    <div className="tier-rules">
      <p className="muted small">{t('分段累进费率')}</p>
      <ul>
        {campaign.tiers.map((tier, index) => (
          <li key={index}>
            {campaign.currency} {tier.from} →{' '}
            {campaign.tiers[index + 1]?.from ?? t('不限')} · {tier.ratePercent}%
          </li>
        ))}
      </ul>
      <p className="muted small">
        {t(
          '退款从封顶计奖消费的最高已用分段向下扣回；不追溯原单、不释放额度。',
        )}
      </p>
      <p className="muted small">
        {t(
          '分段活动的保存及备份需要支持分段费率的版本读取；建议保留升级前备份。',
        )}
      </p>
    </div>
  );
}

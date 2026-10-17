import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
export default function DataSettings({
  rateInfo,
  disabled,
  rateBusy,
  onApplyRate,
  onFetchRate,
  t,
}) {
  const [draft, setDraft] = useState('');
  useEffect(
    () => setDraft(rateInfo.rate ? String(rateInfo.rate) : ''),
    [rateInfo.rate],
  );
  return (
    <section className="panel data-settings" aria-labelledby="offline-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">OFFLINE BY DEFAULT</p>
          <h2 id="offline-heading">
            <WifiOff size={18} />
            {t('离线与汇率')}
          </h2>
          <p>
            {t(
              '账单、活动和密码仅在本地处理。默认不联网，参考汇率可手动填写。',
            )}
          </p>
        </div>
        <span className="local-chip">
          {t(globalThis.cardpulseDesktop ? '桌面加密文件' : '浏览器加密库')}
        </span>
      </div>
      <form
        className="rate-controls"
        onSubmit={(e) => {
          e.preventDefault();
          onApplyRate(draft);
        }}
      >
        <label className="field">
          <span>{t('参考汇率（1 HKD = CNY）')}</span>
          <input
            aria-label={t('参考汇率（1 HKD = CNY）')}
            type="text"
            inputMode="decimal"
            placeholder="0.9300"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button className="btn btn-secondary" type="submit" disabled={disabled}>
          {t('应用手动汇率')}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={disabled}
          onClick={onFetchRate}
        >
          <RefreshCw size={14} />
          {t(rateBusy ? '正在获取汇率…' : '联网更新参考汇率')}
        </button>
      </form>
      <p className="muted small">
        {rateInfo.rate
          ? `1 HKD ≈ ${rateInfo.rate} CNY · ${rateInfo.date} · ${rateInfo.source === 'manual' ? t('手动设置') : 'Frankfurter'}`
          : t('未设置汇率，港币返现的人民币折算显示为未知。')}
      </p>
      <p className="muted small">
        {t('联网按钮只请求公开汇率，不发送账单。汇率设置随加密库保存。')}
      </p>
    </section>
  );
}

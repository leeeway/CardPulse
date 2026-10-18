import React, { useEffect, useRef, useState } from 'react';
import {
  categoriesFor,
  categoryText,
  REVIEW_CHANNELS,
} from '../core/review.js';
import { channelText } from '../core/i18n.js';

export default function TransactionReviewDialog({
  transaction,
  onSave,
  onClose,
  t,
  locale,
}) {
  const dialogRef = useRef(null);
  const [category, setCategory] = useState(
    transaction.category || categoriesFor(transaction.direction)[0],
  );
  const channels = REVIEW_CHANNELS.filter(
    (key) => key !== 'baseOnly' || transaction.currency === 'HKD',
  );
  const [channel, setChannel] = useState(
    channels.includes(transaction.channel?.key)
      ? transaction.channel.key
      : 'standard',
  );
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const describe = (snapshot) =>
    `${t(categoryText(snapshot.category))} · ${t(snapshot.channel?.uncertain ? '待确认渠道' : channelText(snapshot.channel?.key))}`;
  return (
    <dialog
      ref={dialogRef}
      className="modal-content review-dialog"
      aria-labelledby="review-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ category, channel });
        }}
      >
        <div className="modal-header">
          <h2 id="review-title">{t('核对交易')}</h2>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('关闭')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p className="review-description">
          <strong>{transaction.description}</strong>
          <br />
          {transaction.day} · {transaction.currency}{' '}
          {transaction.direction === 'credit' ? '−' : '+'}
          {transaction.amount}
        </p>
        <p className="muted small">
          {t(
            '仅修改分类与渠道，原始金额、日期和来源保持不变。修改记录随加密库保存。',
          )}
        </p>
        <label className="field">
          <span>{t('分类')}</span>
          <select
            aria-label={t('分类')}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categoriesFor(transaction.direction).map((key) => (
              <option key={key} value={key}>
                {t(categoryText(key))}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('支付渠道')}</span>
          <select
            aria-label={t('支付渠道')}
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            {channels.map((key) => (
              <option key={key} value={key}>
                {t(channelText(key))}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {t('请依据原始结单确认。选择渠道不会自动确认活动登记资格。')}
        </p>
        {transaction.reviewHistory?.length > 0 && (
          <details className="review-history">
            <summary>
              {t('修改记录')} · {transaction.reviewHistory.length}
            </summary>
            <ol>
              {transaction.reviewHistory.map((change, index) => (
                <li key={index}>
                  <time dateTime={change.at}>
                    {new Date(change.at).toLocaleString(locale)}
                  </time>
                  <p>
                    {describe(change.before)} → {describe(change.after)}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('取消')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('应用修正')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

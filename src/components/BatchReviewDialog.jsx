import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  categoriesFor,
  categoryText,
  reviewTransactions,
  REVIEW_CHANNELS,
} from '../core/review.js';
import { previewReviewRewards } from '../core/review-rewards.js';
import { channelText } from '../core/i18n.js';
import { fromScaledBigInt } from '../core/rewards.js';
import { bankOf, getBank } from '../core/banks.js';
import { belongsToStatement } from '../core/imports.js';

export default function BatchReviewDialog({
  workspace,
  selected,
  today,
  onApply,
  onClose,
  bankName,
  t,
}) {
  const dialogRef = useRef(null);
  const [category, setCategory] = useState('');
  const [channel, setChannel] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const sameDirection = selected.every(
    (tx) => tx.direction === selected[0].direction,
  );
  const channels = REVIEW_CHANNELS.filter(
    (key) =>
      key !== 'baseOnly' || selected.every((tx) => tx.currency === 'HKD'),
  );
  const changesById = useMemo(
    () =>
      new Map(preview?.changes.map(({ before, after }) => [before.id, after])),
    [preview],
  );
  const sourceNumbers = useMemo(
    () =>
      new Map(
        selected.map((tx) => [
          tx.id,
          workspace.statements.findIndex(({ id }) =>
            belongsToStatement(tx, id),
          ) + 1,
        ]),
      ),
    [selected, workspace.statements],
  );
  const rewards = useMemo(() => {
    if (!preview?.changes.length) return { rows: [] };
    try {
      return {
        rows: previewReviewRewards(
          preview.base,
          preview.workspace,
          preview.changes,
          today,
        ),
      };
    } catch (failure) {
      return { error: failure.message, rows: [] };
    }
  }, [preview, today]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const describe = (tx) =>
    `${t(categoryText(tx.category))} · ${t(tx.channel?.uncertain ? '待确认渠道' : channelText(tx.channel?.key))}`;
  const updateField = (setter, value) => {
    setter(value);
    setPreview(null);
    setError('');
  };
  const previewChanges = (event) => {
    event.preventDefault();
    try {
      const ids = selected.map((tx) => tx.id);
      const patch = {
        category: category || undefined,
        channel: channel || undefined,
      };
      const result = reviewTransactions(workspace, ids, patch);
      setPreview({ ...result, base: workspace, ids, patch });
      setError('');
    } catch (failure) {
      setPreview(null);
      setError(failure.message);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-content review-dialog batch-review"
      aria-labelledby="batch-review-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={previewChanges}>
        <div className="modal-header">
          <h2 id="batch-review-title">{t('批量核对交易')}</h2>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('关闭')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p>{t('已选 {count} 笔交易', { count: selected.length })}</p>
        <div className="form-grid">
          <label className="field">
            <span>{t('分类')}</span>
            <select
              aria-label={t('分类')}
              value={category}
              disabled={!sameDirection}
              onChange={(event) => updateField(setCategory, event.target.value)}
            >
              <option value="">{t('保留原分类')}</option>
              {sameDirection &&
                categoriesFor(selected[0].direction).map((key) => (
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
              onChange={(event) => updateField(setChannel, event.target.value)}
            >
              <option value="">{t('保留原渠道')}</option>
              {channels.map((key) => (
                <option key={key} value={key}>
                  {t(channelText(key))}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!sameDirection && (
          <p className="muted small">
            {t('选中记录含不同收支方向，可统一修改渠道。')}
          </p>
        )}
        <ol className="batch-review-rows" aria-label={t('所选交易明细')}>
          {selected.map((tx) => {
            const after = changesById.get(tx.id);
            const sourceNumber = sourceNumbers.get(tx.id);
            return (
              <li key={tx.id}>
                <strong>{tx.description}</strong>
                <p className="muted small">
                  {tx.day} · {tx.currency}{' '}
                  {tx.direction === 'credit' ? '−' : '+'}
                  {tx.amount}
                </p>
                <p className="muted small">
                  {bankName(getBank(bankOf(tx)))}
                  {sourceNumber > 0 &&
                    ` · ${t('结单 {number}', { number: sourceNumber })}`}
                </p>
                <p>
                  {describe(tx)}
                  {after
                    ? ` → ${describe(after)}`
                    : preview
                      ? ` · ${t('无需修改')}`
                      : ''}
                </p>
              </li>
            );
          })}
        </ol>
        {(error || rewards.error) && (
          <p className="error" role="alert">
            {t(error || rewards.error)}
          </p>
        )}
        {preview && (
          <section
            className="batch-reward-preview"
            aria-label={t('批量核对预览')}
            aria-live="polite"
          >
            <p>
              {t('将修正 {count} 笔交易', { count: preview.changes.length })}
            </p>
            {preview.changes.length > 0 && (
              <>
                <p className="muted small">
                  {t(
                    '奖赏按 {date} 的记录估算。Pulse 按原币展示，各活动分别核算。',
                    { date: today },
                  )}
                </p>
                {rewards.rows.length > 0 && (
                  <ul>
                    {rewards.rows.map(
                      ({ key, label, currency, previous, next }) => (
                        <li key={key}>
                          <strong>{label}</strong> · {currency}{' '}
                          {fromScaledBigInt(previous)} →{' '}
                          {fromScaledBigInt(next)}
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {!rewards.error && rewards.rows.length === 0 && (
                  <p>{t('预计奖赏不变')}</p>
                )}
              </>
            )}
          </section>
        )}
        <p className="muted small">
          {t('应用后会为每笔修正保存修改记录。请保存到加密库以保留本次修改。')}
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('取消')}
          </button>
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={!category && !channel}
          >
            {t('预览批量修正')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!preview?.changes.length || Boolean(rewards.error)}
            onClick={() => {
              try {
                onApply(preview);
              } catch (failure) {
                setPreview(null);
                setError(failure.message);
              }
            }}
          >
            {t('应用批量修正')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

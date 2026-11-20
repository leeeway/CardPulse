import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bankOf, cardName, getBank } from '../core/banks.js';

const GROUP_PAGE_SIZE = 5;
const RECORD_PAGE_SIZE = 10;

function PreviewPagination({ page, pages, setPage, groups = false, t }) {
  if (pages <= 1) return null;
  return (
    <div className="form-actions">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
      >
        {t(groups ? '上一组页' : '上一页')}
      </button>
      <span aria-live="polite">
        {t('第 {page} / {pages} 页', { page: page + 1, pages })}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page === pages - 1}
        onClick={() => setPage(page + 1)}
      >
        {t(groups ? '下一组页' : '下一页')}
      </button>
    </div>
  );
}

function DuplicateGroup({ group, pendingIds, skipped, onToggle, bankName, t }) {
  const [page, setPage] = useState(0);
  const first = group.entries[0].transaction;
  const start = page * RECORD_PAGE_SIZE;
  return (
    <section className="import-preview-item">
      <h4>{first.description}</h4>
      <p className="muted small">
        {bankName(getBank(bankOf(first)))} ·{' '}
        {first.ruleId ? t(cardName(first.ruleId)) : t('卡片未记录')} ·{' '}
        {first.last4 ? `•••• ${first.last4}` : t('末四位未记录')} · {first.day}{' '}
        · {first.currency} {first.direction === 'credit' ? '−' : '+'}
        {first.amount}
      </p>
      <ol start={start + 1} className="import-preview-details">
        {group.entries
          .slice(start, start + RECORD_PAGE_SIZE)
          .map(({ transaction, statement, statementNumber }) => {
            const pending = pendingIds.has(statement.id);
            const checked = !skipped.has(transaction.id);
            const source = transaction.sources?.[0];
            const details = (
              <span>
                {t(pending ? (checked ? '待导入' : '已跳过') : '已入账')} ·{' '}
                {t('结单 {number}', { number: statementNumber })} ·{' '}
                {statement.fileName || t('未知结单')}
                <span className="import-preview-entry-date muted small">
                  {t('交易日期')}：{transaction.transactionDay || t('未记录')}
                  {source?.row &&
                    ` · ${t('CSV 第 {row} 行', { row: source.row })}`}
                  {source?.page &&
                    ` · ${t('PDF 第 {page} 页', { page: source.page })}`}
                </span>
              </span>
            );
            return (
              <li key={transaction.id}>
                {pending ? (
                  <label className="checkbox-label import-preview-choice">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        onToggle(transaction, event.target.checked)
                      }
                    />
                    <span>
                      {t('保留')} · {details}
                    </span>
                  </label>
                ) : (
                  details
                )}
              </li>
            );
          })}
      </ol>
      <PreviewPagination
        page={page}
        pages={Math.ceil(group.entries.length / RECORD_PAGE_SIZE)}
        setPage={setPage}
        t={t}
      />
    </section>
  );
}

export default function ImportPreviewDialog({
  preview,
  bankName,
  t,
  onClose,
  onConfirm,
}) {
  const ref = useRef(null);
  const [page, setPage] = useState(0);
  const [skipped, setSkipped] = useState(() => new Map());
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const { files, pendingIds, transactionCount, duplicates } = preview;
  const pendingMatches = useMemo(
    () =>
      duplicates.reduce(
        (count, group) =>
          count +
          group.entries.filter(({ statement }) => pendingIds.has(statement.id))
            .length,
        0,
      ),
    [duplicates, pendingIds],
  );
  const pages = Math.ceil(duplicates.length / GROUP_PAGE_SIZE);
  const skippedCounts = new Map();
  for (const statementId of skipped.values())
    skippedCounts.set(statementId, (skippedCounts.get(statementId) || 0) + 1);
  const retainedCount = transactionCount - skipped.size;
  const retainedFiles = files.filter(
    ({ statement }) =>
      statement &&
      statement.transactionCount > (skippedCounts.get(statement.id) || 0),
  ).length;
  const toggleTransaction = ({ id, statementId }, keep) => {
    setSkipped((previous) => {
      const next = new Map(previous);
      if (keep) next.delete(id);
      else next.set(id, statementId);
      return next;
    });
  };
  return (
    <dialog
      ref={ref}
      className="modal-content review-dialog statement-import-preview"
      aria-labelledby="statement-import-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="modal-header">
        <h2 id="statement-import-title">{t('账单导入预览')}</h2>
        <button
          className="btn btn-ghost"
          type="button"
          aria-label={t('关闭')}
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className="import-preview-body">
        <h3>{t('文件来源')}</h3>
        <ul
          className="import-preview-files"
          role="list"
          aria-label={t('文件来源')}
        >
          {files.map(
            ({ fileName, statement, statementNumber, messages }, index) => {
              const skippedCount = skippedCounts.get(statement?.id) || 0;
              const count = (statement?.transactionCount || 0) - skippedCount;
              return (
                <li className="import-preview-item" key={index}>
                  <strong>{fileName}</strong>{' '}
                  <span className="badge-tag">
                    {t(count > 0 ? '待导入' : '已跳过')}
                  </span>
                  {statement && (
                    <>
                      <p className="small">
                        {t('结单 {number}', { number: statementNumber })} ·{' '}
                        {bankName(getBank(statement.bankId))} ·{' '}
                        {t(cardName(statement.ruleId))} ·{' '}
                        {t('{count} 笔交易', { count })}
                        {skippedCount > 0 &&
                          ` · ${t('已跳过 {count} 笔', { count: skippedCount })}`}
                      </p>
                      {statement.warnings?.map((warning, index) => (
                        <p className="muted small" key={index}>
                          {t(warning)}
                        </p>
                      ))}
                    </>
                  )}
                  {messages.map((message, index) => (
                    <p className="muted small" key={index}>
                      {t(message)}
                    </p>
                  ))}
                </li>
              );
            },
          )}
        </ul>
        <h3>{t('疑似重复交易')}</h3>
        {duplicates.length > 0 ? (
          <>
            <p>
              {t('发现 {groups} 组疑似重叠，涉及 {count} 笔候选交易。', {
                groups: duplicates.length,
                count: pendingMatches,
              })}
            </p>
            <p className="muted small">
              {t(
                '请核对原始结单。疑似重复交易默认保留，取消勾选即可跳过该笔。',
              )}
            </p>
            {duplicates
              .slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE)
              .map((group) => (
                <DuplicateGroup
                  key={group.key}
                  group={group}
                  pendingIds={pendingIds}
                  skipped={skipped}
                  onToggle={toggleTransaction}
                  bankName={bankName}
                  t={t}
                />
              ))}
            <PreviewPagination
              page={page}
              pages={pages}
              setPage={setPage}
              groups
              t={t}
            />
          </>
        ) : (
          <p className="muted small">
            {t('未发现符合检查条件的疑似重叠记录。')}
          </p>
        )}
      </div>
      <footer className="form-actions import-preview-footer">
        <p
          className="import-preview-total small"
          aria-live="polite"
          aria-atomic="true"
        >
          {t('待导入 {files} 份文件，共 {count} 笔交易。', {
            files: retainedFiles,
            count: retainedCount,
          })}
        </p>
        <button
          className="btn btn-secondary"
          type="button"
          autoFocus
          onClick={onClose}
        >
          {t('取消')}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={retainedCount === 0}
          onClick={() => onConfirm(new Set(skipped.keys()))}
        >
          {t('确认导入')}
        </button>
      </footer>
    </dialog>
  );
}

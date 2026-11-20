import React, { useEffect, useRef, useState } from 'react';
import { bankOf, cardName, getBank } from '../core/banks.js';

const GROUP_PAGE_SIZE = 5;

function DuplicateGroup({ group, pendingIds, bankName, t }) {
  const first = group.entries[0].transaction;
  const sources = new Map();
  for (const { statement, statementNumber } of group.entries) {
    const source = sources.get(statement.id);
    if (source) source.count++;
    else sources.set(statement.id, { statement, statementNumber, count: 1 });
  }
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
      <ul className="import-preview-details">
        {[...sources.values()].map(({ statement, statementNumber, count }) => (
          <li key={statement.id}>
            {t(pendingIds.has(statement.id) ? '待导入' : '已入账')} ·{' '}
            {t('结单 {number}', { number: statementNumber })} ·{' '}
            {statement.fileName || t('未知结单')} ·{' '}
            {t('{count} 笔交易', { count })}
          </li>
        ))}
      </ul>
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
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const { files, pendingIds, transactionCount, duplicates } = preview;
  const pendingMatches = duplicates.reduce(
    (count, group) =>
      count +
      group.entries.filter(({ statement }) => pendingIds.has(statement.id))
        .length,
    0,
  );
  const pages = Math.ceil(duplicates.length / GROUP_PAGE_SIZE);
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
        <p>
          {t('待导入 {files} 份文件，共 {count} 笔交易。', {
            files: pendingIds.size,
            count: transactionCount,
          })}
        </p>
        <h3>{t('文件来源')}</h3>
        <ul className="import-preview-files" aria-label={t('文件来源')}>
          {files.map(
            ({ fileName, statement, statementNumber, messages }, index) => (
              <li className="import-preview-item" key={index}>
                <strong>{fileName}</strong>{' '}
                <span className="badge-tag">
                  {t(statement ? '待导入' : '已跳过')}
                </span>
                {statement && (
                  <>
                    <p className="small">
                      {t('结单 {number}', { number: statementNumber })} ·{' '}
                      {bankName(getBank(statement.bankId))} ·{' '}
                      {t(cardName(statement.ruleId))} ·{' '}
                      {t('{count} 笔交易', {
                        count: statement.transactionCount,
                      })}
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
            ),
          )}
        </ul>
        <h3>{t('疑似重复交易')}</h3>
        {duplicates.length > 0 ? (
          <>
            <p>
              {t('发现 {groups} 组疑似重叠，涉及 {count} 笔待导入交易。', {
                groups: duplicates.length,
                count: pendingMatches,
              })}
            </p>
            <p className="muted small">
              {t(
                '请核对原始结单。确认导入会加入所有待导入交易，包括疑似重复记录。',
              )}
            </p>
            {duplicates
              .slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE)
              .map((group) => (
                <DuplicateGroup
                  key={group.key}
                  group={group}
                  pendingIds={pendingIds}
                  bankName={bankName}
                  t={t}
                />
              ))}
            {pages > 1 && (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  {t('上一页')}
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
                  {t('下一页')}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted small">
            {t('未发现符合检查条件的疑似重叠记录。')}
          </p>
        )}
      </div>
      <footer className="form-actions">
        <button
          className="btn btn-secondary"
          type="button"
          autoFocus
          onClick={onClose}
        >
          {t('取消')}
        </button>
        <button className="btn btn-primary" type="button" onClick={onConfirm}>
          {t('确认导入')}
        </button>
      </footer>
    </dialog>
  );
}

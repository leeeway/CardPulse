import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bankOf, cardName, getBank } from '../core/banks.js';
import { channelText } from '../core/i18n.js';
import { categoryText } from '../core/review.js';
import { filterTransactions } from '../core/transactions.js';

const GROUP_PAGE_SIZE = 5;
const RECORD_PAGE_SIZE = 10;

function sourceLocation(transaction, t) {
  const source = transaction.sources?.[0];
  if (source?.row) return t('CSV 第 {row} 行', { row: source.row });
  if (source?.page) return t('PDF 第 {page} 页', { page: source.page });
  return '';
}

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

function DuplicateGroup({
  group,
  pendingTransactionIds,
  skipped,
  onToggle,
  bankName,
  pendingLabel,
  skippedLabel,
  t,
}) {
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
            const pending = pendingTransactionIds.has(transaction.id);
            const checked = !skipped.has(transaction.id);
            const location = sourceLocation(transaction, t);
            const details = (
              <span>
                {t(
                  pending ? (checked ? pendingLabel : skippedLabel) : '已入账',
                )}{' '}
                · {t('结单 {number}', { number: statementNumber })} ·{' '}
                {statement.fileName || t('未知结单')}
                <span className="import-preview-entry-date muted small">
                  {t('交易日期')}：{transaction.transactionDay || t('未记录')}
                  {location && ` · ${location}`}
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

function TransactionDetails({
  transactions,
  files,
  duplicateIds,
  skipped,
  onToggle,
  skippedLabel,
  hidden,
  t,
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statementId, setStatementId] = useState('');
  const statements = useMemo(
    () =>
      new Map(
        files
          .filter(({ statement }) => statement)
          .map((file) => [file.statement.id, file]),
      ),
    [files],
  );
  const matches = useMemo(
    () => filterTransactions(transactions, { search, statementId }),
    [transactions, search, statementId],
  );
  return (
    <section
      id="import-transaction-details"
      hidden={hidden}
      aria-label={t('交易明细')}
    >
      <div className="filter-bar import-preview-filters">
        <label className="field">
          <span>{t('结单来源')}</span>
          <select
            value={statementId}
            onChange={(event) => {
              setStatementId(event.target.value);
              setPage(0);
            }}
          >
            <option value="">{t('全部待导入文件')}</option>
            {[...statements].map(([id, { statementNumber, fileName }]) => (
              <option value={id} key={id}>
                {t('结单 {number}', { number: statementNumber })} · {fileName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('搜索交易')}</span>
          <input
            type="search"
            placeholder={t('商户、金额、末四位或备注')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <p className="small muted" aria-live="polite">
        {matches.length
          ? t('符合筛选的 {count} 笔交易', { count: matches.length })
          : t('未找到匹配的交易记录')}
      </p>
      {matches.length > 0 && (
        <ul className="import-preview-files" role="list">
          {matches
            .slice(page * RECORD_PAGE_SIZE, (page + 1) * RECORD_PAGE_SIZE)
            .map((tx) => {
              const { fileName, statementNumber } = statements.get(
                tx.statementId,
              );
              const location = sourceLocation(tx, t);
              const keep = !skipped.has(tx.id);
              return (
                <li
                  key={tx.id}
                  className="import-preview-item import-detail-record"
                >
                  <div>
                    <label className="checkbox-label import-preview-choice">
                      <input
                        type="checkbox"
                        checked={keep}
                        onChange={(event) => onToggle(tx, event.target.checked)}
                      />
                      <span>
                        {t('保留')} · <strong>{tx.description}</strong>
                        <span className="import-preview-entry-date muted small">
                          {t('结单 {number}', { number: statementNumber })} ·{' '}
                          {fileName}
                          {location && ` · ${location}`}
                        </span>
                      </span>
                    </label>
                    <p className="small">
                      {t('记账日期')} {tx.day} · {t('交易日期')}{' '}
                      {tx.transactionDay || t('未记录')}
                      {tx.last4 && ` · •••• ${tx.last4}`}
                    </p>
                    <p className="muted small">
                      {t(categoryText(tx.category))} ·{' '}
                      {t(
                        tx.channel?.uncertain
                          ? '待确认渠道'
                          : channelText(tx.channel?.key),
                      )}
                      {tx.notes?.length > 0 && ` · ${tx.notes.join(' · ')}`}
                    </p>
                  </div>
                  <div className="import-detail-values">
                    <p
                      className={`amount ${tx.direction === 'credit' ? 'text-credit' : ''}`}
                    >
                      {tx.currency} {tx.direction === 'credit' ? '−' : '+'}
                      {tx.amount}
                    </p>
                    {duplicateIds.has(tx.id) && (
                      <span className="badge-tag">{t('疑似重复交易')}</span>
                    )}
                    {!keep && (
                      <span className="badge-tag">{t(skippedLabel)}</span>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
      <PreviewPagination
        page={page}
        pages={Math.ceil(matches.length / RECORD_PAGE_SIZE)}
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
  const {
    files,
    pendingTransactionIds,
    transactions,
    duplicates,
    supplementId,
  } = preview;
  const pendingLabel = supplementId ? '待补录' : '待导入';
  const skippedLabel = supplementId ? '未勾选' : '已跳过';
  const [skipped, setSkipped] = useState(
    () =>
      new Map(
        supplementId
          ? transactions.map(({ id, statementId }) => [id, statementId])
          : [],
      ),
  );
  const [view, setView] = useState(
    !supplementId && duplicates.length ? 'duplicates' : 'details',
  );
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const duplicateIds = useMemo(() => {
    const ids = new Set();
    for (const { entries } of duplicates) {
      for (const { transaction } of entries) {
        if (pendingTransactionIds.has(transaction.id)) ids.add(transaction.id);
      }
    }
    return ids;
  }, [duplicates, pendingTransactionIds]);
  const pages = Math.ceil(duplicates.length / GROUP_PAGE_SIZE);
  const skippedCounts = new Map();
  for (const statementId of skipped.values())
    skippedCounts.set(statementId, (skippedCounts.get(statementId) || 0) + 1);
  const retainedCount = transactions.length - skipped.size;
  const retainedFiles = files.filter(
    ({ statement, pendingCount }) =>
      statement && pendingCount > (skippedCounts.get(statement.id) || 0),
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
        <h2 id="statement-import-title">
          {t(supplementId ? '补录交易预览' : '账单导入预览')}
        </h2>
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
            (
              {
                fileName,
                statement,
                statementNumber,
                pendingCount = 0,
                messages,
              },
              index,
            ) => {
              const skippedCount = skippedCounts.get(statement?.id) || 0;
              const count = pendingCount - skippedCount;
              return (
                <li className="import-preview-item" key={index}>
                  <strong>{fileName}</strong>{' '}
                  <span className="badge-tag">
                    {t(count > 0 ? pendingLabel : skippedLabel)}
                  </span>
                  {statement && (
                    <>
                      <p className="small">
                        {t('结单 {number}', { number: statementNumber })} ·{' '}
                        {bankName(getBank(statement.bankId))} ·{' '}
                        {t(cardName(statement.ruleId))} ·{' '}
                        {t('{count} 笔交易', { count })}
                        {skippedCount > 0 &&
                          ` · ${t(supplementId ? '未勾选 {count} 笔' : '已跳过 {count} 笔', { count: skippedCount })}`}
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
        {supplementId && (
          <p className="muted small">
            {t('以下是原结单中尚未入账的交易。请勾选需要补录的记录。')}
          </p>
        )}
        <div
          className="import-preview-views"
          role="group"
          aria-label={t('预览方式')}
        >
          <button
            type="button"
            className={`btn ${view === 'details' ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={view === 'details'}
            aria-controls="import-transaction-details"
            onClick={() => setView('details')}
          >
            {t('交易明细')}
          </button>
          <button
            type="button"
            className={`btn ${view === 'duplicates' ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={view === 'duplicates'}
            aria-controls="import-duplicates"
            onClick={() => setView('duplicates')}
          >
            {t('疑似重复交易')}
          </button>
        </div>
        {duplicates.length === 0 && (
          <p className="muted small">
            {t('未发现符合检查条件的疑似重叠记录。')}
          </p>
        )}
        <TransactionDetails
          transactions={transactions}
          files={files}
          duplicateIds={duplicateIds}
          skipped={skipped}
          onToggle={toggleTransaction}
          skippedLabel={skippedLabel}
          hidden={view !== 'details'}
          t={t}
        />
        <section
          id="import-duplicates"
          hidden={view !== 'duplicates'}
          aria-label={t('疑似重复交易')}
        >
          {duplicates.length > 0 ? (
            <>
              <p>
                {t('发现 {groups} 组疑似重叠，涉及 {count} 笔候选交易。', {
                  groups: duplicates.length,
                  count: duplicateIds.size,
                })}
              </p>
              <p className="muted small">
                {t(
                  supplementId
                    ? '请对照已入账记录，再勾选需要补录的交易。'
                    : '请核对原始结单。疑似重复交易默认保留，取消勾选即可跳过该笔。',
                )}
              </p>
              {duplicates
                .slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE)
                .map((group) => (
                  <DuplicateGroup
                    key={group.key}
                    group={group}
                    pendingTransactionIds={pendingTransactionIds}
                    skipped={skipped}
                    onToggle={toggleTransaction}
                    bankName={bankName}
                    pendingLabel={pendingLabel}
                    skippedLabel={skippedLabel}
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
          ) : null}
        </section>
      </div>
      <footer className="form-actions import-preview-footer">
        <p
          className="import-preview-total small"
          aria-live="polite"
          aria-atomic="true"
        >
          {t(
            supplementId
              ? '待补录 {count} 笔交易。'
              : '待导入 {files} 份文件，共 {count} 笔交易。',
            {
              files: retainedFiles,
              count: retainedCount,
            },
          )}
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
          {t(supplementId ? '确认补录' : '确认导入')}
        </button>
      </footer>
    </dialog>
  );
}

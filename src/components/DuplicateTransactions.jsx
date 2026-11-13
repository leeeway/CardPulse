import React, { useMemo, useState } from 'react';
import { findPotentialDuplicates } from '../core/duplicate-transactions.js';
import { BANKS, bankOf, cardName } from '../core/banks.js';

const GROUP_PAGE_SIZE = 5;
const RECORD_PAGE_SIZE = 10;
function DuplicateGroup({ group, disabled, onReview, bankName, t }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(group.entries.length / RECORD_PAGE_SIZE);
  const currentPage = Math.min(page, pages - 1);
  const first = group.entries[0].transaction;
  return (
    <section className="duplicate-group">
      <h3>{first.description}</h3>
      <p className="muted small">
        {bankName(BANKS.find((bank) => bank.id === bankOf(first)))} ·{' '}
        {first.ruleId ? t(cardName(first.ruleId)) : t('卡片未记录')} ·{' '}
        {first.last4 ? `•••• ${first.last4}` : t('末四位未记录')} · {first.day}{' '}
        · {first.currency} {first.direction === 'credit' ? '−' : '+'}
        {first.amount}
      </p>
      {!first.last4 && (
        <p className="muted small">
          {t('末四位缺省的记录仍可提示，但无法确认是否同一张实体卡。')}
        </p>
      )}
      <p>{t('本组涉及 {count} 笔记录', { count: group.entries.length })}</p>
      <ol start={currentPage * RECORD_PAGE_SIZE + 1}>
        {group.entries
          .slice(
            currentPage * RECORD_PAGE_SIZE,
            (currentPage + 1) * RECORD_PAGE_SIZE,
          )
          .map(({ transaction, statement }) => (
            <li key={transaction.id}>
              <div>
                <strong>{statement.fileName || t('未知结单')}</strong>
                <p className="muted small">
                  {transaction.description} · {t('交易日期')}：
                  {transaction.transactionDay || t('未记录')}
                </p>
                {transaction.channel?.key === 'exclude' && (
                  <span className="badge-tag">{t('已设为不计奖赏')}</span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={disabled}
                onClick={() => onReview(transaction.id)}
              >
                {t('核对交易')}
              </button>
            </li>
          ))}
      </ol>
      {pages > 1 && (
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('上一页')}
          </button>
          <span>
            {t('第 {page} / {pages} 页', { page: currentPage + 1, pages })}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('下一页')}
          </button>
        </div>
      )}
    </section>
  );
}

export default function DuplicateTransactions({
  transactions,
  statements,
  disabled,
  onReview,
  bankName,
  t,
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const { groups, checkedCount, skippedCount } = useMemo(
    () => findPotentialDuplicates(transactions, statements),
    [transactions, statements],
  );
  const count = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const pages = Math.max(1, Math.ceil(groups.length / GROUP_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  return (
    <details
      className="duplicate-transactions panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {t('跨结单重复交易检查')} · {t('{count} 组', { count: groups.length })}
      </summary>
      {open && (
        <>
          <p className="notice-inline">
            {t(
              '仅提示可能重叠，不自动删除或扣减。相同记录也可能是独立消费，请先核对原结单；涉及笔数不等于多余交易数。',
            )}
          </p>
          <p className="muted small">
            {t(
              '按当前银行范围检查，不受交易搜索或日期筛选影响。同银行、卡片、末四位、记账日期、币种、方向、金额及商户描述匹配，且来自不同结单时才提示。描述仅统一大小写和空白。',
            )}
          </p>
          <p className="muted small">
            {t('可检查 {checked} 笔，来源或关键字段不足 {skipped} 笔。', {
              checked: checkedCount,
              skipped: skippedCount,
            })}
          </p>
          <p aria-live="polite">
            {t('发现 {groups} 组可能重叠，涉及 {count} 笔记录。', {
              groups: groups.length,
              count,
            })}
          </p>
          {groups.length === 0 && (
            <p className="muted small">
              {t('未发现符合检查条件的疑似重叠记录。')}
            </p>
          )}
          {groups
            .slice(
              currentPage * GROUP_PAGE_SIZE,
              (currentPage + 1) * GROUP_PAGE_SIZE,
            )
            .map((group) => (
              <DuplicateGroup
                key={group.key}
                group={group}
                disabled={disabled}
                onReview={onReview}
                bankName={bankName}
                t={t}
              />
            ))}
          <p className="muted small">
            {t(
              '不计奖赏只影响奖赏计算，不删除交易。若确认整份结单重复，可在“结单与对账”中删除该结单；修改仍需保存到加密库。',
            )}
          </p>
          {pages > 1 && (
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t('上一组页')}
              </button>
              <span>
                {t('第 {page} / {pages} 页', { page: currentPage + 1, pages })}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={currentPage === pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {t('下一组页')}
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}

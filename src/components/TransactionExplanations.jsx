import React, { useMemo, useState } from 'react';
const PAGE_SIZE = 25;
export default function TransactionExplanations({
  getEntries,
  matchedCount,
  reasonLabels,
  t,
  title = '逐笔计算说明',
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const entries = useMemo(() => (open ? getEntries() : []), [open, getEntries]);
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          status === 'all' || entry.included === (status === 'included'),
      ),
    [entries, status],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const excludedCounts = useMemo(() => {
    const counts = new Map();
    for (const entry of entries)
      if (!entry.included)
        counts.set(entry.reason, (counts.get(entry.reason) || 0) + 1);
    return [...counts];
  }, [entries]);
  return (
    <details
      className="transaction-explanations"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t(title)}</summary>
      {open && (
        <>
          <p className="muted small">
            {t('计入 {included} 笔，排除 {excluded} 笔。', {
              included: matchedCount,
              excluded: entries.length - matchedCount,
            })}
          </p>
          <p className="muted small">
            {t(
              '排除记录显示首个不满足的条件。奖赏按周期汇总，未向单笔交易分配封顶额度。',
            )}
          </p>
          {excludedCounts.length > 0 && (
            <ul className="exclusion-summary">
              {excludedCounts.map(([reason, count]) => (
                <li key={reason}>
                  {t(reasonLabels[reason])} · {count}
                </li>
              ))}
            </ul>
          )}
          <label className="field">
            <span>{t('说明记录范围')}</span>
            <select
              aria-label={t('说明记录范围')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">{t('全部记录')}</option>
              <option value="included">{t('仅计入记录')}</option>
              <option value="excluded">{t('仅排除记录')}</option>
            </select>
          </label>
          {filtered.length ? (
            <div className="explanation-table">
              <table>
                <thead>
                  <tr>
                    {[
                      '计算日期',
                      '商户与描述',
                      '金额',
                      '计算周期',
                      '计入或排除原因',
                    ].map((label) => (
                      <th key={label}>{t(label)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .slice(
                      currentPage * PAGE_SIZE,
                      (currentPage + 1) * PAGE_SIZE,
                    )
                    .map((entry) => (
                      <tr key={entry.transaction.id}>
                        <td>{entry.day || '—'}</td>
                        <td>{entry.transaction.description}</td>
                        <td>
                          {entry.transaction.currency}{' '}
                          {entry.transaction.direction === 'credit' ? '−' : '+'}
                          {entry.transaction.amount}
                        </td>
                        <td>
                          {entry.period === 'campaign'
                            ? t('整个活动')
                            : entry.period || '—'}
                        </td>
                        <td>
                          {t(reasonLabels[entry.reason])}
                          {entry.included &&
                            (entry.uncertain ??
                              entry.transaction.channel?.uncertain) && (
                              <small>
                                {t('渠道待人工确认，当前按识别结果估算。')}
                              </small>
                            )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">{t('此范围没有记录')}</p>
          )}
          <div className="explanation-pagination">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t('上一页')}
            </button>
            <span>
              {t('第 {page} / {pages} 页', {
                page: currentPage + 1,
                pages: pageCount,
              })}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              {t('下一页')}
            </button>
          </div>
        </>
      )}
    </details>
  );
}

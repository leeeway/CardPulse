import { escapeCsvCell } from './safe-csv.js';
import { bankOf } from './banks.js';
import { channelText } from './i18n.js';
import { belongsToStatement } from './imports.js';
import { fromScaledBigInt } from './rewards.js';
import { categoryForTransaction } from './review.js';

/**
 * 交易列表过滤、统计与安全 CSV 导出工具
 */

export function filterTransactions(transactions, filters) {
  const {
    search = '',
    direction = 'all',
    currency = 'all',
    from = '',
    to = '',
    category = 'all',
    statementId = '',
  } = filters;
  const query = search.trim().toLowerCase();

  return transactions.filter((tx) => {
    if (statementId && !belongsToStatement(tx, statementId)) return false;
    if (currency !== 'all' && tx.currency !== currency) return false;
    if (direction !== 'all' && tx.direction !== direction) return false;
    if (category !== 'all' && categoryForTransaction(tx) !== category)
      return false;
    if (from && tx.day < from) return false;
    if (to && tx.day > to) return false;
    if (query) {
      const matchDesc = tx.description?.toLowerCase().includes(query);
      const matchNote = tx.notes?.some((n) => n.toLowerCase().includes(query));
      const matchAmount = tx.amount?.includes(query);
      const matchCard = tx.last4?.includes(query);
      if (!matchDesc && !matchNote && !matchAmount && !matchCard) return false;
    }
    return true;
  });
}

/**
 * 安全导出 CSV，对 = + - @ 符号进行转义防止 Excel 公式执行漏洞 (Formula Injection)
 */
export function exportToSafeCsv(
  transactions,
  translate = (text) => text,
  { pulseAllocations } = {},
) {
  const headers = [
    '交易日期',
    '记账日期',
    '卡号末四位',
    '银行',
    '卡片',
    '币种',
    '收支方向',
    '金额',
    '分类',
    '商户与描述',
    '支付渠道',
    '渠道与备注',
    '结单文件名',
  ];
  if (pulseAllocations)
    headers.push(
      '适用返现比例',
      '封顶前返现估算',
      '封顶后返现估算',
      '退款扣回估算',
    );

  const escapeCell = escapeCsvCell;

  const rows = transactions.map((tx) => [
    escapeCell(tx.transactionDay || tx.day),
    escapeCell(tx.day),
    escapeCell(tx.last4 || ''),
    escapeCell(bankOf(tx)),
    escapeCell(tx.ruleId || 'hsbc_pulse'),
    escapeCell(tx.currency),
    escapeCell(translate(tx.direction === 'credit' ? '入账/还款' : '支出')),
    escapeCell(tx.amount),
    escapeCell(categoryForTransaction(tx)),
    escapeCell(tx.description),
    escapeCell(
      translate(
        tx.channel?.uncertain ? '待确认渠道' : channelText(tx.channel?.key),
      ),
    ),
    escapeCell(tx.notes?.join('; ') || ''),
    escapeCell(tx.sources?.map((s) => s.fileName).join(';') || ''),
    ...(pulseAllocations ? pulseCsvCells(tx, pulseAllocations.get(tx.id)) : []),
  ]);

  const csvContent =
    '\uFEFF' +
    [
      headers.map((header) => escapeCell(translate(header))).join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\r\n');
  return csvContent;
}

// Generated fixed-point amounts can retain their minus sign as a numeric CSV value.
function pulseCsvCells(transaction, allocation) {
  if (!allocation) return ['""', '""', '""', '""'];
  const refund = transaction.direction === 'credit';
  return [
    escapeCsvCell(`${allocation.ratePercent.toFixed(1)}%`),
    `"${fromScaledBigInt(allocation.beforeCapCashback)}"`,
    refund ? '""' : `"${fromScaledBigInt(allocation.cashback)}"`,
    refund ? `"${fromScaledBigInt(-allocation.clawback)}"` : '""',
  ];
}

/**
 * 交易列表过滤、统计与安全 CSV 导出工具
 */

export function filterTransactions(transactions, filters) {
  const { search = '', direction = 'all', currency = 'all', from = '', to = '', category = 'all' } = filters;
  const query = search.trim().toLowerCase();

  return transactions.filter(tx => {
    if (currency !== 'all' && tx.currency !== currency) return false;
    if (direction !== 'all' && tx.direction !== direction) return false;
    if (category !== 'all' && tx.category !== category) return false;
    if (from && tx.day < from) return false;
    if (to && tx.day > to) return false;
    if (query) {
      const matchDesc = tx.description?.toLowerCase().includes(query);
      const matchNote = tx.notes?.some(n => n.toLowerCase().includes(query));
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
export function exportToSafeCsv(transactions) {
  const headers = [
    '交易日期',
    '记账日期',
    '卡号末四位',
    '币种',
    '收支方向',
    '金额',
    '分类',
    '商户与描述',
    '渠道与备注',
    '结单文件名'
  ];

  const escapeCell = value => {
    if (value === null || value === undefined) return '""';
    let str = String(value).trim();
    // 防范 CSV Formula Injection
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replaceAll('"', '""')}"`;
  };

  const rows = transactions.map(tx => [
    escapeCell(tx.transactionDay || tx.day),
    escapeCell(tx.day),
    escapeCell(tx.last4 || ''),
    escapeCell(tx.currency),
    escapeCell(tx.direction === 'credit' ? '入账/还款' : '支出'),
    escapeCell(tx.amount),
    escapeCell(tx.category || 'spend'),
    escapeCell(tx.description),
    escapeCell(tx.notes?.join('; ') || ''),
    escapeCell(tx.sources?.map(s => s.fileName).join(';') || '')
  ]);

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows.map(r => r.join(','))].join('\r\n');
  return csvContent;
}

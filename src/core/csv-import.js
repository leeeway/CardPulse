import { cents, formatCents } from './reconciliation.js';
import { isIsoDate } from './campaigns.js';
import { cardsFor, getBank } from './banks.js';

export const CSV_TEMPLATE =
  'day,transactionDay,description,amount,currency,direction,category,last4,channel\r\n2026-10-01,2026-10-01,EXAMPLE SHOP,100.00,HKD,debit,spend,1234,online\r\n';
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
const channels = [
  'standard',
  'applePay',
  'unionpayQr',
  'online',
  'supermarket',
  'other',
  'baseOnly',
  'exclude',
];
function readRows(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some((cell) => cell.trim())) rows.push(row);
    if (rows.length > 10001) throw new Error('CSV 最多支持 10,000 行');
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else cell += ch;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === ',') pushCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      if (closed || ch === '"') throw new Error('CSV 引号格式无效');
      cell += ch;
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (cell || row.length || closed) pushRow();
  return rows;
}
export function parseStandardCsv(text, fileName, { bankId, cardId } = {}) {
  if (!getBank(bankId) || !cardsFor(bankId).includes(cardId))
    throw new Error('请选择银行及卡片');
  const rows = readRows(text.replace(/^\uFEFF/, ''));
  const headers = (rows.shift() || []).map((s) => s.trim());
  if (
    new Set(headers).size !== headers.length ||
    !['day', 'description', 'amount', 'currency', 'direction'].every((h) =>
      headers.includes(h),
    )
  )
    throw new Error('CSV 缺少必需列或包含重复列，请使用模板');
  const transactions = rows.map((row, index) => {
    try {
      if (row.length !== headers.length) throw new Error('列数不一致');
      const tx = Object.fromEntries(headers.map((h, i) => [h, row[i].trim()]));
      if (
        !isIsoDate(tx.day) ||
        (tx.transactionDay && !isIsoDate(tx.transactionDay))
      )
        throw new Error('日期须为有效的 YYYY-MM-DD');
      if (!tx.description || tx.description.length > 500)
        throw new Error('请检查商户描述');
      if (
        !/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(tx.amount) ||
        cents(tx.amount) <= 0n
      )
        throw new Error('金额须为大于 0 的数值，最多两位小数');
      if (
        !['CNY', 'HKD'].includes(tx.currency) ||
        !['debit', 'credit'].includes(tx.direction)
      )
        throw new Error('币种或收支方向无效');
      const category =
        tx.category || (tx.direction === 'credit' ? 'credit' : 'spend');
      if (!['spend', 'credit', 'repayment', 'fee'].includes(category))
        throw new Error('交易分类无效');
      if (
        (category === 'repayment' || category === 'credit') &&
        tx.direction !== 'credit'
      )
        throw new Error('还款和退款须为 credit');
      if (
        (category === 'spend' || category === 'fee') &&
        tx.direction !== 'debit'
      )
        throw new Error('消费和费用须为 debit');
      if (tx.last4 && !/^\d{4}$/.test(tx.last4))
        throw new Error('卡号末四位须为 4 位数字');
      if (tx.channel && !channels.includes(tx.channel))
        throw new Error('支付渠道无效');
      return {
        id: `${fileName}:${index}`,
        day: tx.day,
        transactionDay: tx.transactionDay || '',
        description: tx.description,
        amount: formatCents(cents(tx.amount)),
        currency: tx.currency,
        direction: tx.direction,
        category,
        bankId,
        ruleId: cardId,
        last4: tx.last4 || '',
        channel: {
          key: tx.channel || 'standard',
          uncertain: !tx.channel,
          pulse: ['applePay', 'unionpayQr'].includes(tx.channel),
        },
        notes: [],
        sources: [{ fileName, row: index + 2 }],
      };
    } catch (error) {
      throw new Error(`CSV 第 ${index + 2} 行：${error.message}`);
    }
  });
  if (!transactions.length) throw new Error('CSV 没有交易记录');
  return {
    fileName,
    bankId,
    ruleId: cardId,
    transactions,
    currencies: [...new Set(transactions.map((t) => t.currency))],
    warnings: ['CSV 为手动整理的数据，请核对原始结单；未验证结欠'],
    reconciliation: [...new Set(transactions.map((t) => t.currency))].map(
      (currency) => ({ currency, status: 'unverified', difference: null }),
    ),
  };
}

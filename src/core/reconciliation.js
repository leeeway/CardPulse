/**
 * 会计级精度核算与对账模块
 * 采用 BigInt 分或十万分之一元为基本单位，彻底杜绝 IEEE 754 浮点误差
 */

const MONEY_REGEX = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(CR|DR)?$/i;

/**
 * 将金额字符串转为以分为单位的 BigInt
 * @param {string} amount 例如 "123.45"
 * @returns {bigint} 12345n
 */
export function cents(amount) {
  return decimalUnits(amount, 2);
}

// Reject malformed amounts instead of silently truncating financial data.
export function decimalUnits(amount, precision) {
  const match = String(amount).trim().match(/^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length || 0) > precision) throw new Error('金额格式无效');
  const units = BigInt(match[2].replaceAll(',', '')) * 10n ** BigInt(precision)
    + BigInt((match[3] || '').padEnd(precision, '0'));
  return match[1] ? -units : units;
}

/**
 * 将 BigInt 分转回带两位小数的金额字符串
 * @param {bigint} value 
 * @returns {string} 例如 "123.45" 或 "-50.00"
 */
export function formatCents(value) {
  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const whole = abs / 100n;
  const fraction = String(abs % 100n).padStart(2, '0');
  return `${isNegative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * 解析结单中的金额文本
 * @param {string} text 
 * @returns {{ amount: string, direction: 'credit' | 'debit' } | null}
 */
export function parseMoney(text) {
  if (!text) return null;
  const match = String(text).trim().match(MONEY_REGEX);
  if (!match) return null;
  const isCredit = Boolean(match[1] || match[4]?.toUpperCase() === 'CR');
  const cleanAmount = `${match[2].replaceAll(',', '')}.${match[3]}`;
  return {
    amount: cleanAmount,
    direction: isCredit ? 'credit' : 'debit'
  };
}

/**
 * 对账单闭环校验：
 * 上期结欠 + 支出（debit） - 入账/还款（credit） == 本期结欠
 * @param {string|null} opening 上期结欠
 * @param {string|null} closing 本期结欠
 * @param {Array<{ amount: string, direction: string }>} transactions 交易明细
 * @returns {{ status: 'matched' | 'mismatch' | 'unverified', difference: string | null }}
 */
export function verifyBalance(opening, closing, transactions) {
  if (opening === null || closing === null || opening === undefined || closing === undefined) {
    return { status: 'unverified', difference: null };
  }

  const toSignedCents = val => {
    const s = String(val).trim();
    return s.startsWith('-') ? -cents(s.slice(1)) : cents(s);
  };

  const openingCents = toSignedCents(opening);
  const closingCents = toSignedCents(closing);

  // 计算本期所有交易净变动
  const netCents = transactions.reduce((sum, tx) => {
    const txCents = cents(tx.amount);
    return sum + (tx.direction === 'debit' ? txCents : -txCents);
  }, 0n);

  const calculatedClosing = openingCents + netCents;
  const diff = calculatedClosing - closingCents;

  if (diff === 0n) {
    return { status: 'matched', difference: '0.00' };
  }

  return {
    status: 'mismatch',
    difference: formatCents(diff)
  };
}

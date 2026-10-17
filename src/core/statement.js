import { parseMoney, verifyBalance } from './reconciliation.js';
import { matchCardRule, CARD_RULES } from './rules/registry.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_PATTERN = MONTHS.join('|');
const FULL_DATE = new RegExp(`\\b(\\d{1,2})\\s*(${MONTH_PATTERN})\\s*(20\\d{2})\\b`, 'i');
const SHORT_DATE = new RegExp(`^(\\d{1,2})\\s*(${MONTH_PATTERN})$`, 'i');

export function groupTextLines(items) {
  const lines = [];
  const sorted = items
    .filter(item => item.text?.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    let line = lines.at(-1);
    if (!line || Math.abs(item.y - line.y) > 2.5) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines.map(line => {
    const sortedItems = line.items.sort((a, b) => a.x - b.x);
    return {
      ...line,
      items: sortedItems,
      text: sortedItems.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim()
    };
  });
}

function inferDate(text, statementDate) {
  const match = text.trim().match(SHORT_DATE);
  if (!match || !statementDate) return null;
  const month = MONTHS.indexOf(match[2].toUpperCase());
  let year = Number(statementDate.slice(0, 4));
  if (month + 1 > Number(statementDate.slice(5, 7))) year--;
  const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  const date = new Date(`${dayStr}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dayStr ? dayStr : null;
}

export function extractStatementData(pages, fileName, { cardId } = {}) {
  const transactions = [];
  const warnings = [];
  let statementDate = '';
  const currencies = new Set();
  const pageLines = pages.map(page => groupTextLines(page.items));
  const allText = pageLines.flatMap(lines => lines.map(line => line.text)).join('\n');
  // Bank identity must come from the statement heading, never merchant descriptions.
  const identityText = pageLines.flatMap(lines => {
    const header = lines.find(line => /post\s*date/i.test(line.text) && /trans\s*date/i.test(line.text));
    return header ? lines.filter(line => line.y < header.y).map(line => line.text) : [];
  }).join('\n');
  const headingRule = matchCardRule(identityText);
  const fileRule = matchCardRule(fileName);
  const detected = headingRule.bankId === 'other' || (headingRule.id.endsWith('_custom') && headingRule.bankId === fileRule.bankId)
    ? fileRule : headingRule;
  if (!['hsbc', 'other'].includes(detected.bankId)) throw new Error('此银行的 PDF 版式尚未适配，请使用标准 CSV 导入');
  const selected = CARD_RULES[cardId];
  if (selected && detected.bankId === 'hsbc' && !detected.id.endsWith('_custom') && selected.id !== detected.id) throw new Error('检测到的卡片与导入选择不同，请检查卡片类型');
  const rule = detected.id.endsWith('_custom') && selected?.bankId === 'hsbc' ? selected : detected;
  const balances = {};
  const fullDate = allText.match(new RegExp(`(?:STATEMENT DATE|结单日期|結單日期)\\s*:?\\s*(\\d{1,2})\\s*(${MONTH_PATTERN})\\s*(20\\d{2})`, 'i')) || allText.match(FULL_DATE);
  if (fullDate) statementDate = `${fullDate[3]}-${String(MONTHS.indexOf(fullDate[2].toUpperCase()) + 1).padStart(2, '0')}-${String(fullDate[1]).padStart(2, '0')}`;
  let last4 = '';

  for (const page of pages) {
    const lines = groupTextLines(page.items);
    const header = lines.find(l => /post\s*date/i.test(l.text) && /trans\s*date/i.test(l.text));
    if (!header) continue;

    const headingText = lines.filter(l => l.y < header.y).map(l => l.text).join(' ');
    last4 = headingText.match(/(?:\d[\d *Xx•·-]{8,})(\d{4})\b/)?.[1] || last4;
    const currencyMatches = [...headingText.matchAll(/\b(HKD|CNY|RMB)\b/gi)].map(m => m[1].toUpperCase().replace('RMB', 'CNY'));
    const uniqueCurrencies = [...new Set(currencyMatches)];
    if (uniqueCurrencies.length !== 1) {
      warnings.push(`第 ${page.page} 页币种无法唯一识别，未导入该页，请人工核查`);
      continue;
    }
    const pageCurrency = uniqueCurrencies[0];
    currencies.add(pageCurrency);
    const balance = balances[pageCurrency] ||= { opening: null, closing: null };
    for (const line of lines) {
      const balanceType = /\b(?:PREVIOUS BALANCE|OPENING BALANCE|BALANCE BROUGHT FORWARD)\b/i.test(line.text) ? 'opening'
        : /\b(?:CLOSING BALANCE|NEW BALANCE|BALANCE CARRIED FORWARD)\b/i.test(line.text) ? 'closing' : null;
      const moneyText = line.text.match(/(-?[\d,]+\.\d{2}\s*(?:CR|DR)?)\s*$/i)?.[1];
      const money = balanceType && parseMoney(moneyText);
      if (money) balance[balanceType] = `${money.direction === 'credit' ? '-' : ''}${money.amount}`;
    }

    let prevTx = null;

    for (const line of lines.filter(l => l.y > header.y + 4)) {
      const cardMatch = line.text.match(/(?:CARD\s*(?:NUMBER|NO\.?)?\s*:?\s*)?(?:\d[\d *Xx•·-]{8,})(\d{4})\b/);
      if (cardMatch && !/^\d{1,2}\s*[A-Z]{3}/i.test(line.text)) {
        last4 = cardMatch[1];
        prevTx = null;
        continue;
      }
      const postText = line.items.filter(i => i.x < page.width * 0.165).map(i => i.text).join(' ').trim();
      const transText = line.items.filter(i => i.x >= page.width * 0.165 && i.x < page.width * 0.225).map(i => i.text).join(' ').trim();
      const descText = line.items.filter(i => i.x >= page.width * 0.225 && i.x < page.width * 0.80).map(i => i.text).join(' ').trim();
      const amountText = line.items.filter(i => i.x >= page.width * 0.80).map(i => i.text).join('').trim();

      const money = parseMoney(amountText);
      const isDateCandidate = /^\d{1,2}\s*[A-Z]{3}/i.test(postText);

      if (!isDateCandidate) {
        // 多行备注或 Apple Pay 标识挂回上一笔
        if (prevTx && descText && !/BALANCE|PAYMENT|SUMMARY/i.test(descText)) {
          prevTx.notes.push(descText);
          prevTx.rawLine += `\n${line.text}`;
          prevTx.channel = rule.detectChannel?.(prevTx) || prevTx.channel;
        }
        continue;
      }

      const day = inferDate(postText, statementDate);
      const transDay = inferDate(transText, statementDate) || day;

      if (!money || !day || !descText) {
        warnings.push(`第 ${page.page} 页交易行未能完整识别：${postText}，请人工核查`);
        prevTx = null;
        continue;
      }

      const tx = {
        id: `${fileName}:${page.page}:${transactions.length}`,
        day,
        transactionDay: transDay,
        description: descText,
        amount: money.amount,
        direction: money.direction,
        currency: pageCurrency,
        ruleId: rule.id,
        bankId: rule.bankId,
        last4,
        category: money.direction === 'credit' ? (/PAYMENT|还款|還款/i.test(descText) ? 'repayment' : 'credit')
          : /\b(?:FEE|INTEREST|FINANCE CHARGE)\b|手续费|手續費|利息/i.test(descText) ? 'fee' : 'spend',
        notes: [],
        rawLine: line.text,
        sources: [{ fileName, page: page.page }]
      };

      tx.channel = rule.detectChannel?.(tx) || { key: 'standard', label: '普通消费' };
      transactions.push(tx);
      prevTx = tx;
    }
  }

  if (!transactions.length) warnings.push('未识别到交易，请确认结单格式或是否为扫描件；当前不支持 OCR');
  if (rule.id !== 'hsbc_pulse') warnings.push('此卡种尚未接入返现核算，交易仅供查阅与导出');
  const reconciliation = [...currencies].map(currency => ({
    currency,
    ...balances[currency],
    ...verifyBalance(balances[currency].opening, balances[currency].closing, transactions.filter(tx => tx.currency === currency))
  }));
  return {
    fileName,
    statementDate,
    currencies: [...currencies],
    transactions,
    ruleId: rule.id,
    bankId: rule.bankId,
    reconciliation,
    warnings
  };
}

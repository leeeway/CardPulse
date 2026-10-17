/**
 * 客户端 PDF 结单读取与几何文本聚类解析模块
 * 结合 PDF.js 进行文字坐标还原，杜绝字符流阅读乱序
 */

import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseMoney, verifyBalance } from './reconciliation.js';
import { matchCardRule } from './rules/registry.js';

GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
export const MAX_PAGES = 200;

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
  return dayStr;
}

export async function parsePdfStatement(file, { password, onProgress = () => {}, signal } = {}) {
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 25 MB 限制');
  const data = new Uint8Array(await file.arrayBuffer());

  const assetRoot = `${import.meta.env.BASE_URL || '/'}pdf-assets/`;
  const task = getDocument({
    data,
    password,
    cMapUrl: `${assetRoot}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetRoot}standard_fonts/`,
    wasmUrl: `${assetRoot}wasm/`,
    isEvalSupported: false,
    useSystemFonts: false
  });

  const abortHandler = () => void task.destroy();
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) throw new Error('结单超过 200 页限制');

    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal?.aborted) throw new DOMException('解析已取消', 'AbortError');
      onProgress(i, doc.numPages);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      pages.push({
        page: i,
        width: viewport.width,
        height: viewport.height,
        items: content.items
          .filter(item => 'str' in item)
          .map(item => ({
            text: item.str,
            x: item.transform[4],
            y: viewport.height - item.transform[5],
            width: item.width
          }))
      });
      page.cleanup();
    }

    return extractStatementData(pages, file.name);
  } catch (err) {
    if (err.name === 'PasswordException') {
      const pErr = new Error(err.code === PasswordResponses.INCORRECT_PASSWORD ? '结单密码错误' : 'PDF 已加密，请输入密码');
      pErr.code = 'password';
      throw pErr;
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    await task.destroy();
  }
}

function extractStatementData(pages, fileName) {
  const transactions = [];
  const warnings = [];
  let statementDate = '';
  let currencies = new Set();
  const rule = matchCardRule(fileName, ['CNY', 'HKD']);

  for (const page of pages) {
    const lines = groupTextLines(page.items);
    const header = lines.find(l => /post\s*date/i.test(l.text) && /trans\s*date/i.test(l.text));
    if (!header) continue;

    const headingText = lines.filter(l => l.y < header.y).map(l => l.text).join(' ');
    const dateMatch = headingText.match(FULL_DATE);
    if (dateMatch) {
      statementDate = `${dateMatch[3]}-${String(MONTHS.indexOf(dateMatch[2].toUpperCase()) + 1).padStart(2, '0')}-${String(dateMatch[1]).padStart(2, '0')}`;
    }

    const curMatch = headingText.match(/(HKD|CNY|RMB)/i);
    const pageCurrency = curMatch ? curMatch[1].toUpperCase().replace('RMB', 'CNY') : 'CNY';
    currencies.add(pageCurrency);

    let prevTx = null;

    for (const line of lines.filter(l => l.y > header.y + 4)) {
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

      if (!money || !day || !descText) continue;

      const tx = {
        id: `${fileName}:${page.page}:${transactions.length}`,
        day,
        transactionDay: transDay,
        description: descText,
        amount: money.amount,
        direction: money.direction,
        currency: pageCurrency,
        category: money.direction === 'credit' ? (/PAYMENT|还款/i.test(descText) ? 'repayment' : 'credit') : 'spend',
        notes: [],
        rawLine: line.text,
        sources: [{ fileName, page: page.page }]
      };

      tx.channel = rule.detectChannel?.(tx) || { key: 'standard', label: '普通消费' };
      transactions.push(tx);
      prevTx = tx;
    }
  }

  return {
    fileName,
    statementDate,
    currencies: [...currencies],
    transactions,
    warnings
  };
}

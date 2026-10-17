import { it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStandardCsv, CSV_TEMPLATE } from '../src/core/csv-import.js';
import { BANKS, cardsFor } from '../src/core/banks.js';
const parse = (text) =>
  parseStandardCsv(text, 'fixture.csv', {
    bankId: 'bochk',
    cardId: 'bochk_custom',
  });

it('所有银行均可使用标准 CSV，银行身份和卡片明确保留', () => {
  for (const bank of BANKS) {
    const result = parseStandardCsv(CSV_TEMPLATE, 'fixture.csv', {
      bankId: bank.id,
      cardId: cardsFor(bank.id)[0],
    });
    assert.equal(result.transactions[0].bankId, bank.id);
    assert.equal(result.transactions[0].channel.key, 'online');
    assert.equal(result.reconciliation[0].status, 'unverified');
  }
});
it('支持 BOM、CRLF、引号内逗号与换行、转义引号', () => {
  const data =
    '\uFEFFday,description,amount,currency,direction\r\n2026-01-01,"SHOP, \"\"HELLO\"\"\nHK","1,234.50",HKD,debit\r\n';
  const tx = parse(data).transactions[0];
  assert.equal(tx.amount, '1234.50');
  assert.equal(tx.description, 'SHOP, "HELLO"\nHK');
  assert.equal(tx.transactionDay, '');
  assert.equal(tx.channel.uncertain, true);
});
it('任意错误导致整个 CSV 拒绝导入并标明行号', () => {
  const invalid =
    CSV_TEMPLATE +
    '2026-02-30,2026-02-01,SHOP,10.00,HKD,debit,spend,1234,online\r\n';
  assert.throws(() => parse(invalid), /CSV 第 3 行/);
  for (const change of [
    (text) => text.replace('100.00', '-100.00'),
    (text) => text.replace('HKD', 'USD'),
    (text) => text.replace('debit', 'credit'),
    (text) => text.replace('online', 'unknown'),
    (text) => text.replace('100.00', '1.001'),
  ])
    assert.throws(() => parse(change(CSV_TEMPLATE)));
});
it('拒绝重复或缺失表头、不完整引号和不一致列数', () => {
  for (const invalid of [
    'day,day,amount,currency,direction',
    'description,amount',
    'day,description,amount,currency,direction\n2026-01-01,"SHOP,100.00,HKD,debit',
    'day,description,amount,currency,direction\n2026-01-01,SHOP,100.00,HKD,debit,extra',
  ])
    assert.throws(() => parse(invalid));
});

it('10,000 笔交易边界与文件末尾换行无关', () => {
  const header = 'day,description,amount,currency,direction\n';
  const row = '2026-01-01,SHOP,1.00,HKD,debit';
  const content = header + Array(10000).fill(row).join('\n');
  assert.equal(parse(content).transactions.length, 10000);
  assert.equal(parse(content + '\n').transactions.length, 10000);
  assert.throws(() => parse(content + '\n' + row), /10,000/);
  assert.throws(() => parse(content + '\n' + row + '\n'), /10,000/);
});

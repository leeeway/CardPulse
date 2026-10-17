import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatementData, groupTextLines } from '../src/core/statement.js';

const item = (text, x, y) => ({ text, x, y });
function page({ currency = 'CNY', date = '10 JAN 2026', rows = [], opening = '100.00', closing = '150.00', card = '6222 XXXX XXXX 1234', extra = '' } = {}) {
  return { page: 1, width: 1000, items: [
    item(`STATEMENT DATE ${date} ${currency} ${extra}`, 10, 10),
    item(card, 10, 20), item('POST DATE TRANS DATE DESCRIPTION AMOUNT', 10, 40),
    item(`PREVIOUS BALANCE ${opening}`, 230, 50),
    ...rows.flatMap(([post, trans, desc, amount], index) => [
      item(post, 10, 70 + index * 10), item(trans, 170, 70 + index * 10),
      item(desc, 230, 70 + index * 10), item(amount, 850, 70 + index * 10)
    ]),
    item(`CLOSING BALANCE ${closing}`, 230, 200)
  ] };
}

describe('坐标解析与结单对账', () => {
  it('按坐标还原乱序文本并识别跨年交易、还款和费用', () => {
    const fixture = page({ closing: '161.50', rows: [
      ['02 JAN', '31 DEC', 'SHOP', '100.00'],
      ['03 JAN', '02 JAN', 'PAYMENT RECEIVED', '50.00 CR'],
      ['04 JAN', '03 JAN', 'ANNUAL FEE', '11.50']
    ] });
    fixture.items.reverse();
    const result = extractStatementData([fixture], 'statement.pdf');
    assert.equal(result.transactions.length, 3);
    assert.equal(result.transactions[0].transactionDay, '2025-12-31');
    assert.equal(result.transactions[0].last4, '1234');
    assert.equal(result.transactions[1].category, 'repayment');
    assert.equal(result.transactions[2].category, 'fee');
    assert.equal(result.reconciliation[0].status, 'matched');
  });

  it('钱包多行备注附加到上一笔并重新识别渠道', () => {
    const fixture = page({ rows: [['02 JAN', '02 JAN', 'SHOP', '50.00']] });
    fixture.items.push(item('APPLE PAY', 230, 78));
    const result = extractStatementData([fixture], 'pulse.pdf');
    assert.equal(result.transactions[0].channel.key, 'applePay');
    assert.deepEqual(result.transactions[0].notes, ['APPLE PAY']);
  });

  it('币种不明或多义时不猜测人民币，空文件提供警告', () => {
    for (const currency of ['', 'CNY HKD']) {
      const result = extractStatementData([page({ currency, rows: [['02 JAN', '02 JAN', 'SHOP', '50.00']] })], 'unknown.pdf');
      assert.equal(result.transactions.length, 0);
      assert.ok(result.warnings.some(text => text.includes('币种')));
    }
    assert.ok(extractStatementData([], 'scan.pdf').warnings.some(text => text.includes('OCR')));
  });

  it('非法日期和金额留下警告，差额不报对账成功', () => {
    const result = extractStatementData([page({ date: '10 MAR 2026', rows: [
      ['31 FEB', '31 FEB', 'BAD DATE', '10.00'],
      ['02 MAR', '02 MAR', 'BAD MONEY', '10.001'],
      ['03 MAR', '03 MAR', 'SHOP', '10.00']
    ] })], 'pulse.pdf');
    assert.equal(result.transactions.length, 1);
    assert.equal(result.warnings.length, 2);
    assert.equal(result.reconciliation[0].status, 'mismatch');
    assert.equal(result.reconciliation[0].difference, '-40.00');
  });

  it('没有结欠时明确未验证，并且从正文识别 Red 卡', () => {
    const result = extractStatementData([page({ currency: 'HKD', extra: 'HSBC RED CARD', opening: '', closing: '', rows: [['02 JAN', '02 JAN', 'AMAZON', '50.00']] })], 'renamed.pdf');
    assert.equal(result.ruleId, 'hsbc_red');
    assert.equal(result.transactions[0].ruleId, 'hsbc_red');
    assert.equal(result.reconciliation[0].status, 'unverified');
  });

  it('几何聚类保留同一基线的列顺序', () => {
    assert.equal(groupTextLines([item('B', 100, 11), item('A', 1, 10)])[0].text, 'A B');
  });
});

it('银行身份只从结单表头识别，商户名不会改变卡种', () => {
  const fixture = page({ extra: 'HSBC PULSE', rows: [['02 JAN', '02 JAN', 'CITIBANK SHOP', '50.00']] });
  assert.equal(extractStatementData([fixture], 'boc.pdf').ruleId, 'hsbc_pulse');
  const foreign = page({ extra: 'BOCHK', rows: [['02 JAN', '02 JAN', 'SHOP', '50.00']] });
  assert.throws(() => extractStatementData([foreign], 'pulse.pdf', { cardId: 'hsbc_pulse' }), /PDF 版式尚未适配/);
  const red = page({ extra: 'HSBC RED CARD', rows: [['02 JAN', '02 JAN', 'SHOP', '50.00']] });
  assert.throws(() => extractStatementData([red], 'red.pdf', { cardId: 'hsbc_pulse' }), /选择不同/);
});

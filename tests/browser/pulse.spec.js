import { confirmStatementImport } from './import-preview.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Pulse explanations reconcile annual and half-year pools and show missing FX correctly', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-19T04:00:00Z'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const header = 'day,description,amount,currency,direction,category,channel\n';
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  const rows = [
    '2026-01-01,FIRST HALF,80000.00,CNY,debit,spend,applePay',
    '2026-02-01,REFUND,10000.00,CNY,credit,credit,applePay',
    '2026-07-01,SECOND HALF,10000.00,CNY,debit,spend,applePay',
    '2026-10-01,HKD SHOP,1000.00,HKD,debit,spend,standard',
    '2026-10-01,STANDARD SHOP,100.00,CNY,debit,spend,standard',
    '2026-10-01,FEE,50.00,CNY,debit,fee,standard',
    '2026-10-01,PAYMENT,1000.00,CNY,credit,repayment,standard',
    '2026-10-01,EXCLUDED,100.00,CNY,debit,spend,exclude',
    '2027-01-01,FUTURE,100.00,CNY,debit,spend,applePay',
  ];
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'pulse.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(header + rows.join('\n')),
  });
  await confirmStatementImport(page);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(9);
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'other.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      header + '2026-10-01,OTHER BANK,100.00,CNY,debit,spend,standard',
    ),
  });
  await confirmStatementImport(page);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(10);
  const ledger = page.locator('.transactions-section');
  await expect(
    ledger.getByRole('columnheader', { name: '适用返现比例' }),
  ).toBeVisible();
  await expect(
    ledger.getByRole('columnheader', { name: '封顶前返现估算' }),
  ).toBeVisible();
  await expect(
    ledger.getByRole('columnheader', { name: '封顶后返现估算' }),
  ).toBeVisible();
  await expect(
    ledger.getByRole('columnheader', { name: '退款扣回估算' }),
  ).toBeVisible();
  const estimate = (merchant) =>
    ledger
      .getByRole('row')
      .filter({ hasText: merchant })
      .locator('td.pulse-estimate-column');
  const expectUncapped = async (merchant, rate, amount) => {
    await expect(estimate(merchant).first()).toHaveText(rate);
    await expect(estimate(merchant).nth(1)).toHaveText(amount);
  };
  await expectUncapped('FIRST HALF', '4.4%', 'CNY 3520.00');
  await expect(estimate('FIRST HALF').nth(2)).toContainText('CNY 3520.00');
  await expect(estimate('FIRST HALF').nth(2)).toContainText(
    '基础 320.00 · 年度 1600.00 · 半年 1600.00',
  );
  await expectUncapped('REFUND', '4.4%', 'CNY -440.00');
  await expect(estimate('REFUND').nth(2)).toHaveText('—');
  await expect(estimate('REFUND').last()).toContainText('CNY -440.00');
  await expectUncapped('STANDARD SHOP', '2.4%', 'CNY 2.40');
  await expectUncapped('HKD SHOP', '0.4%', 'HKD 4.00');
  await expect(estimate('FEE').nth(1)).toContainText('还款或费用不计奖赏');
  await expect(estimate('PAYMENT').first()).toHaveText('—');
  await expect(estimate('EXCLUDED').nth(1)).toContainText('已设为不计奖赏');
  await expect(estimate('FUTURE').nth(1)).toContainText('不在本年度估算日期内');
  await expect(estimate('OTHER BANK')).toHaveText(['—', '—', '—', '—']);
  const pulse = page.locator('.pulse-section');
  await expect(pulse).toContainText('缺少汇率，港币部分尚未折算');
  await pulse.getByText('Pulse 计算明细', { exact: true }).click();
  const breakdown = pulse.locator('.pulse-calculation-details');
  await expect(breakdown).toContainText('HKD 4.00');
  await expect(breakdown).toContainText('待折算');
  await expect(breakdown.locator('.pulse-half').first()).toContainText(
    '2026 · 上半年',
  );
  await expect(breakdown.locator('.pulse-half').last()).toContainText(
    '2026 · 下半年',
  );
  await expect(breakdown).toContainText('CNY 1602.00');
  await expect(breakdown).toContainText('CNY 1600.00');
  await pulse.getByText('Pulse 逐笔说明', { exact: true }).click();
  const audit = pulse.locator('.transaction-explanations');
  await expect(audit).toContainText('计入 5 笔，排除 5 笔');
  await expect(
    audit.locator('tbody tr').filter({ hasText: 'REFUND' }),
  ).toContainText('2026');
  await expect(
    audit.locator('tbody tr').filter({ hasText: 'REFUND' }),
  ).not.toContainText('2026-H1');
  await audit.getByLabel('说明记录范围').selectOption('excluded');
  await expect(audit.locator('tbody tr')).toHaveCount(5);
  await expect(audit).toContainText('不适用 Pulse 内置模型');
  await page
    .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
    .fill('0.93');
  await page.getByRole('button', { name: '应用手动汇率', exact: true }).click();
  await expect(
    pulse.locator('.primary-reward .reward-card-value'),
  ).toContainText('3526.12');
  await expect(breakdown).toContainText('CNY 3.72');
  await expect(estimate('HKD SHOP').nth(2)).toHaveText('HKD 4.00');
  await page.getByLabel('搜索商户、卡号或备注').fill('STANDARD SHOP');
  await page
    .locator('.transactions-section tbody tr')
    .getByRole('button', { name: '核对交易' })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('支付渠道', { exact: true })
    .selectOption('applePay');
  await page.getByRole('button', { name: '应用修正', exact: true }).click();
  await expect(
    pulse.locator('.primary-reward .reward-card-value'),
  ).toContainText('3528.12');
  await expectUncapped('STANDARD SHOP', '4.4%', 'CNY 4.40');
  await expect(estimate('STANDARD SHOP').nth(2)).toContainText('CNY 4.40');
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(
    pulse.getByText('Pulse 計算明細', { exact: true }),
  ).toBeVisible();
  await expect(
    ledger.getByRole('columnheader', { name: '設限後回贈估算' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('pulse-explanation-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('Pulse ledger pages filtered rows, preserves selections and exports across pages', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-19T04:00:00Z'));
  await page.goto('/');
  const input = page.locator('input[accept=".pdf,.csv"]');
  await expect(input).toBeEnabled();
  const header = 'day,description,amount,currency,direction,category,channel\n';
  const purchases = Array.from(
    { length: 27 },
    (_, index) =>
      `2026-10-01,REPORT ${String(index + 1).padStart(2, '0')},100.00,CNY,debit,spend,applePay`,
  );
  purchases.push('2026-01-01,SKIP THIS,100000.00,CNY,debit,spend,applePay');
  await input.setInputFiles({
    name: 'many-pulse.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(header + purchases.join('\n')),
  });
  await confirmStatementImport(page);
  await page.locator('.bank-tile').filter({ hasText: '汇丰' }).click();

  const ledger = page.locator('.transactions-section');
  const rows = ledger.locator('tbody tr');
  const pager = ledger.getByRole('navigation', { name: '交易分页' });
  const previous = pager.getByRole('button', { name: '上一页' });
  const next = pager.getByRole('button', { name: '下一页' });
  await expect(pager).toContainText('第 1 / 2 页');
  await expect(previous).toBeDisabled();
  await expect(rows).toHaveCount(25);
  await ledger.getByRole('button', { name: '选择交易', exact: true }).click();
  await rows.filter({ hasText: 'REPORT 01' }).getByRole('checkbox').check();
  await next.click();
  await expect(rows).toHaveCount(3);
  const capped = rows
    .filter({ hasText: 'REPORT 27' })
    .locator('td.pulse-estimate-column')
    .nth(2);
  await expect(capped).toContainText('CNY 2.40');
  await expect(capped).toContainText('基础 0.40 · 年度 0.00 · 半年 2.00');
  await expect(next).toBeDisabled();
  await rows.filter({ hasText: 'REPORT 27' }).getByRole('checkbox').check();
  await expect(ledger).toContainText('已选 2 笔交易');
  await previous.click();
  await expect(
    rows.filter({ hasText: 'REPORT 01' }).getByRole('checkbox'),
  ).toBeChecked();
  await next.click();
  await expect(
    rows.filter({ hasText: 'REPORT 27' }).getByRole('checkbox'),
  ).toBeChecked();

  await ledger.getByRole('searchbox').fill('REPORT');
  await expect(pager).toContainText('第 1 / 2 页');
  await expect(rows).toHaveCount(25);
  await expect(rows.getByRole('checkbox')).toHaveCount(0);
  await next.click();
  await expect(rows).toHaveCount(2);
  await expect(capped).toContainText('CNY 2.40');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  expect(content.split('\r\n')).toHaveLength(28);
  expect(content).toContain('REPORT 01');
  expect(content).toContain('REPORT 27');
  expect(content).not.toContain('SKIP THIS');
});

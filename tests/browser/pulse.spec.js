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
  const exportReady = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const [headerLine, ...exportedRows] = (
    await readFile(await (await exportReady).path(), 'utf8')
  ).split('\r\n');
  const exported = (merchant) =>
    exportedRows.find((line) => line.includes(`"${merchant}"`));
  expect(headerLine).toMatch(
    /,"适用返现比例","封顶前返现估算","封顶后返现估算","退款扣回估算"$/,
  );
  expect(exported('REFUND')).toMatch(/,"4\.4%","-440\.00","","-440\.00"$/);
  expect(exported('HKD SHOP')).toMatch(/,"HKD",.*,"0\.4%","4\.00","4\.00",""$/);
  expect(exported('OTHER BANK')).toMatch(/,"","","",""$/);
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
  const [, ...records] = content.split('\r\n');
  expect(records).toHaveLength(27);
  for (const merchant of ['REPORT 01', 'REPORT 27']) {
    const row = records.find((line) => line.includes(`"${merchant}"`));
    expect(row).toMatch(/,"4\.4%","4\.40","2\.40",""$/);
  }
  expect(content).not.toContain('SKIP THIS');
});

test('the narrow Mac Pulse ledger pins column headers, shows original currency and supports both pagers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.cardpulseDesktop = { platform: 'darwin', readVault: async () => null };
  });
  await page.setViewportSize({ width: 840, height: 640 });
  await page.clock.setFixedTime(new Date('2026-10-19T04:00:00Z'));
  await page.goto('/');
  const input = page.locator('input[accept=".pdf,.csv"]');
  await expect(input).toBeEnabled();
  const longMerchant = 'LONGMERCHANTREFERENCE'.repeat(9);
  const records = [
    'day,description,amount,currency,direction,category,channel,last4',
    `2026-10-02,${longMerchant},230.00,CNY,debit,spend,applePay,1234`,
    '2026-10-02,HKD SHOP,12345.00,HKD,debit,spend,standard,1234',
    '2026-10-02,REFUND,230.00,CNY,credit,credit,applePay,1234',
    ...Array.from(
      { length: 25 },
      (_, index) =>
        `2026-10-01,STORE ${index + 1},100.00,CNY,debit,spend,applePay,1234`,
    ),
    '2026-01-01,ANNUAL CAP,100000.00,CNY,debit,spend,applePay,1234',
  ];
  await input.setInputFiles({
    name: 'mac-pulse.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(records.join('\n')),
  });
  await confirmStatementImport(page);
  const ledger = page.locator('.transactions-section');
  const rows = ledger.getByRole('row');
  const longRow = rows.filter({ hasText: longMerchant });
  const hkdRow = rows.filter({ hasText: 'HKD SHOP' });
  const refundRow = rows.filter({ hasText: 'REFUND' });
  const topPager = ledger.getByRole('navigation', {
    name: '交易分页',
    exact: true,
  });
  const bottomPager = ledger.getByRole('navigation', { name: '列表底部交易分页' });
  await expect(topPager).toContainText('第 1–25 笔，共 29 笔');
  await expect(topPager.getByRole('button', { name: '上一页' })).toBeDisabled();
  await expect(longRow).toContainText('汇丰 · HSBC Pulse ···· 1234');
  await expect(longRow).toContainText('Apple Pay');
  await expect(longRow.getByRole('cell', { name: 'CNY +230.00' })).toBeVisible();
  await expect(longRow).toContainText('封顶后返现估算 CNY 5.52');
  await expect(longRow).toContainText('适用比例 4.4%');
  await longRow.getByText('返现明细', { exact: true }).click();
  await expect(longRow.getByText('封顶前返现估算 · CNY 10.12')).toBeVisible();
  await expect(hkdRow).toContainText('HKD +12345.00');
  await expect(hkdRow).toContainText('HKD 49.38');
  await expect(hkdRow).toContainText('适用比例 0.4%');
  await expect(refundRow).toContainText('CNY −230.00');
  await expect(refundRow).toContainText('退款扣回估算 CNY -10.12');

  const table = ledger.getByRole('table');
  const tableHeader = table.locator('thead');
  const headerOffset = (edge) =>
    tableHeader.evaluate((header, side) => {
      const navigation = document.querySelector('.mac-workspace .header');
      return (
        header.getBoundingClientRect()[side] -
        navigation.getBoundingClientRect().bottom
      );
    }, edge);
  await expect(
    tableHeader.getByRole('columnheader', { name: '金额' }),
  ).toBeVisible();
  await expect(
    tableHeader.getByRole('columnheader', { name: 'Pulse 返现' }),
  ).toBeVisible();
  for (const width of [840, 680]) {
    await page.setViewportSize({ width, height: 640 });
    await rows.nth(8).evaluate((row) => row.scrollIntoView({ block: 'center' }));
    await expect
      .poll(async () => Math.abs(await headerOffset('top')))
      .toBeLessThanOrEqual(1);
    await expect(tableHeader).toBeInViewport({ ratio: 1 });
    const amountLines = await hkdRow
      .locator('.transaction-value')
      .evaluate((amount) => {
        const range = document.createRange();
        range.selectNodeContents(amount);
        return new Set(Array.from(range.getClientRects(), (rect) => rect.top))
          .size;
      });
    expect(amountLines).toBe(1);
  }
  await page.locator('#campaign-heading').evaluate((heading) => {
    heading.scrollIntoView({ block: 'start' });
  });
  await expect.poll(() => headerOffset('bottom')).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 840, height: 640 });

  await ledger.getByRole('button', { name: '选择交易', exact: true }).click();
  await expect(
    await ledger.locator('.table-container').evaluate((element) => ({
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      tableFits: element.scrollWidth <= element.clientWidth,
    })),
  ).toEqual({ pageFits: true, tableFits: true });
  await longRow.getByRole('checkbox').check();
  await bottomPager.getByRole('button', { name: '下一页' }).click();
  await expect(topPager).toBeFocused();
  await expect(topPager).toBeInViewport({ ratio: 1 });
  await expect(topPager).toContainText('第 26–29 笔，共 29 笔');
  await expect(topPager.getByRole('button', { name: '下一页' })).toBeDisabled();
  const previous = topPager.getByRole('button', { name: '上一页' });
  await previous.focus();
  await previous.press('Enter');
  await expect(topPager).toBeFocused();
  await expect(longRow.getByRole('checkbox')).toBeChecked();

  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(
    ledger.getByRole('navigation', { name: '交易分頁', exact: true }),
  ).toContainText('第 1–25 筆，共 29 筆');
  await expect(longRow).toContainText('設限後回贈估算 CNY 5.52');
  await expect(longRow).toContainText('適用比例 4.4%');
});

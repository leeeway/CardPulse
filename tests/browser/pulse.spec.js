import { test, expect } from '@playwright/test';

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
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'pulse.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(header + rows.join('\n')),
    });
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(9);
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'other.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        header + '2026-10-01,OTHER BANK,100.00,CNY,debit,spend,standard',
      ),
    });
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(10);
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
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(
    pulse.getByText('Pulse 計算明細', { exact: true }),
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

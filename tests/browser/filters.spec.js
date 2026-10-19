import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('posting date filters include boundaries, combine with search, and limit CSV without changing rewards', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-19T04:00:00Z'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'dates.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,transactionDay,description,amount,currency,direction\n2026-09-30,2026-09-30,BEFORE,100.00,CNY,debit\n2026-10-01,2026-09-30,ON START,100.00,CNY,debit\n2026-10-19,2026-10-01,ON END,100.00,CNY,debit\n2026-10-20,2026-10-19,AFTER,100.00,CNY,debit',
      ),
    });
  await expect(page.locator('tbody tr')).toHaveCount(4);
  const total = page.locator('.primary-reward .reward-card-value');
  const beforeTotal = await total.innerText();
  await page.getByLabel('记账起始日期', { exact: true }).fill('2026-10-01');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('记账截止日期', { exact: true }).fill('2026-10-19');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(total).toHaveText(beforeTotal);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  expect(content).toContain('ON START');
  expect(content).toContain('ON END');
  expect(content).not.toContain('BEFORE');
  expect(content).not.toContain('AFTER');
  await page.getByLabel('搜索商户、卡号或备注').fill('ON END');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await expect(page.getByLabel('搜索商户、卡号或备注')).toHaveValue('');
  await page.getByLabel('记账起始日期', { exact: true }).fill('2026-10-20');
  await page.getByLabel('记账截止日期', { exact: true }).fill('2026-10-01');
  await expect(page.getByRole('alert')).toHaveText('起始日期不能晚于结束日期');
  await expect(
    page.getByRole('button', { name: '导出 CSV', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await page.getByLabel('记账截止日期', { exact: true }).fill('2026-09-30');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(page.getByLabel('記帳起始日期', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('date-filters-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '重設篩選', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  expect(errors).toEqual([]);
});

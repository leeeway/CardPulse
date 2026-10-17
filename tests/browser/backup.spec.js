import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('offline by default and encrypted web backup migrates transactions and rates', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'));
  let rateRequests = 0;
  await page.route('https://api.frankfurter.dev/**', (route) => {
    rateRequests++;
    return route.fulfill({ json: { rate: 0.92, date: '2026-10-16' } });
  });
  await page.goto('/');
  const button = (name) => page.getByRole('button', { name, exact: true });
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  expect(rateRequests).toBe(0);
  await button('联网更新参考汇率').click();
  await expect(
    page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true }),
  ).toHaveValue('0.92');
  expect(rateRequests).toBe(1);
  await page
    .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
    .fill('0.93');
  await button('应用手动汇率').click();
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'web.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,description,amount,currency,direction\n2026-10-01,SYNTHETIC BACKUP SHOP,100.00,CNY,debit',
      ),
    });
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await button('保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill('web backup password');
  await button('加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await button('导出加密备份').click();
  await page.getByLabel('主密码', { exact: true }).fill('web backup password');
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  expect(content).not.toContain('SYNTHETIC BACKUP SHOP');
  expect(content).not.toContain('web backup password');
  expect(JSON.parse(content).format).toBe('CardPulseVault');
  await expect(page.getByRole('dialog')).toBeHidden();
  page.once('dialog', (dialog) => dialog.accept());
  await button('清空数据').click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page
    .locator('input[accept=".cardpulse"]')
    .setInputFiles({
      name: 'restore.cardpulse',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
  await page.getByLabel('主密码', { exact: true }).fill('wrong');
  await button('确认恢复').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByLabel('主密码', { exact: true }).fill('web backup password');
  page.once('dialog', (dialog) => dialog.accept());
  await button('确认恢复').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(
    page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true }),
  ).toHaveValue('0.93');
  await page.reload();
  await button('解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill('web backup password');
  await button('解锁数据').click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(rateRequests).toBe(1);
});

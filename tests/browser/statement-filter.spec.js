import { confirmStatementImport } from './import-preview.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('statement links and filters isolate same-name sources for table and CSV while preserving the reward scope', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-19T04:00:00Z'));
  await page.goto('/');
  const upload = page.locator('input[accept=".pdf,.csv"]');
  const button = (parent, name) =>
    parent.getByRole('button', { name, exact: true });
  const importFile = async (name, rows) => {
    await upload.setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,description,amount,currency,direction\n' + rows.join('\n'),
      ),
    });
    await confirmStatementImport(page);
    await expect(
      page.getByText(`${name}：已导入 ${rows.length} 笔交易`, { exact: true }),
    ).toBeVisible();
  };
  await expect(upload).toBeEnabled();
  await importFile('same.csv', [
    '2026-11-01,SHARED SHOP,100,CNY,debit',
    '2026-11-02,FIRST ONLY,25,CNY,debit',
  ]);
  await importFile('same.csv', [
    '2026-11-01,SHARED SHOP,100,CNY,debit',
    '2026-11-03,SECOND ONLY,30,CNY,debit',
  ]);
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await importFile('other.csv', ['2026-11-01,OTHER BANK,30,HKD,debit']);
  const rows = page.locator('.transactions-section tbody tr');
  await expect(rows).toHaveCount(5);
  const total = page.locator('.primary-reward .reward-card-value');
  const before = await total.innerText();
  const reconciliations = page.locator('.statement-status');
  await reconciliations.locator('summary').click();
  const first = reconciliations
    .locator('.statement-row')
    .filter({ has: page.getByText('结单 1', { exact: true }) });
  const second = reconciliations
    .locator('.statement-row')
    .filter({ has: page.getByText('结单 2', { exact: true }) });
  const source = page.getByLabel('结单来源', { exact: true });
  const search = page.getByLabel('搜索商户、卡号或备注');
  await search.fill('OTHER BANK');
  await button(first, '查看该结单交易').click();
  await expect(
    page.getByRole('heading', { name: '交易记录', exact: true }),
  ).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'FIRST ONLY' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'SECOND ONLY' })).toHaveCount(0);
  await expect(total).toHaveText(before);
  await source.selectOption({ label: '结单 2 · same.csv' });
  await page.getByLabel('记账起始日期', { exact: true }).fill('2026-11-02');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('SECOND ONLY');
  const downloaded = page.waitForEvent('download');
  await button(page, '导出 CSV').click();
  const csv = await readFile(await (await downloaded).path(), 'utf8');
  expect(csv).toContain('SECOND ONLY');
  for (const absent of ['FIRST ONLY', 'SHARED SHOP', 'OTHER BANK'])
    expect(csv).not.toContain(absent);
  await expect(total).toHaveText(before);

  const duplicates = page.locator('.duplicate-transactions');
  await duplicates.locator('summary').click();
  const secondCandidate = duplicates
    .locator('li')
    .filter({ has: page.getByText('结单 2', { exact: true }) });
  await button(secondCandidate, '查看该结单交易').click();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'SHARED SHOP' })).toHaveCount(1);
  await expect(page.getByLabel('记账起始日期', { exact: true })).toHaveValue(
    '',
  );
  await page.locator('.bank-tile').filter({ hasText: '中银香港' }).click();
  await expect(source).toHaveValue('');
  await expect(source.getByRole('option')).toHaveCount(2);
  await expect(rows.first()).toContainText('OTHER BANK');
  await page.locator('.bank-tile').filter({ hasText: '全部银行' }).click();
  await source.selectOption({ label: '结单 2 · same.csv' });
  page.once('dialog', (dialog) => dialog.accept());
  await button(second, '删除结单').click();
  await expect(source).toHaveValue('');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'SECOND ONLY' })).toHaveCount(0);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(page.getByLabel('結單來源', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

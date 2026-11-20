import { expect, test } from '@playwright/test';
import {
  confirmStatementImport,
  statementImportPreview,
} from './import-preview.js';

const header = 'day,description,amount,currency,direction,last4\n';
const csv = (name, rows) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(header + rows.join('\n')),
});
const row = (description, amount = 100) =>
  `2026-11-05,${description},${amount},HKD,debit,1234`;
const upload = (page) => page.locator('input[accept=".pdf,.csv"]');
const rows = (page) => page.locator('.transactions-section tbody tr');
const button = (parent, name) =>
  parent.getByRole('button', { name, exact: true });

test('mixed batch previews source counts and overlaps before cancellation or confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  const old = csv('old.csv', [
    row('Existing overlap'),
    row('Historical overlap'),
  ]);
  const earlier = csv('earlier.csv', [
    row('Historical overlap'),
    row('Earlier purchase'),
  ]);
  await upload(page).setInputFiles([old, earlier]);
  await confirmStatementImport(page);
  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic preview password');
  await button(page, '加密保存').click();
  await expect(
    page.getByText('已加密保存到本地保险库', { exact: true }),
  ).toBeVisible();

  const incoming = csv('incoming.csv', [
    row('Existing overlap'),
    row('Batch overlap', 55),
  ]);
  const batch = [
    incoming,
    { ...incoming, name: 'renamed-incoming.csv' },
    { ...old, name: 'renamed-old.csv' },
    csv('other.csv', [row('Batch overlap', 55), row('New purchase', 25)]),
    csv('invalid.csv', ['broken,not-a-transaction']),
  ];
  await upload(page).setInputFiles(batch);
  const preview = statementImportPreview(page);
  const status = page.locator('[role="status"]');
  const unsaved = '有未保存的修改，请保存到加密库。';
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('待导入 2 份文件，共 4 笔交易。');
  const files = preview.getByRole('list', { name: '文件来源' });
  const file = (name) =>
    files
      .getByRole('listitem')
      .filter({ has: page.getByText(name, { exact: true }) });
  await expect(file('incoming.csv')).toContainText('中银香港');
  await expect(file('incoming.csv')).toContainText('2 笔交易');
  await expect(file('other.csv')).toContainText('2 笔交易');
  await expect(file('renamed-incoming.csv')).toContainText(
    '与本批文件内容相同，已跳过',
  );
  await expect(file('renamed-old.csv')).toContainText('已导入，跳过重复文件');
  await expect(file('invalid.csv')).toContainText('CSV 第 2 行');
  await expect(preview).toContainText(
    '发现 2 组疑似重叠，涉及 3 笔待导入交易。',
  );
  await expect(preview).toContainText('已入账 · 结单 1 · old.csv');
  await expect(preview).toContainText('待导入 · 结单 3 · incoming.csv');
  await expect(preview).toContainText('待导入 · 结单 4 · other.csv');
  await expect(preview).toContainText('2026-11-05 · HKD +55.00');
  await expect(
    preview.getByRole('heading', { name: 'Historical overlap' }),
  ).toHaveCount(0);
  await expect(rows(page)).toHaveCount(4);
  await expect(status).not.toContainText(unsaved);

  await button(preview, '取消').click();
  await expect(preview).toBeHidden();
  await expect(rows(page)).toHaveCount(4);
  await expect(
    page.getByText('已加密保存到本地保险库', { exact: true }),
  ).toBeVisible();
  await expect(status).not.toContainText(unsaved);

  await upload(page).setInputFiles(batch);
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(8);
  await expect(rows(page).filter({ hasText: 'Batch overlap' })).toHaveCount(2);
  await expect(
    page.getByText('incoming.csv：已导入 2 笔交易', { exact: true }),
  ).toBeVisible();
  await expect(status).toContainText(unsaved);

  await upload(page).setInputFiles({
    ...incoming,
    name: 'duplicate-after-confirm.csv',
  });
  await expect(
    page.getByText('duplicate-after-confirm.csv：已导入，跳过重复文件', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(preview).toBeHidden();
  await expect(rows(page)).toHaveCount(8);
});

test('drag and drop stages a file in Traditional Chinese and Escape discards it on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  const file = csv('mobile.csv', [row('Mobile shop')]);
  const dataTransfer = await page.evaluateHandle((content) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], 'mobile.csv', { type: 'text/csv' }));
    return transfer;
  }, file.buffer.toString());
  await page.locator('.dropzone').dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
  const preview = statementImportPreview(page);
  await expect(preview).toContainText('待匯入 1 份檔案，共 1 筆交易。');
  await expect(preview).toContainText('未發現符合檢查條件的疑似重疊記錄。');
  await expect(button(preview, '確認匯入')).toBeInViewport();
  await expect(rows(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(rows(page)).toHaveCount(0);

  await upload(page).setInputFiles(file);
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(1);
});

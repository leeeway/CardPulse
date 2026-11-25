import { expect, test } from '@playwright/test';
import {
  confirmStatementImport,
  statementImportPreview,
} from './import-preview.js';
import { makeStatementPdf } from './fixtures.js';

const upload = (page) => page.locator('input[accept=".pdf,.csv"]');
const rows = (page) => page.locator('.transactions-section tbody tr');
const button = (parent, name) =>
  parent.getByRole('button', { name, exact: true });
const statement = (page, fileName) =>
  page
    .locator('.statement-row')
    .filter({ has: page.getByText(fileName, { exact: true }) });
const csv = (name, records) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(
    'day,description,amount,currency,direction,last4\n' + records.join('\n'),
  ),
});
const row = (merchant, amount = 50) =>
  `2026-01-02,${merchant},${amount},CNY,debit,1234`;

async function pickOriginal(page, target, file, name = '补录跳过的交易') {
  const picked = page.waitForEvent('filechooser');
  await button(target, name).click();
  await (await picked).setFiles(file);
}

test('CSV supplement verifies the original, stages only skipped rows and preserves saved reviews', async ({
  page,
}) => {
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  await page.getByLabel('导入银行').selectOption('bochk');
  const matched = row('Similar purchase');
  const original = csv('original.csv', [
    matched,
    matched,
    row('Recover this', 70),
    row('Already reviewed', 100),
  ]);
  await upload(page).setInputFiles(csv('older.csv', [matched]));
  await confirmStatementImport(page);
  await upload(page).setInputFiles(original);
  const initial = statementImportPreview(page);
  await button(initial, '交易明细').click();
  const details = initial.getByRole('region', { name: '交易明细' });
  await details
    .getByRole('checkbox', { name: /Similar purchase.*CSV 第 2 行/ })
    .uncheck();
  await details.getByRole('checkbox', { name: /Recover this/ }).uncheck();
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(3);

  const reviewed = rows(page).filter({ hasText: 'Already reviewed' });
  await button(reviewed, '核对交易').click();
  const review = page.getByRole('dialog', { name: '核对交易' });
  await review.getByLabel('支付渠道', { exact: true }).selectOption('applePay');
  await button(review, '应用修正').click();
  await expect(reviewed).toContainText('已人工修正');
  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic supplement password');
  await button(page, '加密保存').click();
  await expect(page.getByText('已加密保存到本地保险库')).toBeVisible();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic supplement password');
  await button(page, '解锁数据').click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByLabel('导入银行')).toHaveValue('hsbc');

  await page.getByText('查看结单与对账', { exact: false }).click();
  const target = statement(page, 'original.csv');
  const preview = page.getByRole('dialog', { name: '补录交易预览' });
  await pickOriginal(page, target, csv('original.csv', [matched]));
  await expect(page.getByRole('status')).toContainText(
    '文件内容与所选结单不符',
  );
  await expect(preview).toBeHidden();
  const renamed = { ...original, name: 'renamed.csv' };
  await pickOriginal(page, target, renamed);
  const candidates = preview.getByRole('region', { name: '交易明细' });
  const recover = candidates.getByRole('checkbox', { name: /Recover this/ });
  await expect(candidates.getByRole('checkbox')).toHaveCount(2);
  await expect(recover).not.toBeChecked();
  await expect(button(preview, '确认补录')).toBeDisabled();
  await expect(candidates).not.toContainText('Already reviewed');
  await button(preview, '疑似重复交易').click();
  const overlaps = preview.getByRole('region', { name: '疑似重复交易' });
  await expect(overlaps.getByRole('checkbox')).toHaveCount(1);
  await expect(overlaps).toContainText('已入账 · 结单 2 · original.csv');
  await expect(overlaps).toContainText('已入账 · 结单 1 · older.csv');
  await button(preview, '交易明细').click();
  await recover.check();
  await expect(preview).toContainText('待补录 1 笔交易。');
  await button(preview, '取消').click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('status')).not.toContainText('有未保存的修改');

  await pickOriginal(page, target, renamed);
  await expect(recover).not.toBeChecked();
  await recover.check();
  await button(preview, '确认补录').click();
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).filter({ hasText: 'Similar purchase' })).toHaveCount(
    2,
  );
  await expect(target).toContainText('导入时跳过 1 笔交易');
  await expect(page.getByRole('status')).toContainText(
    '已补录 1 笔交易，剩余 1 笔待补录。',
  );
  await button(reviewed, '核对交易').click();
  await expect(review.getByLabel('支付渠道', { exact: true })).toHaveValue(
    'applePay',
  );
  await review.locator('.review-history summary').click();
  await expect(review).toContainText('待确认渠道');
  await button(review, '取消').click();

  await pickOriginal(page, target, renamed);
  await expect(candidates.getByRole('checkbox')).toHaveCount(1);
  await expect(candidates).not.toContainText('Recover this');
  await expect(button(preview, '确认补录')).toBeDisabled();
});

test('renamed PDF supplement uses the saved card and filename and closes its completed statement', async ({
  page,
}) => {
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  const original = {
    name: 'HSBC Pulse original.pdf',
    mimeType: 'application/pdf',
    buffer: makeStatementPdf('50.00', '25.00'),
  };
  await upload(page).setInputFiles(original);
  const initial = statementImportPreview(page);
  await initial.getByRole('checkbox', { name: /SECOND TEST SHOP/ }).uncheck();
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(1);
  await page.getByLabel('导入银行').selectOption('bochk');
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await page.getByText('查看結單與對賬', { exact: false }).click();
  const target = statement(page, original.name);
  await expect(target).toContainText('對賬一致');
  await pickOriginal(
    page,
    target,
    { ...original, name: 'Standard Chartered Smart.pdf' },
    '補錄跳過的交易',
  );
  const preview = page.getByRole('dialog', { name: '補錄交易預覽' });
  await expect(preview).toContainText('待補錄 0 筆交易。');
  await preview
    .getByRole('checkbox', { name: /SECOND TEST SHOP.*PDF 第 1 頁/ })
    .check();
  await button(preview, '確認補錄').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(target).toContainText('2 筆交易');
  await expect(target).toContainText('對賬一致');
  await expect(button(target, '補錄跳過的交易')).toHaveCount(0);
  await page.getByLabel('匯入銀行').selectOption('hsbc');
  await upload(page).setInputFiles(original);
  await expect(page.getByRole('status')).toContainText('已匯入，跳過重複檔案');
  await expect(rows(page)).toHaveCount(2);
});

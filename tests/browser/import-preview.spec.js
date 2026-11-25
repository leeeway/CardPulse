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
  await expect(preview).toContainText('发现 2 组疑似重叠，涉及 3 笔候选交易。');
  await expect(preview).toContainText('已入账 · 结单 1 · old.csv');
  await expect(preview).toContainText('待导入 · 结单 3 · incoming.csv');
  await expect(preview).toContainText('待导入 · 结单 4 · other.csv');
  await expect(preview).toContainText('2026-11-05 · HKD +55.00');
  await expect(
    preview.getByRole('heading', { name: 'Historical overlap' }),
  ).toHaveCount(0);
  await expect(rows(page)).toHaveCount(4);
  await expect(status).not.toContainText(unsaved);

  const existingOverlap = preview.getByRole('checkbox', {
    name: /incoming\.csv.*CSV 第 2 行/,
  });
  await expect(preview.getByRole('checkbox')).toHaveCount(3);
  await expect(existingOverlap).toBeChecked();
  await existingOverlap.uncheck();
  await expect(preview).toContainText('待导入 2 份文件，共 3 笔交易。');
  await expect(file('incoming.csv')).toContainText('1 笔交易 · 已跳过 1 笔');
  await expect(rows(page)).toHaveCount(4);
  await button(preview, '取消').click();
  await expect(preview).toBeHidden();
  await expect(rows(page)).toHaveCount(4);
  await expect(
    page.getByText('已加密保存到本地保险库', { exact: true }),
  ).toBeVisible();
  await expect(status).not.toContainText(unsaved);

  await upload(page).setInputFiles(batch);
  await expect(existingOverlap).toBeChecked();
  await existingOverlap.uncheck();
  await existingOverlap.check();
  await expect(preview).toContainText('待导入 2 份文件，共 4 笔交易。');
  await existingOverlap.uncheck();
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(7);
  await expect(rows(page).filter({ hasText: 'Existing overlap' })).toHaveCount(
    1,
  );
  await expect(rows(page).filter({ hasText: 'Batch overlap' })).toHaveCount(2);
  await expect(
    page.getByText('incoming.csv：已导入 1 笔交易，跳过 1 笔', { exact: true }),
  ).toBeVisible();
  await expect(status).toContainText(unsaved);
  await page.getByText('查看结单与对账', { exact: false }).click();
  const statement = page
    .locator('.statement-row')
    .filter({ has: page.getByText('incoming.csv', { exact: true }) });
  await expect(statement).toContainText('1 笔交易');
  await expect(statement).toContainText(
    '导入时跳过 1 笔交易。对账基于原文件解析的全部交易。',
  );

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
  await expect(rows(page)).toHaveCount(7);

  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic preview password');
  await button(page, '加密保存').click();
  await expect(
    page.getByText('已加密保存到本地保险库', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic preview password');
  await button(page, '解锁数据').click();
  await expect(rows(page)).toHaveCount(7);
  await page.getByText('查看结单与对账', { exact: false }).click();
  await expect(statement).toContainText('导入时跳过 1 笔交易。');
});

test('zero retained records disable confirmation and a completely skipped file can be selected again', async ({
  page,
}) => {
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  await upload(page).setInputFiles(
    csv('old.csv', [row('Duplicate A'), row('Duplicate B')]),
  );
  await confirmStatementImport(page);

  const skip = csv('skip.csv', [row('Duplicate A')]);
  const keep = csv('keep.csv', [row('Duplicate B')]);
  await upload(page).setInputFiles([skip, keep]);
  const preview = statementImportPreview(page);
  const skipCheckbox = preview.getByRole('checkbox', { name: /skip\.csv/ });
  const keepCheckbox = preview.getByRole('checkbox', { name: /keep\.csv/ });
  await skipCheckbox.uncheck();
  await keepCheckbox.uncheck();
  await expect(preview).toContainText('待导入 0 份文件，共 0 笔交易。');
  await expect(button(preview, '确认导入')).toBeDisabled();
  await expect(rows(page)).toHaveCount(2);
  await keepCheckbox.check();
  await expect(preview).toContainText('待导入 1 份文件，共 1 笔交易。');
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(
    page.getByText('skip.csv：全部交易已跳过', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('结单来源')
      .locator('option')
      .filter({ hasText: 'skip.csv' }),
  ).toHaveCount(0);

  await upload(page).setInputFiles(skip);
  await expect(preview).toContainText('待导入 1 份文件，共 1 笔交易。');
  await expect(skipCheckbox).toBeChecked();
});

test('individual selections persist across duplicate group and record pages', async ({
  page,
}) => {
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  const groups = Array.from({ length: 6 }, (_, index) =>
    row(`Overlap ${index + 1}`),
  );
  await upload(page).setInputFiles(csv('older.csv', groups));
  await confirmStatementImport(page);
  await upload(page).setInputFiles(
    csv('many.csv', [...Array(11).fill(groups[0]), ...groups.slice(1)]),
  );
  const preview = statementImportPreview(page);
  const first = preview.getByRole('checkbox', {
    name: /many\.csv.*CSV 第 2 行/,
  });
  await first.uncheck();
  await button(preview, '下一页').click();
  const lastOnFirstGroup = preview.getByRole('checkbox', {
    name: /many\.csv.*CSV 第 12 行/,
  });
  await lastOnFirstGroup.uncheck();
  await button(preview, '下一组页').click();
  await expect(
    preview.getByRole('heading', { name: 'Overlap 6' }),
  ).toBeVisible();
  await expect(preview).toContainText('待导入 1 份文件，共 14 笔交易。');
  await button(preview, '上一组页').click();
  await expect(first).not.toBeChecked();
  await button(preview, '下一页').click();
  await expect(lastOnFirstGroup).not.toBeChecked();
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(20);
  await expect(rows(page).filter({ hasText: 'Overlap 1' })).toHaveCount(10);
});

test('all staged rows can be inspected, filtered and skipped with selections shared across views', async ({
  page,
}) => {
  await page.goto('/');
  await expect(upload(page)).toBeEnabled();
  const overlap = row('Previous purchase');
  await upload(page).setInputFiles(csv('old.csv', [overlap]));
  await confirmStatementImport(page);

  await upload(page).setInputFiles([
    csv('incoming.csv', [
      overlap,
      row('Wrong amount', 77),
      ...Array.from({ length: 10 }, (_, index) => row(`Shop ${index + 1}`)),
    ]),
    csv('incoming.csv', [row('Another purchase', 77)]),
  ]);
  const preview = statementImportPreview(page);
  const duplicates = preview.getByRole('region', { name: '疑似重复交易' });
  const duplicate = duplicates.getByRole('checkbox', {
    name: /结单 2.*CSV 第 2 行/,
  });
  await duplicate.uncheck();
  await button(preview, '交易明细').click();
  const details = preview.getByRole('region', { name: '交易明细' });
  const source = details.getByLabel('结单来源');
  const search = details.getByRole('searchbox');
  await expect(details).toContainText('符合筛选的 13 笔交易');
  await expect(
    details.getByRole('checkbox', { name: /Previous purchase/ }),
  ).not.toBeChecked();
  await expect(details.getByRole('checkbox')).toHaveCount(10);
  await button(details, '下一页').click();
  await expect(
    details.getByRole('checkbox', { name: /Shop 10/ }),
  ).toBeVisible();

  await source.selectOption({ label: '结单 2 · incoming.csv' });
  await expect(
    details.getByRole('checkbox', { name: /Previous purchase/ }),
  ).toBeVisible();
  await search.fill('77.00');
  await expect(details.getByRole('checkbox')).toHaveCount(1);
  const anomaly = details
    .getByRole('listitem')
    .filter({ hasText: 'Wrong amount' });
  await expect(anomaly).toContainText('CSV 第 3 行');
  await expect(anomaly).toContainText('记账日期 2026-11-05');
  await expect(anomaly).toContainText('HKD +77.00');
  await anomaly.getByRole('checkbox').uncheck();
  await search.fill('unknown merchant');
  await expect(details).toContainText('未找到匹配的交易记录');
  await expect(preview).toContainText('待导入 2 份文件，共 11 笔交易。');
  await expect(rows(page)).toHaveCount(1);

  await search.fill('previous purchase');
  await details.getByRole('checkbox', { name: /Previous purchase/ }).check();
  await button(preview, '疑似重复交易').click();
  await expect(duplicate).toBeChecked();
  await duplicate.uncheck();
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(12);
  await expect(rows(page).filter({ hasText: 'Wrong amount' })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Previous purchase' })).toHaveCount(
    1,
  );
  await expect(rows(page).filter({ hasText: 'Another purchase' })).toHaveCount(
    1,
  );
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
  const details = preview.getByRole('region', { name: '交易明細' });
  await expect(
    details.getByRole('searchbox', { name: '搜尋交易' }),
  ).toBeVisible();
  await expect(
    details.getByRole('checkbox', { name: /Mobile shop/ }),
  ).toBeChecked();
  await expect(button(preview, '確認匯入')).toBeInViewport();
  await expect(rows(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(rows(page)).toHaveCount(0);

  await upload(page).setInputFiles(file);
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(1);

  await upload(page).setInputFiles(
    csv('follow-up.csv', [row('Mobile shop'), row('Another mobile shop')]),
  );
  const duplicate = preview.getByRole('checkbox', {
    name: /保留.*follow-up\.csv/,
  });
  await duplicate.uncheck();
  await expect(preview).toContainText('已跳過 1 筆');
  await expect(preview).toContainText('待匯入 1 份檔案，共 1 筆交易。');
  await expect(button(preview, '確認匯入')).toBeInViewport();
  await confirmStatementImport(page);
  await expect(rows(page)).toHaveCount(2);
});

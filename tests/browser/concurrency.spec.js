import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseBackup, decryptWorkspace } from '../../src/core/backup.js';

const password = 'synthetic multi-tab password';
const conflict = '本地库已被其他页面修改';
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function importRow(page, name) {
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `day,description,amount,currency,direction\n2026-10-01,${name},100.00,CNY,debit`,
    ),
  });
}
async function submit(page, action, submit) {
  await button(page, action).click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, submit).click();
}

test('stale tabs cannot save, restore or clear newer data and can export unsaved edits before unlocking latest data', async ({
  page: a,
  context,
}) => {
  const errors = [];
  a.on('pageerror', (error) => errors.push(error.message));
  await a.goto('/');
  await expect(a.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await importRow(a, 'ORIGINAL');
  await submit(a, '保存到加密库', '加密保存');
  await expect(a.getByRole('dialog')).toBeHidden();
  const b = await context.newPage();
  b.on('pageerror', (error) => errors.push(error.message));
  await b.goto('/');
  await submit(b, '解锁本地库', '解锁数据');
  await expect(b.getByRole('dialog')).toBeHidden();
  await importRow(b, 'UNSAVED B');
  await importRow(a, 'SAVED A');
  await submit(a, '保存到加密库', '加密保存');
  await expect(a.getByRole('dialog')).toBeHidden();

  await submit(b, '保存到加密库', '加密保存');
  await expect(b.getByRole('alert')).toContainText(conflict);
  await expect(b.locator('.transactions-section tbody')).toContainText(
    'UNSAVED B',
  );
  await button(b, '取消').click();
  await button(b, '导出加密备份').click();
  await b.getByLabel('主密码', { exact: true }).fill(password);
  const downloaded = b.waitForEvent('download');
  await b
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  const backup = await decryptWorkspace(parseBackup(content), password);
  expect(backup.transactions.map((tx) => tx.description)).toEqual([
    'ORIGINAL',
    'UNSAVED B',
  ]);
  await expect(b.getByRole('dialog')).toBeHidden();

  await b.locator('input[accept=".cardpulse"]').setInputFiles({
    name: 'conflict.cardpulse',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  await b.getByLabel('主密码', { exact: true }).fill(password);
  b.once('dialog', (dialog) => dialog.accept());
  await button(b, '确认恢复').click();
  await expect(b.getByRole('alert')).toContainText(conflict);
  await button(b, '取消').click();
  b.once('dialog', (dialog) => dialog.accept());
  await button(b, '清空数据').click();
  await expect(b.getByRole('status')).toContainText(conflict);
  await expect(b.locator('.transactions-section tbody')).toContainText(
    'UNSAVED B',
  );
  await b.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(b.getByRole('status')).toContainText(
    '本機資料庫已被其他分頁修改',
  );
  await b.getByLabel('語言', { exact: true }).selectOption('zh-CN');

  await a.reload();
  await submit(a, '解锁本地库', '解锁数据');
  await expect(a.locator('.transactions-section tbody tr')).toHaveCount(2);
  await expect(a.locator('.transactions-section tbody')).toContainText(
    'SAVED A',
  );
  await expect(a.locator('.transactions-section tbody')).not.toContainText(
    'UNSAVED B',
  );
  // Explicitly discarding B's edits and unlocking accepts the latest baseline.
  b.once('dialog', (dialog) => dialog.accept());
  await button(b, '锁定保险库').click();
  await submit(b, '解锁本地库', '解锁数据');
  await expect(b.locator('.transactions-section tbody')).toContainText(
    'SAVED A',
  );
  await importRow(b, 'AFTER UNLOCK');
  await submit(b, '保存到加密库', '加密保存');
  await expect(b.getByRole('dialog')).toBeHidden();
  await expect(b.locator('.transactions-section tbody tr')).toHaveCount(3);
  expect(errors).toEqual([]);
});

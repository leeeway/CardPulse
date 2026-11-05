import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseBackup, decryptWorkspace } from '../../src/core/backup.js';

const oldPassword = 'old synthetic vault password';
const newPassword = 'new synthetic vault password';
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function importRow(page, name) {
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `day,description,amount,currency,direction\n2026-11-01,${name},100.00,CNY,debit`,
    ),
  });
}
async function fillChange(page, current, next, confirmation = next) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('当前密码', { exact: true }).fill(current);
  await dialog.getByLabel('新密码', { exact: true }).fill(next);
  await dialog.getByLabel('确认新密码', { exact: true }).fill(confirmation);
  await dialog
    .getByRole('button', { name: '确认修改密码', exact: true })
    .click();
}
async function unlock(page, password) {
  await button(page, '解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '解锁数据').click();
}

test('password changes preserve unsaved work, reject conflicts and retain old backup passwords', async ({
  page: a,
  context,
}, testInfo) => {
  const errors = [];
  a.on('pageerror', (error) => errors.push(error.message));
  await a.clock.setFixedTime(new Date('2026-11-05T04:00:00Z'));
  await a.goto('/');
  await expect(a.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await expect(button(a, '修改保险库密码')).toBeDisabled();
  await importRow(a, 'SAVED ORIGINAL');
  await button(a, '保存到加密库').click();
  await a.getByLabel('主密码', { exact: true }).fill(oldPassword);
  await button(a, '加密保存').click();
  await expect(a.getByRole('dialog')).toBeHidden();
  await button(a, '导出加密备份').click();
  await a.getByLabel('主密码', { exact: true }).fill(oldPassword);
  const download = a.waitForEvent('download');
  await a
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  const backup = parseBackup(
    await readFile(await (await download).path(), 'utf8'),
  );
  await expect(a.getByRole('dialog')).toBeHidden();
  const b = await context.newPage();
  await b.goto('/');
  await expect(button(b, '修改保险库密码')).toBeDisabled();
  await unlock(b, oldPassword);
  await expect(b.getByRole('dialog')).toBeHidden();

  await importRow(a, 'UNSAVED EDIT');
  await button(a, '添加活动').click();
  await a
    .getByLabel('活动名称', { exact: true })
    .fill('Unsaved campaign draft');
  await button(a, '修改保险库密码').click();
  const dialog = a.getByRole('dialog');
  await expect(dialog.getByLabel('当前密码', { exact: true })).toBeFocused();
  await expect(dialog).toContainText('当前有未保存的修改');
  // Native modal keeps keyboard focus away from background actions.
  for (let index = 0; index < 9; index++) {
    await a.keyboard.press('Tab');
    expect(
      await a.evaluate(
        () =>
          document.activeElement === document.body ||
          document.querySelector('dialog').contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await fillChange(a, oldPassword, newPassword, 'mismatch');
  await expect(dialog.getByRole('alert')).toContainText(
    '两次输入的新密码不一致',
  );
  await fillChange(a, 'wrong password', newPassword);
  await expect(dialog.getByRole('alert')).toContainText('密码不正确');
  await fillChange(a, oldPassword, oldPassword);
  await expect(dialog.getByRole('alert')).toContainText(
    '新密码不能与当前密码相同',
  );
  await a.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(a.getByLabel('活动名称', { exact: true })).toHaveValue(
    'Unsaved campaign draft',
  );
  await button(a, '修改保险库密码').click();
  for (const label of ['当前密码', '新密码', '确认新密码'])
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
  await fillChange(a, oldPassword, newPassword);
  await expect(dialog).toBeHidden();
  await expect(a.getByRole('status')).toContainText('有未保存的修改');
  await expect(a.locator('.transactions-section tbody tr')).toHaveCount(2);
  await expect(a.getByLabel('活动名称', { exact: true })).toHaveValue(
    'Unsaved campaign draft',
  );
  const decoded = await decryptWorkspace(backup, oldPassword);
  expect(decoded.transactions.map((tx) => tx.description)).toEqual([
    'SAVED ORIGINAL',
  ]);
  await expect(decryptWorkspace(backup, newPassword)).rejects.toThrow();

  // A page opened before rekey cannot rekey over the newer ciphertext.
  await button(b, '修改保险库密码').click();
  await fillChange(b, oldPassword, 'third password');
  await expect(b.getByRole('alert')).toContainText('本地库已被其他页面修改');
  await button(b, '取消').click();
  const c = await context.newPage();
  await c.goto('/');
  await unlock(c, oldPassword);
  await expect(c.getByRole('alert')).toContainText('密码不正确');
  await c.getByLabel('主密码', { exact: true }).fill(newPassword);
  await button(c, '解锁数据').click();
  await expect(c.getByRole('dialog')).toBeHidden();
  await expect(c.locator('.transactions-section tbody tr')).toHaveCount(1);
  await expect(c.locator('.transactions-section tbody')).not.toContainText(
    'UNSAVED EDIT',
  );

  await button(a, '保存到加密库').click();
  await a.getByLabel('主密码', { exact: true }).fill(newPassword);
  await button(a, '加密保存').click();
  await expect(a.getByRole('dialog')).toBeHidden();
  await expect(a.getByRole('status')).not.toContainText('有未保存的修改');
  await a.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await a.setViewportSize({ width: 390, height: 844 });
  await button(a, '更改保險庫密碼').click();
  await expect(a.getByLabel('目前密碼', { exact: true })).toBeVisible();
  await expect(a.getByLabel('新密碼', { exact: true })).toBeVisible();
  await a.getByRole('dialog').screenshot({
    path: testInfo.outputPath('password-mobile.png'),
  });
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.keyboard.press('Escape');
  await a.reload();
  await button(a, '解鎖本機資料庫').click();
  await a.getByLabel('主密碼', { exact: true }).fill(newPassword);
  await button(a, '解鎖資料').click();
  await expect(a.locator('.transactions-section tbody tr')).toHaveCount(2);
  expect(errors).toEqual([]);
});

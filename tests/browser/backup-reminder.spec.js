import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decryptWorkspace, parseBackup } from '../../src/core/backup.js';

const password = 'synthetic reminder password';
const newPassword = 'updated reminder password';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const reminder = (page) => page.locator('.backup-reminder');
async function importRow(page, name = 'SYNTHETIC REMINDER SHOP') {
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `day,description,amount,currency,direction\n2026-11-01,${name},100.00,CNY,debit`,
    ),
  });
}
async function unlock(page, pass = password) {
  await button(page, '解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill(pass);
  await button(page, '解锁数据').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function exportBackup(page, pass = password) {
  await button(page, '立即备份').click();
  await page.getByLabel('主密码', { exact: true }).fill(pass);
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  const file = await downloaded;
  await expect(page.getByRole('dialog')).toBeHidden();
  return readFile(await file.path(), 'utf8');
}

test('confirmed backup dates, reminder intervals, password changes and restores stay accurate across tabs', async ({
  page: a,
  context,
}, testInfo) => {
  await a.clock.setFixedTime(new Date('2026-11-05T04:00:00Z'));
  await a.goto('/');
  await expect(a.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await expect(reminder(a)).toBeHidden();
  await importRow(a);
  await expect(reminder(a)).toContainText('尚无已确认的备份');
  await expect(reminder(a)).toContainText('当前有未保存的修改');
  await button(a, '保存到加密库').click();
  await a.getByLabel('主密码', { exact: true }).fill(password);
  await button(a, '加密保存').click();
  await expect(a.getByRole('dialog')).toBeHidden();
  // Saving a vault is not an exported backup.
  await expect(reminder(a)).toContainText('尚无已确认的备份');
  await button(a, '立即备份').click();
  await a.getByLabel('主密码', { exact: true }).fill('wrong password');
  await a
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  await expect(a.getByRole('alert')).toBeVisible();
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '暂无记录',
  );
  await button(a, '取消').click();
  const oldBackup = await exportBackup(a);
  await expect(reminder(a)).toContainText('浏览器已发起下载');
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '暂无记录',
  );
  await button(a, '取消确认').click();
  await expect(button(a, '确认文件已保存')).toBeHidden();
  await expect(reminder(a)).toContainText('尚无已确认的备份');
  await exportBackup(a);
  await button(a, '确认文件已保存').click();
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '2026-11-05',
  );
  await expect(reminder(a)).toContainText('2026-11-12');
  await a.getByLabel('备份提醒频率').selectOption('14');
  await a.reload();
  await unlock(a);
  await expect(a.getByLabel('备份提醒频率')).toHaveValue('14');
  await expect(reminder(a)).toContainText('2026-11-19');
  await a.clock.setFixedTime(new Date('2026-11-11T16:00:01Z'));
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.getByLabel('备份提醒频率').selectOption('7');
  await expect(reminder(a)).toContainText('距上次确认备份已 7 天');
  await a.getByLabel('备份提醒频率').selectOption('0');
  await expect(reminder(a)).toContainText('备份提醒已关闭');
  await a.getByLabel('备份提醒频率').selectOption('7');

  const b = await context.newPage();
  await b.goto('/');
  await unlock(b);
  await exportBackup(b);
  await expect(button(b, '确认文件已保存')).toBeVisible();
  await button(a, '修改保险库密码').click();
  await a.getByLabel('当前密码', { exact: true }).fill(password);
  await a.getByLabel('新密码', { exact: true }).fill(newPassword);
  await a.getByLabel('确认新密码', { exact: true }).fill(newPassword);
  await button(a, '确认修改密码').click();
  await expect(a.getByRole('dialog')).toBeHidden();
  await expect(reminder(a)).toContainText('保险库密码已修改');
  // A confirmation for an older export cannot clear another tab's rekey reminder.
  await expect(button(b, '确认文件已保存')).toBeHidden();
  await expect(reminder(b)).toContainText('保险库密码已修改');
  await exportBackup(a, newPassword);
  await expect(reminder(a)).toContainText('保险库密码已修改');
  await button(a, '确认文件已保存').click();
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '2026-11-12',
  );
  await expect(reminder(a)).not.toContainText('保险库密码已修改');

  const restoreInput = a.locator('input[accept=".cardpulse"]');
  await restoreInput.setInputFiles({
    name: 'old.cardpulse',
    mimeType: 'application/json',
    buffer: Buffer.from(oldBackup),
  });
  await a.getByLabel('主密码', { exact: true }).fill(password);
  a.once('dialog', (dialog) => dialog.dismiss());
  await button(a, '确认恢复').click();
  await expect(reminder(a)).not.toContainText('已恢复备份');
  await button(a, '取消').click();
  await restoreInput.setInputFiles({
    name: 'old.cardpulse',
    mimeType: 'application/json',
    buffer: Buffer.from(oldBackup),
  });
  await a.getByLabel('主密码', { exact: true }).fill(password);
  a.once('dialog', (dialog) => dialog.accept());
  await button(a, '确认恢复').click();
  await expect(a.getByRole('dialog')).toBeHidden();
  await expect(reminder(a)).toContainText('已恢复备份，建议重新导出当前工作区');
  await a.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(reminder(a)).toContainText('已還原備份');
  await a.setViewportSize({ width: 390, height: 844 });
  await reminder(a).screenshot({
    path: testInfo.outputPath('reminder-mobile.png'),
  });
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.getByLabel('語言', { exact: true }).selectOption('zh-CN');
  a.once('dialog', (dialog) => dialog.accept());
  await button(a, '清空数据').click();
  await expect(reminder(a)).toBeHidden();
  await importRow(a, 'NEW WORKSPACE');
  await expect(reminder(a)).toContainText('尚无已确认的备份');
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '暂无记录',
  );
});

test('unavailable reminder storage does not block encrypted exports or mark unsaved work as saved', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cardpulse.backup-reminder')
        throw new DOMException('blocked', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await importRow(page);
  const content = await exportBackup(page);
  await button(page, '确认文件已保存').click();
  await expect(reminder(page)).toContainText('本次记录仅在当前页面有效');
  await expect(page.getByRole('status')).toContainText('有未保存的修改');
  const workspace = await decryptWorkspace(parseBackup(content), password);
  expect(workspace.transactions).toHaveLength(1);
  expect(workspace).not.toHaveProperty('lastConfirmedOn');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('cardpulse.backup-reminder'),
    ),
  ).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'SYNTHETIC REMINDER SHOP',
  );
});

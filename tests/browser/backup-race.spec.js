import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decryptWorkspace, parseBackup } from '../../src/core/backup.js';

const password = 'synthetic backup race password';
const nextPassword = 'changed backup race password';
const thirdPassword = 'third backup race password';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const reminder = (page) => page.locator('.backup-reminder');
async function importRow(page) {
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'race.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction\n2026-11-01,SYNTHETIC RACE SHOP,100.00,CNY,debit',
    ),
  });
}
async function startExport(page, pass) {
  await button(page, '立即备份').click();
  await page.getByLabel('主密码', { exact: true }).fill(pass);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
}
async function exportBackup(page, pass) {
  const downloaded = page.waitForEvent('download');
  await startExport(page, pass);
  const file = await downloaded;
  await expect(page.getByRole('dialog')).toBeHidden();
  return readFile(await file.path(), 'utf8');
}
async function rekey(page, oldPassword, newPassword) {
  await button(page, '修改保险库密码').click();
  await page.getByLabel('当前密码', { exact: true }).fill(oldPassword);
  await page.getByLabel('新密码', { exact: true }).fill(newPassword);
  await page.getByLabel('确认新密码', { exact: true }).fill(newPassword);
  await button(page, '确认修改密码').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('an in-flight export and a delayed stale confirmation cannot clear a newer same-day rekey reminder', async ({
  page: a,
  context,
}) => {
  await a.clock.setFixedTime(new Date('2026-11-05T04:00:00Z'));
  await a.addInitScript(() => {
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    const wrappers = new WeakMap();
    window.addEventListener = function (type, listener, options) {
      if (type === 'storage' && typeof listener === 'function') {
        const wrapped = (event) => {
          if (
            window.holdBackupStorageEvents &&
            event.key === 'cardpulse.backup-reminder'
          )
            return;
          listener.call(this, event);
        };
        wrappers.set(listener, wrapped);
        return add.call(this, type, wrapped, options);
      }
      return add.call(this, type, listener, options);
    };
    window.removeEventListener = function (type, listener, options) {
      return remove.call(
        this,
        type,
        wrappers.get(listener) || listener,
        options,
      );
    };
  });
  await a.goto('/');
  await expect(a.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await importRow(a);
  await button(a, '保存到加密库').click();
  await a.getByLabel('主密码', { exact: true }).fill(password);
  await button(a, '加密保存').click();
  await expect(a.getByRole('dialog')).toBeHidden();
  const b = await context.newPage();
  await b.goto('/');
  await button(b, '解锁本地库').click();
  await b.getByLabel('主密码', { exact: true }).fill(password);
  await button(b, '解锁数据').click();
  await expect(b.getByRole('dialog')).toBeHidden();
  // Hold the export after AES encryption, then rekey in another page.
  await a.evaluate(() => {
    const original = crypto.subtle.encrypt;
    crypto.subtle.encrypt = async function (...args) {
      crypto.subtle.encrypt = original;
      const payload = await original.apply(this, args);
      window.exportEncryptionHeld = true;
      await new Promise((resolve) => {
        window.releaseExportEncryption = resolve;
      });
      return payload;
    };
  });
  await startExport(a, password);
  await expect
    .poll(() => a.evaluate(() => window.exportEncryptionHeld))
    .toBe(true);
  await rekey(b, password, nextPassword);
  await expect(reminder(a)).toContainText('保险库密码已修改');
  const downloaded = a.waitForEvent('download');
  await a.evaluate(() => window.releaseExportEncryption());
  const content = await readFile(await (await downloaded).path(), 'utf8');
  await expect(a.getByRole('dialog')).toBeHidden();
  expect(
    (await decryptWorkspace(parseBackup(content), password)).transactions,
  ).toHaveLength(1);
  await expect(
    decryptWorkspace(parseBackup(content), nextPassword),
  ).rejects.toThrow();
  await expect(button(a, '确认文件已保存')).toBeHidden();
  await expect(reminder(a)).toContainText('保险库密码已修改');
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '暂无记录',
  );

  // Hold storage event delivery so confirmation must re-read actual metadata.
  await a.evaluate(() => {
    window.holdBackupStorageEvents = true;
  });
  await exportBackup(a, nextPassword);
  await expect(button(a, '确认文件已保存')).toBeVisible();
  const first = await b.evaluate(() =>
    JSON.parse(localStorage.getItem('cardpulse.backup-reminder')),
  );
  await rekey(b, nextPassword, thirdPassword);
  const second = await b.evaluate(() =>
    JSON.parse(localStorage.getItem('cardpulse.backup-reminder')),
  );
  expect(second.reason).toBe(first.reason);
  expect(second.lastConfirmedOn).toBe(first.lastConfirmedOn);
  expect(second.revision).not.toBe(first.revision);
  await button(a, '确认文件已保存').click();
  await expect(button(a, '确认文件已保存')).toBeHidden();
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '暂无记录',
  );
  expect(
    await a.evaluate(() =>
      JSON.parse(localStorage.getItem('cardpulse.backup-reminder')),
    ),
  ).toEqual(second);
  // A fresh export using the latest password can still clear the reminder.
  await exportBackup(a, thirdPassword);
  await button(a, '确认文件已保存').click();
  await expect(reminder(a)).not.toContainText('保险库密码已修改');
  await expect(reminder(a).locator('.backup-history')).toContainText(
    '2026-11-05',
  );
});

test('backup confirmation remains usable for this session when both metadata reads and writes are blocked', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-05T04:00:00Z'));
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'cardpulse.backup-reminder')
        throw new DOMException('blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cardpulse.backup-reminder')
        throw new DOMException('blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await importRow(page);
  await exportBackup(page, password);
  await button(page, '取消确认').click();
  await expect(reminder(page).locator('.backup-history')).toContainText(
    '暂无记录',
  );
  await exportBackup(page, password);
  await button(page, '确认文件已保存').click();
  await expect(reminder(page).locator('.backup-history')).toContainText(
    '2026-11-05',
  );
  await expect(reminder(page)).toContainText('本次记录仅在当前页面有效');
  await exportBackup(page, password);
  await button(page, '确认文件已保存').click();
  await expect(reminder(page).locator('.backup-history')).toContainText(
    '2026-11-05',
  );
  await expect(page.getByRole('status')).toContainText('有未保存的修改');
});

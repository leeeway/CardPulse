import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encryptData } from '../src/core/crypto.js';
import { decryptWorkspace, parseBackup, serializeBackup } from '../src/core/backup.js';
import { getHongKongDate } from '../src/core/rewards.js';
import { emptyWorkspace } from '../src/core/workspace.js';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'cardpulse-vault-recovery-')));
const vaultFile = join(profile, 'vault.cardpulse');
const sourceFile = join(profile, 'old-export.cardpulse');
const failedCopyFile = join(profile, 'failed-copy.cardpulse');
const failedRestoreCopy = join(profile, 'copy-before-failed-restore.cardpulse');
const safetyCopyFile = join(profile, 'before-restore.cardpulse');
const damagedCopyFile = join(profile, 'damaged-before-restore.cardpulse');
const password = 'desktop recovery smoke password';
const backupPassword = 'legacy backup smoke password';
const date = getHongKongDate();
const binary = process.env.CARDPULSE_DESKTOP_EXECUTABLE;
const temporaryFiles = async () =>
  (await readdir(profile)).filter((name) => /^vault\.cardpulse\..+\.tmp$/.test(name));
const launch = () => electron.launch({
  ...(binary ? { executablePath: binary } : {}),
  args: [
    ...(binary ? [] : [resolve('desktop/main.cjs')]),
    `--user-data-dir=${profile}`,
    '--disable-gpu',
  ],
  timeout: 30000,
});

let app;
let page;
const button = (name) => page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const rateField = () => page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true });
const fillPassword = (value) => dialog().getByLabel('主密码', { exact: true }).fill(value);
const unlock = async (value) => {
  await button('解锁本地库').click();
  await fillPassword(value);
  await button('解锁数据').click();
};
const applyRate = async (value) => {
  await rateField().fill(value);
  await button('应用手动汇率').click();
};
const submitSave = async () => {
  await button('保存到加密库').click();
  await fillPassword(password);
  await button('加密保存').click();
};
const readSaved = async (file, value) =>
  decryptWorkspace(parseBackup(await readFile(file, 'utf8')), value);
const stubBackupDialogs = async (saveTo, { failCopy = false } = {}) => {
  await app.evaluate(({ dialog }, { sourceFile, saveTo, failCopy }) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourceFile] });
    dialog.showSaveDialog = async () =>
      saveTo ? { canceled: false, filePath: saveTo } : { canceled: true };
    if (failCopy) {
      const copy = fs.copyFile;
      fs.copyFile = async (from, to, ...args) => {
        if (to !== saveTo) return copy(from, to, ...args);
        fs.copyFile = copy;
        throw new Error('ENOSPC: synthetic vault safety-copy failure');
      };
    }
  }, { sourceFile, saveTo, failCopy });
};

try {
  app = await launch();
  page = await app.firstWindow();
  await applyRate('0.91');
  await submitSave();
  await expect(dialog()).toBeHidden();
  const firstSave = await readFile(vaultFile);

  // Fail a real native write after it wrote the temporary ciphertext and
  // before it renames it. The workspace and the last committed file survive.
  await app.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const open = fs.open;
    fs.open = async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (flags === 'wx' && /vault\.cardpulse\..+\.tmp$/.test(file)) {
        fs.open = open;
        handle.sync = async () => { throw new Error('ENOSPC: synthetic vault flush failure'); };
      }
      return handle;
    };
  });
  await applyRate('0.92');
  await submitSave();
  await expect(dialog().getByRole('alert')).toContainText('synthetic vault flush failure');
  assert.deepEqual(await readFile(vaultFile), firstSave);
  assert.deepEqual(await temporaryFiles(), []);
  await button('取消').click();
  await expect(page.getByRole('status')).toContainText('有未保存的修改');
  await expect(rateField()).toHaveValue('0.92');
  await submitSave();
  await expect(dialog()).toBeHidden();
  const lastGoodSave = await readFile(vaultFile);
  assert.equal((await readSaved(vaultFile, password)).exchangeRate.rate, 0.92);

  // Stop the next native rename immediately before publication. Normal close
  // must wait for the operation; force-kill leaves the old committed file.
  await app.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (to.endsWith('vault.cardpulse')) {
        globalThis.__vaultReadyToPublish = true;
        await new Promise(() => {});
      }
      return rename(from, to);
    };
  });
  await applyRate('0.93');
  await submitSave();
  await expect.poll(() => app.evaluate(() => globalThis.__vaultReadyToPublish)).toBe(true);
  await app.evaluate(({ BrowserWindow, dialog }) => {
    // Fail explicitly if the UI falls back to an unsaved-changes confirmation.
    dialog.showMessageBoxSync = () => 1;
    BrowserWindow.getAllWindows()[0].close();
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().length), 1);
  assert.equal((await temporaryFiles()).length, 1);
  assert.deepEqual(await readFile(vaultFile), lastGoodSave);
  const runningApp = app.process();
  const exited = once(runningApp, 'exit');
  assert.equal(runningApp.kill('SIGKILL'), true);
  await exited;
  app = null;

  const legacyRate = { rate: 10001, date, source: 'Frankfurter' };
  const restoredWorkspace = {
    ...emptyWorkspace(),
    transactions: [{
      id: 'backup-transaction',
      day: date,
      description: 'SYNTHETIC BACKUP TRANSACTION',
      amount: '12.34',
      currency: 'HKD',
      direction: 'debit',
    }],
    exchangeRate: legacyRate,
  };
  const source = serializeBackup(await encryptData(restoredWorkspace, backupPassword));
  await writeFile(sourceFile, source, { mode: 0o600 });
  app = await launch();
  page = await app.firstWindow();
  await unlock(password);
  await expect(rateField()).toHaveValue('0.92');
  assert.deepEqual(await temporaryFiles(), []);
  assert.deepEqual(await readFile(vaultFile), lastGoodSave);

  // Cancel the confirmation when edits are open, then simulate cancellation,
  // write failure and a name collision in the native safety-copy dialog.
  await applyRate('0.94');
  await stubBackupDialogs(null);
  await button('恢复加密备份').click();
  await fillPassword('incorrect');
  await button('确认恢复').click();
  await expect(dialog().getByRole('alert')).toContainText('备份密码不正确或文件已损坏');
  await fillPassword(backupPassword);
  let warning;
  page.once('dialog', async (prompt) => {
    warning = prompt.message();
    await prompt.dismiss();
  });
  await button('确认恢复').click();
  await expect(button('确认恢复')).toBeEnabled();
  assert.match(warning, /有未保存的修改或草稿/);
  await expect(rateField()).toHaveValue('0.94');
  await page.evaluate(() => { window.confirm = () => true; });
  await button('确认恢复').click();
  await expect(dialog().getByRole('alert')).toContainText('本地保险库未替换');
  await stubBackupDialogs(failedCopyFile, { failCopy: true });
  await button('确认恢复').click();
  await expect(dialog().getByRole('alert')).toContainText('synthetic vault safety-copy failure');
  await stubBackupDialogs(sourceFile);
  await button('确认恢复').click();
  await expect(dialog().getByRole('alert')).toContainText('请选择尚不存在的备份文件名');
  assert.equal(await readFile(sourceFile, 'utf8'), source);
  assert.deepEqual(await readFile(vaultFile), lastGoodSave);
  await expect(rateField()).toHaveValue('0.94');
  assert.ok(!(await readdir(profile)).includes('failed-copy.cardpulse'));
  await stubBackupDialogs(failedRestoreCopy);
  await app.evaluate((_, vaultFile) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (to !== vaultFile) return rename(from, to);
      fs.rename = rename;
      throw new Error('EIO: synthetic restore publish failure');
    };
  }, vaultFile);
  await button('确认恢复').click();
  await expect(dialog().getByRole('alert')).toContainText('synthetic restore publish failure');
  assert.deepEqual(await readFile(vaultFile), lastGoodSave);
  assert.deepEqual(await readFile(failedRestoreCopy), lastGoodSave);
  assert.deepEqual(await temporaryFiles(), []);
  await stubBackupDialogs(safetyCopyFile);
  await button('确认恢复').click();
  await expect(dialog()).toBeHidden();
  await expect(page.getByRole('status')).toContainText('已移除旧版备份中的异常汇率');
  assert.deepEqual(await readFile(safetyCopyFile), lastGoodSave);
  assert.equal((await readSaved(safetyCopyFile, password)).exchangeRate.rate, 0.92);
  const restored = await readSaved(vaultFile, backupPassword);
  assert.equal(restored.exchangeRate, null);
  assert.deepEqual(restored.transactions, restoredWorkspace.transactions);
  await app.close();
  app = null;

  // A malformed active file used to disable the restore button altogether.
  const damaged = Buffer.from('synthetic truncated vault');
  await writeFile(vaultFile, damaged);
  app = await launch();
  page = await app.firstWindow();
  await unlock(password);
  await expect(dialog().getByRole('alert')).toContainText('本地库文件格式无效');
  await button('取消').click();
  await stubBackupDialogs(damagedCopyFile);
  await page.evaluate(() => { window.confirm = () => true; });
  await button('恢复加密备份').click();
  await fillPassword(backupPassword);
  await button('确认恢复').click();
  await expect(dialog()).toBeHidden();
  assert.deepEqual(await readFile(damagedCopyFile), damaged);
  assert.deepEqual(await readSaved(vaultFile, backupPassword), restored);
  await app.close();
  app = null;
  app = await launch();
  page = await app.firstWindow();
  await unlock(backupPassword);
  await expect(dialog()).toBeHidden();
  await expect(page.locator('tbody')).toContainText('SYNTHETIC BACKUP TRANSACTION');
  console.log('PASS: native vault save failure, retry, close protection, force-kill recovery, and non-destructive backup restore.');
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}

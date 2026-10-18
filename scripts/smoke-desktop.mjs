import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { makeEncryptedStatementPdf } from '../tests/browser/fixtures.js';

const profile = await mkdtemp(join(tmpdir(), 'cardpulse-desktop-'));
let application;
const binary = process.env.CARDPULSE_DESKTOP_EXECUTABLE;
const appPath = resolve('desktop/main.cjs');
const screenshots = resolve('.qa');
await mkdir(screenshots, { recursive: true });
const launch = () =>
  electron.launch({
    ...(binary
      ? {
          executablePath: binary,
          args: [`--user-data-dir=${profile}`, '--disable-gpu'],
        }
      : { args: [appPath, `--user-data-dir=${profile}`, '--disable-gpu'] }),
    timeout: 30000,
  });
try {
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  await page.getByRole('heading', { name: '银行工作区' }).waitFor();
  assert.equal(
    await page.evaluate(() => window.isSecureContext && Boolean(crypto.subtle)),
    true,
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  assert.equal(
    await page.evaluate(() => typeof window.cardpulseDesktop.readVault),
    'function',
  );
  await page.waitForFunction(
    () => !document.querySelector('[type=file][accept=".pdf,.csv"]').disabled,
  );
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'native-statement.pdf',
    mimeType: 'application/pdf',
    buffer: makeEncryptedStatementPdf(),
  });
  await page.locator('input[type="password"]').fill('wrong password');
  await page.getByRole('button', { name: '继续解析', exact: true }).click();
  await page.getByText('结单密码错误', { exact: true }).waitFor();
  await page.locator('input[type="password"]').fill('pdf-password');
  await page.getByRole('button', { name: '继续解析', exact: true }).click();
  await page.getByText('已导入 1 笔交易', { exact: false }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('button', { name: '核对交易', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('支付渠道', { exact: true })
    .selectOption('applePay');
  await page.getByRole('button', { name: '应用修正', exact: true }).click();
  assert.match(await page.locator('tbody tr').innerText(), /已人工修正/);
  await page
    .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
    .fill('0.93');
  await page.getByRole('button', { name: '应用手动汇率', exact: true }).click();
  await page.getByRole('button', { name: '保存到加密库', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page.getByRole('button', { name: '加密保存', exact: true }).click();
  await page.getByText('已加密保存到本地保险库', { exact: false }).waitFor();
  const file = await readFile(join(profile, 'vault.cardpulse'), 'utf8');
  assert.ok(!file.includes('TEST SHOP'));
  assert.ok(!file.includes('native vault password'));
  assert.match(file, /CardPulseVault/);
  assert.deepEqual(external, []);
  await page.reload();
  await page.getByRole('button', { name: '解锁本地库', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.locator('tbody tr').first().waitFor();
  assert.equal(
    await page
      .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
      .inputValue(),
    '0.93',
  );
  const backupPath = join(profile, 'test-backup.cardpulse');
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backupPath);
  await page.getByRole('button', { name: '导出加密备份', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.match(await readFile(backupPath, 'utf8'), /CardPulseVault/);
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByRole('button', { name: '清空数据', exact: true }).click();
  await page.getByText('已清空交易及本地保险库', { exact: false }).waitFor();
  await page.getByRole('button', { name: '恢复加密备份', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('wrong backup password');
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('tbody tr').count(), 0);
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.getByText('已恢复加密备份', { exact: false }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('button', { name: '核对交易', exact: true }).click();
  assert.equal(
    await page
      .getByRole('dialog')
      .getByLabel('支付渠道', { exact: true })
      .inputValue(),
    'applePay',
  );
  await page.locator('.review-history summary').click();
  assert.match(await page.getByRole('dialog').innerText(), /待确认渠道/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.screenshot({
    path: join(screenshots, 'desktop-smoke.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await application.close();
  application = null;
  application = await launch();
  page = await application.firstWindow();
  await page.getByRole('button', { name: '解锁本地库', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 0);
  await page.getByRole('button', { name: '解锁本地库', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.locator('tbody tr').first().waitFor();
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByText('查看结单与对账', { exact: false }).click();
  await page.getByRole('button', { name: '删除结单', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 0);
  await page.getByRole('button', { name: '保存到加密库', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page.getByRole('button', { name: '加密保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: '解锁本地库', exact: true }).click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('native vault password');
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('tbody tr').count(), 0);
  assert.equal(await page.locator('.statement-row').count(), 0);
  console.log(
    'PASS: Electron secure origin, isolated renderer, packaged PDF worker, offline startup/import, encrypted PDF password retry, native encrypted file, manual FX persistence, backup/export/restore, transaction review history, statement deletion, reload and full application restart.',
  );
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true });
}

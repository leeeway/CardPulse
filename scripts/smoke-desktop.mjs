import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { makeEncryptedStatementPdf } from '../tests/browser/fixtures.js';
import { parseBackup, decryptWorkspace } from '../src/core/backup.js';

const profile = await mkdtemp(join(tmpdir(), 'cardpulse-desktop-'));
let application;
let vaultPassword = 'native vault password';
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
  const buildPanel = page.locator('.build-info');
  await buildPanel.locator('summary').click();
  const publicReport = await buildPanel
    .getByLabel('构建信息文本', { exact: true })
    .inputValue();
  assert.equal(JSON.parse(publicReport).mode, 'production');
  // Stub writes to avoid changing the user's system clipboard during this smoke test.
  await application.evaluate(({ clipboard }) => {
    globalThis.__originalBuildClipboard = clipboard.writeText;
    clipboard.writeText = (text) => {
      globalThis.__copiedBuildReport = text;
    };
  });
  try {
    await buildPanel
      .getByRole('button', { name: '复制构建信息', exact: true })
      .click();
    await page.getByText('构建信息已复制', { exact: true }).waitFor();
    assert.equal(
      await application.evaluate(() => globalThis.__copiedBuildReport),
      publicReport,
    );
  } finally {
    await application.evaluate(({ clipboard }) => {
      clipboard.writeText = globalThis.__originalBuildClipboard;
      delete globalThis.__originalBuildClipboard;
      delete globalThis.__copiedBuildReport;
    });
  }
  await buildPanel.locator('summary').click();
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
  await page.getByText('Pulse 计算明细', { exact: true }).click();
  await page.getByText('Pulse 逐笔说明', { exact: true }).click();
  await page
    .getByText('计入人民币基础、年度及半年额外奖赏', { exact: true })
    .waitFor();
  await page.getByText('Pulse 逐笔说明', { exact: true }).click();
  await page
    .locator('.pulse-breakdown .explanation-table')
    .waitFor({ state: 'detached' });

  await page.getByLabel('选择活动规则文件', { exact: true }).setInputFiles({
    name: 'native-rules.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'CardPulseCampaigns',
        version: 3,
        campaigns: [
          {
            name: 'Native rule template',
            bankId: 'hsbc',
            cardId: 'hsbc_pulse',
            currency: 'CNY',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            ratePercent: '0',
            rewardType: 'progressive',
            tiers: [
              { from: '0', ratePercent: '1' },
              { from: '1000', ratePercent: '3' },
            ],
            period: 'statement',
            statementDay: '25',
            dateBasis: 'posting',
            channel: 'any',
            spendingCap: '',
            rewardCap: '',
            minSpend: '',
            merchant: '',
          },
        ],
      }),
    ),
  });
  await page
    .getByRole('dialog', { name: '预览活动规则', exact: true })
    .waitFor();
  assert.equal(await page.locator('.activity-card').count(), 0);
  await page.getByRole('button', { name: '确认新增活动', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.match(await page.locator('.activity-card').innerText(), /未确认资格/);
  await page
    .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
    .fill('0.93');
  await page.getByRole('button', { name: '应用手动汇率', exact: true }).click();
  await page.getByRole('button', { name: '保存到加密库', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '加密保存', exact: true }).click();
  await page.getByText('已加密保存到本地保险库', { exact: false }).waitFor();
  const file = await readFile(join(profile, 'vault.cardpulse'), 'utf8');
  assert.ok(!file.includes('TEST SHOP'));
  assert.ok(!file.includes('native vault password'));
  assert.match(file, /CardPulseVault/);
  assert.deepEqual(external, []);
  await page.reload();
  await page.getByRole('button', { name: '解锁本地库', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.locator('tbody tr').first().waitFor();
  assert.match(
    await page.locator('.activity-card').innerText(),
    /Native rule template/,
  );
  await page.getByRole('button', { name: '编辑活动', exact: true }).click();
  assert.equal(
    await page.getByLabel('第 2 段起点', { exact: true }).inputValue(),
    '1000',
  );
  assert.equal(
    await page.getByLabel('第 2 段费率（%）', { exact: true }).inputValue(),
    '3',
  );
  assert.equal(
    await page.getByLabel('每月结单日', { exact: true }).inputValue(),
    '25',
  );
  await page
    .locator('.campaign-form')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
      .inputValue(),
    '0.93',
  );
  const backupPath = join(profile, 'test-backup.cardpulse');
  // Cancelling the native chooser or rejecting an unsafe path must not record a backup.
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await page.getByRole('button', { name: '导出加密备份', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  const exportButton = page
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true });
  await exportButton.click();
  await page.waitForFunction(
    () => !document.querySelector('[role=dialog] [type=submit]').disabled,
  );
  assert.match(await page.locator('.backup-history').innerText(), /暂无记录/);
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await application.evaluate(
    ({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    join(profile, 'vault.cardpulse'),
  );
  await exportButton.click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.locator('.backup-history').innerText(), /暂无记录/);
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backupPath);
  await exportButton.click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.match(await readFile(backupPath, 'utf8'), /CardPulseVault/);
  assert.doesNotMatch(
    await page.locator('.backup-history').innerText(),
    /暂无记录/,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '确认文件已保存', exact: true })
      .count(),
    0,
  );
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
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.getByText('已恢复加密备份', { exact: false }).waitFor();
  assert.match(
    await page.locator('.backup-reminder').innerText(),
    /已恢复备份/,
  );
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
  await page
    .getByRole('button', { name: '修改保险库密码', exact: true })
    .click();
  await page.getByLabel('当前密码', { exact: true }).fill(vaultPassword);
  await page
    .getByLabel('新密码', { exact: true })
    .fill('updated native vault password');
  await page
    .getByLabel('确认新密码', { exact: true })
    .fill('updated native vault password');
  await page.getByRole('button', { name: '确认修改密码', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.match(
    await page.locator('.backup-reminder').innerText(),
    /保险库密码已修改/,
  );
  const changedPayload = parseBackup(
    await readFile(join(profile, 'vault.cardpulse'), 'utf8'),
  );
  await assert.rejects(decryptWorkspace(changedPayload, vaultPassword));
  const changedWorkspace = await decryptWorkspace(
    changedPayload,
    'updated native vault password',
  );
  assert.equal(changedWorkspace.transactions.length, 1);
  assert.equal(
    (
      await decryptWorkspace(
        parseBackup(await readFile(backupPath, 'utf8')),
        vaultPassword,
      )
    ).transactions.length,
    1,
  );
  vaultPassword = 'updated native vault password';
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
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.locator('tbody tr').first().waitFor();
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByText('查看结单与对账', { exact: false }).click();
  await page.getByRole('button', { name: '删除结单', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 0);
  await page.getByRole('button', { name: '保存到加密库', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '加密保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: '解锁本地库', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('tbody tr').count(), 0);
  assert.equal(await page.locator('.statement-row').count(), 0);
  await page.clock.install({ time: new Date('2026-11-05T04:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-05T04:00:01Z'));
  await page.getByLabel('空闲锁定时限').selectOption('5');
  await page.clock.fastForward(5 * 60_000);
  await page.getByRole('button', { name: '解锁本地库', exact: true }).waitFor();
  assert.match(await page.getByRole('status').innerText(), /已因空闲自动锁定/);
  await page.getByRole('button', { name: '解锁本地库', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill(vaultPassword);
  await page.getByRole('button', { name: '解锁数据', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('空闲锁定时限').inputValue(), '5');
  assert.equal(await page.locator('tbody tr').count(), 0);
  console.log(
    'PASS: Electron secure origin, isolated renderer, packaged PDF worker, offline startup/import, encrypted PDF password retry, native encrypted file, manual FX persistence, backup/export/restore, native backup confirmation and cancellation, password changes and old backup compatibility, Pulse calculation explanations, transaction review history, statement deletion, reload, full application restart, idle lock/unlock, and campaign rule imports.',
  );
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true });
}

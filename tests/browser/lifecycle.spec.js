import { confirmStatementImport } from './import-preview.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  encryptWorkspace,
  serializeBackup,
  decryptWorkspace,
  parseBackup,
} from '../../src/core/backup.js';
import { emptyWorkspace } from '../../src/core/workspace.js';
import { encryptData } from '../../src/core/crypto.js';

const savedCampaign = {
  id: 'saved-campaign',
  name: 'Saved campaign',
  bankId: 'hsbc',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  ratePercent: '2',
  period: 'monthly',
  dateBasis: 'posting',
  channel: 'any',
};

test('closing protects unapplied FX and campaign drafts', async ({ page }) => {
  await page.goto('/');
  const guarded = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  const rate = page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true });
  await expect(rate).toBeEnabled();
  expect(await guarded()).toBe(false);
  await rate.fill('0.93');
  await expect.poll(guarded).toBe(true);
  await rate.fill('');
  await expect.poll(guarded).toBe(false);
  await page.getByRole('button', { name: '添加活动', exact: true }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('Unsaved fixture');
  await expect.poll(guarded).toBe(true);
  await page.locator('.campaign-form').getByRole('button', { name: '取消' }).click();
  await expect.poll(guarded).toBe(false);
});

test('an out-of-range online rate cannot prevent reopening the vault', async ({
  page,
}) => {
  const password = 'old fixture password';
  const payload = await encryptData(
    {
      ...emptyWorkspace(),
      transactions: [
        {
          id: 'old-refund',
          day: '2026-01-01',
          description: 'OLD REFUND',
          amount: '100.00',
          currency: 'HKD',
          direction: 'credit',
        },
      ],
      exchangeRate: { rate: 10001, source: 'Frankfurter', date: '2026-01-01' },
    },
    password,
  );
  await page.route('https://api.frankfurter.dev/**', (route) =>
    route.fulfill({ json: { rate: 10001, date: '2026-01-02' } }),
  );
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  // Recreate the ciphertext written by the older app, prior to validation.
  await page.evaluate((value) => new Promise((resolve, reject) => {
    const request = indexedDB.open('CardPulse_DB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('vault', 'readwrite');
      tx.objectStore('vault').put({ id: 'vault_payload', payload: value });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), payload);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const unlock = async () => {
    await button('解锁本地库').click();
    await page.getByLabel('主密码', { exact: true }).fill(password);
    await button('解锁数据').click();
    await expect(page.getByRole('dialog')).toBeHidden();
  };
  const status = page.locator('.workspace-status');
  await page.reload();
  await unlock();
  await expect(status).toContainText('已移除旧版保存的异常汇率');
  await page.getByLabel('分类', { exact: true }).selectOption('credit');
  await expect(page.locator('.transactions-section tbody')).toContainText('OLD REFUND');
  const rate = page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true });
  await rate.fill('0.93');
  await button('应用手动汇率').click();
  await button('联网更新参考汇率').click();
  await expect(status).toContainText('汇率暂不可用');
  await expect(rate).toHaveValue('0.93');
  await button('保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button('加密保存').click();
  await expect(status).toContainText('已加密保存到本地保险库');
  await page.reload();
  await unlock();
  await expect(rate).toHaveValue('0.93');
  await expect(page.locator('.transactions-section tbody')).toContainText('OLD REFUND');
});

test('lock, clear and successful restore discard campaign editor drafts', async ({
  page,
}) => {
  const backup = serializeBackup(
    await encryptWorkspace(
      { ...emptyWorkspace(), campaigns: [savedCampaign] },
      'lifecycle-password',
    ),
  );
  const button = (name) => page.getByRole('button', { name, exact: true });
  const restore = async () => {
    await page.locator('input[accept=".cardpulse"]').setInputFiles({
      name: 'restore.cardpulse',
      mimeType: 'application/json',
      buffer: Buffer.from(backup),
    });
    await page.getByLabel('主密码', { exact: true }).fill('lifecycle-password');
    page.once('dialog', (dialog) => dialog.accept());
    await button('确认恢复').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  const draft = async (name) => {
    await button('添加活动').click();
    await page
      .locator('.campaign-form')
      .getByLabel('活动名称', { exact: true })
      .fill(name);
  };
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await restore();
  await draft('PRIVATE LOCK DRAFT');
  page.once('dialog', (dialog) => dialog.dismiss());
  await button('锁定保险库').click();
  await expect(page.getByLabel('活动名称', { exact: true })).toHaveValue(
    'PRIVATE LOCK DRAFT',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await button('锁定保险库').click();
  await expect(page.locator('.campaign-form')).toHaveCount(0);
  await button('解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill('lifecycle-password');
  await button('解锁数据').click();
  await expect(page.locator('.activity-card')).toContainText('Saved campaign');
  await expect(page.locator('.campaign-form')).toHaveCount(0);
  await draft('PRIVATE CLEAR DRAFT');
  page.once('dialog', (dialog) => dialog.accept());
  await button('清空数据').click();
  await expect(page.locator('.activity-card')).toHaveCount(0);
  await expect(page.locator('.campaign-form')).toHaveCount(0);
  await draft('PRIVATE RESTORE DRAFT');
  await page.locator('input[accept=".cardpulse"]').setInputFiles({
    name: 'restore.cardpulse',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await page.getByLabel('主密码', { exact: true }).fill('wrong');
  await button('确认恢复').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(
    page.locator('.campaign-form').getByLabel('活动名称', { exact: true }),
  ).toHaveValue('PRIVATE RESTORE DRAFT');
  await restore();
  await expect(page.locator('.campaign-form')).toHaveCount(0);
  await expect(page.locator('.activity-card')).toContainText('Saved campaign');
});

test('deleting the only unsaved import returns to a clean empty workspace', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'unsaved.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction\n2026-10-01,EXAMPLE,100.00,CNY,debit',
    ),
  });
  await confirmStatementImport(page);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByText('查看结单与对账', { exact: false }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除结单', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('status')).not.toContainText('有未保存的修改');
  await expect(page.getByRole('status')).not.toContainText('请保存到加密库');
  await expect(
    page.getByRole('button', { name: '保存到加密库', exact: true }),
  ).toHaveCount(0);
});

test('a manual-rate-only workspace can be exported before its first vault save', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '应用手动汇率', exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('参考汇率（1 HKD = CNY）', { exact: true })
    .fill('0.93');
  await page.getByRole('button', { name: '应用手动汇率', exact: true }).click();
  await page.getByRole('button', { name: '导出加密备份', exact: true }).click();
  await page.getByLabel('主密码', { exact: true }).fill('rate-password');
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '导出加密备份', exact: true })
    .click();
  const backup = await readFile(await (await downloaded).path(), 'utf8');
  const restored = await decryptWorkspace(parseBackup(backup), 'rate-password');
  expect(restored.exchangeRate.rate).toBe(0.93);
  expect(restored.transactions).toEqual([]);
});

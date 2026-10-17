import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { makeStatementPdf } from './fixtures.js';

test('multi-bank workspace, custom rewards, preferences, and encrypted persistence', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.frankfurter.dev/**', (route) =>
    route.fulfill({ json: { rate: 0.92, date: '2026-10-16' } }),
  );
  const button = (name) => page.getByRole('button', { name, exact: true });
  const text = async (str) =>
    page.getByText(str, { exact: false }).first().waitFor();
  const csv =
    'day,transactionDay,description,amount,currency,direction,category,last4,channel\n2026-10-01,2026-10-01,MY ONLINE SHOP,1000.00,HKD,debit,spend,1234,online\n2026-10-02,2026-10-01,MY ONLINE SHOP,100.00,HKD,credit,credit,1234,online\n2026-10-03,2026-10-03,ANNUAL FEE,20.00,HKD,debit,fee,1234,standard';
  await page.goto('/');
  await page.waitForFunction(
    () => !document.querySelector('input[accept=".pdf,.csv"]').disabled,
  );
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'boc.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
  await text('已导入 3 笔交易');
  assert.equal(await page.locator('tbody tr').count(), 3);
  await button('添加活动').click();
  const form = page.locator('.campaign-form');
  await form
    .getByLabel('活动名称', { exact: true })
    .fill('October shop reward');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('4');
  await form.getByLabel('每周期消费上限', { exact: true }).fill('1000');
  await form.getByLabel('每周期奖赏上限', { exact: true }).fill('50');
  await form.getByLabel('每周期净消费门槛', { exact: true }).fill('100');
  await form.getByLabel('渠道', { exact: true }).selectOption('online');
  await form.getByLabel('卡号末四位', { exact: true }).fill('1234');
  await form.getByRole('checkbox').check();
  await button('保存活动').click();
  await text('October shop reward');
  assert.match(
    await page.locator('.activity-card .reward-card-value').innerText(),
    /36\.00/,
  );
  await page.locator('.bank-tile').filter({ hasText: '中银香港' }).click();
  assert.equal(
    await page.getByRole('region', { name: 'Pulse 内置估算' }).count(),
    0,
  );
  assert.equal(await page.locator('tbody tr').count(), 3);
  await page.locator('.bank-tile').filter({ hasText: '花旗' }).click();
  assert.equal(await page.locator('tbody tr').count(), 0);
  await page.locator('.bank-tile').filter({ hasText: '全部银行' }).click();
  await page.getByLabel('导入银行', { exact: true }).selectOption('hsbc');
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'plain.pdf',
      mimeType: 'application/pdf',
      buffer: makeStatementPdf(),
    });
  await text('plain.pdf：已导入 1 笔交易');
  assert.equal(await page.locator('.activity-card').count(), 1);
  assert.equal(await page.locator('tbody tr').count(), 4);
  await page.getByLabel('网站配色', { exact: true }).selectOption('light');
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await text('銀行工作區');
  await text('自訂活動');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-TW');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.match(
    await page.locator('.activity-card').innerText(),
    /October shop reward/,
  );
  await button('儲存至加密資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('加密儲存').click();
  await text('已加密儲存至本機保險庫');
  await page.screenshot({
    path: testInfo.outputPath('workspace-light.png'),
    fullPage: true,
  });
  await page.reload();
  await button('解鎖本機資料庫').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('tbody tr').count(), 0);
  assert.equal(await page.locator('.activity-card').count(), 0);
  await button('解鎖本機資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('wrong');
  await button('解鎖資料').click();
  await text('密碼不正確或資料已損壞');
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('解鎖資料').click();
  await text('October shop reward');
  assert.equal(await page.locator('tbody tr').count(), 4);
  assert.match(
    await page.locator('.activity-card .reward-card-value').innerText(),
    /36\.00/,
  );
  const downloadEvent = page.waitForEvent('download');
  await button('匯出 CSV').click();
  assert.match((await downloadEvent).suggestedFilename(), /CardPulse/);
  await button('編輯活動').click();
  await page
    .locator('.campaign-form')
    .getByLabel('回贈比例（%）', { exact: true })
    .fill('5');
  await button('儲存活動').click();
  assert.match(
    await page.locator('.activity-card .reward-card-value').innerText(),
    /45\.00/,
  );
  await button('儲存至加密資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('加密儲存').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  for (const theme of ['navy', 'ruby', 'jade']) {
    await page.getByLabel('網站配色', { exact: true }).selectOption(theme);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  }
  await page.screenshot({
    path: testInfo.outputPath('workspace-jade.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('workspace-mobile.png'),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await button('鎖定保險庫').click();
  assert.equal(await page.getByText('October shop reward').count(), 0);
  await button('解鎖本機資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('解鎖資料').click();
  await text('October shop reward');
  page.once('dialog', (dialog) => dialog.accept());
  await button('刪除活動').click();
  assert.equal(await page.locator('.activity-card').count(), 0);
  page.once('dialog', (dialog) => dialog.accept());
  await button('清除資料').click();
  await text('已清除交易及本機保險庫');
  assert.equal(await page.locator('tbody tr').count(), 0);
  await button('新增活動').click();
  await page
    .locator('.campaign-form')
    .getByLabel('活動名稱', { exact: true })
    .fill('Campaign only vault');
  await page
    .locator('.campaign-form')
    .getByLabel('回贈比例（%）', { exact: true })
    .fill('1');
  await button('儲存活動').click();
  await button('儲存至加密資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('加密儲存').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  page.once('dialog', (dialog) => dialog.accept());
  await button('刪除活動').click();
  assert.equal(await button('儲存至加密資料庫').isVisible(), true);
  await button('儲存至加密資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('加密儲存').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await button('解鎖本機資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill('workspace-pass');
  await button('解鎖資料').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.activity-card').count(), 0);
  page.once('dialog', (dialog) => dialog.accept());
  await button('清除資料').click();
  await text('已清除交易及本機保險庫');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: multi-bank CSV + PDF import, bank filters, campaign creation/edit/calculation/deletion, campaign persistence, save/unlock/wrong password, zh-CN/zh-TW switching, all 4 themes, preference restoration, CSV export, mobile layout, clear, saving deletion of the last activity in a campaign-only vault; no page errors.',
  );
});

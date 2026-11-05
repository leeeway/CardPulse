import { test, expect } from '@playwright/test';

const password = 'synthetic idle vault password';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const idle = (page) => page.locator('.idle-lock-settings');
async function importRow(page, name = 'IDLE SHOP') {
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `day,description,amount,currency,direction\n2026-11-01,${name},100.00,CNY,debit`,
    ),
  });
}
async function save(page) {
  await button(page, '保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function unlock(page) {
  await button(page, '解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '解锁数据').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function setup(page) {
  await page.clock.install({ time: new Date('2026-11-05T04:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-05T04:00:01Z'));
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await importRow(page);
  await save(page);
}

test('idle locking is opt-in, respects activity, survives rerenders and checks sleep deadlines before new input', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByLabel('空闲锁定时限')).toHaveValue('0');
  await page.clock.fastForward(30 * 60_000);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(1);
  await page.getByLabel('空闲锁定时限').selectOption('5');
  await page.getByLabel('搜索商户、卡号或备注').fill('IDLE SHOP');
  await page.clock.fastForward(4 * 60_000);
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointermove')),
  );
  await page.clock.fastForward(4 * 60_000);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(1);
  // A reminder sync rerenders App but must not restart the idle timer.
  await page.evaluate(() => {
    localStorage.setItem(
      'cardpulse.backup-reminder',
      JSON.stringify({
        version: 1,
        lastConfirmedOn: '2026-11-05',
        reason: null,
        revision: crypto.randomUUID(),
      }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'cardpulse.backup-reminder' }),
    );
  });
  await expect(page.locator('.backup-history')).toContainText('2026-11-05');
  await page.clock.fastForward(60_000);
  await expect(button(page, '解锁本地库')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    '已因空闲自动锁定保险库',
  );
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(0);
  await expect(page.getByLabel('搜索商户、卡号或备注')).toHaveCount(0);
  await unlock(page);
  await expect(page.getByLabel('搜索商户、卡号或备注')).toHaveValue('');
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(1);
  await page.clock.setSystemTime(new Date('2026-11-05T08:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(button(page, '解锁本地库')).toBeVisible();
  await unlock(page);
  await page.clock.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  const consumed = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(consumed).toBe(true);
  await expect(button(page, '解锁本地库')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('空闲锁定时限')).toHaveValue('5');
  await unlock(page);
  await page.getByLabel('空闲锁定时限').selectOption('0');
  await page.clock.fastForward(60 * 60_000);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(1);
});

test('unsaved transactions, campaign and FX drafts, and open dialogs pause locking without losing work', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByLabel('空闲锁定时限').selectOption('5');
  await importRow(page, 'UNSAVED SHOP');
  await expect(idle(page)).toContainText('自动锁定暂缓');
  await page.clock.fastForward(10 * 60_000);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(2);
  await save(page);
  await expect(idle(page)).not.toContainText('自动锁定暂缓');
  await page.clock.fastForward(4 * 60_000);
  await button(page, '添加活动').click();
  const form = page.locator('.campaign-form');
  await form
    .getByLabel('活动名称', { exact: true })
    .fill('PRIVATE CAMPAIGN DRAFT');
  await page.clock.fastForward(10 * 60_000);
  await expect(form.getByLabel('活动名称', { exact: true })).toHaveValue(
    'PRIVATE CAMPAIGN DRAFT',
  );
  await expect(idle(page)).toContainText('自动锁定暂缓');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await page.clock.fastForward(4 * 60_000);
  await expect(button(page, '锁定保险库')).toBeVisible();
  const rate = page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true });
  await rate.fill('0.94');
  await expect(idle(page)).toContainText('自动锁定暂缓');
  await page.clock.fastForward(10 * 60_000);
  await expect(rate).toHaveValue('0.94');
  page.once('dialog', (dialog) => dialog.dismiss());
  await button(page, '锁定保险库').click();
  await expect(rate).toHaveValue('0.94');
  page.once('dialog', (dialog) => dialog.accept());
  await button(page, '锁定保险库').click();
  await expect(rate).toHaveValue('');
  await unlock(page);
  await expect(rate).toHaveValue('');
  await rate.fill('0.93');
  await button(page, '应用手动汇率').click();
  await save(page);
  await rate.fill('0.9300');
  await button(page, '应用手动汇率').click();
  await expect(rate).toHaveValue('0.93');
  await save(page);
  await expect(idle(page)).not.toContainText('自动锁定暂缓');
  await button(page, '修改保险库密码').click();
  await page
    .getByLabel('新密码', { exact: true })
    .fill('PRIVATE PASSWORD DRAFT');
  await page.clock.fastForward(10 * 60_000);
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue(
    'PRIVATE PASSWORD DRAFT',
  );
  await button(page, '取消').click();
  await page
    .locator('.transactions-section tbody tr')
    .first()
    .getByRole('button', { name: '核对交易' })
    .click();
  await page.clock.fastForward(10 * 60_000);
  await expect(
    page.getByRole('dialog', { name: '核对交易', exact: true }),
  ).toBeVisible();
  await button(page, '取消').click();
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(page.getByLabel('閒置鎖定時限')).toHaveValue('5');
  await page.setViewportSize({ width: 390, height: 844 });
  await idle(page).screenshot({ path: testInfo.outputPath('idle-mobile.png') });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.clock.fastForward(5 * 60_000);
  await expect(button(page, '解鎖本機資料庫')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    '已因閒置自動鎖定保險庫',
  );
});

test('an unsaved workspace cannot auto-lock and an in-flight reference rate request pauses the timer', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-05T04:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-05T04:00:01Z'));
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page.getByLabel('空闲锁定时限').selectOption('5');
  await importRow(page);
  await page.clock.fastForward(10 * 60_000);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(1);
  await expect(idle(page)).toContainText('仅在已保存并解锁');
  await save(page);
  let fulfill;
  let started;
  const requestStarted = new Promise((resolve) => (started = resolve));
  await page.route('https://api.frankfurter.dev/**', async (route) => {
    await new Promise((resolve) => {
      fulfill = resolve;
      started();
    });
    await route.fulfill({ json: { rate: 0.93, date: '2026-11-05' } });
  });
  await button(page, '联网更新参考汇率').click();
  await requestStarted;
  await expect(idle(page)).toContainText('自动锁定暂缓');
  await page.clock.fastForward(5_000);
  await expect(button(page, '锁定保险库')).toBeVisible();
  fulfill();
  await expect(
    page.getByLabel('参考汇率（1 HKD = CNY）', { exact: true }),
  ).toHaveValue('0.93');
  await save(page);
  await page.clock.fastForward(5 * 60_000);
  await expect(button(page, '解锁本地库')).toBeVisible();
});

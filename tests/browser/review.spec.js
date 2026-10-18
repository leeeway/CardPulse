import { test, expect } from '@playwright/test';

test('review recalculates rewards, persists history and removes only the selected statement', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-18T04:00:00Z'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const button = (name) => page.getByRole('button', { name, exact: true });
  const importFile = async (name, merchant, amount) => {
    const buffer = Buffer.from(
      `day,description,amount,currency,direction\n2026-10-01,${merchant},${amount},CNY,debit`,
    );
    await page
      .locator('input[accept=".pdf,.csv"]')
      .setInputFiles({ name, mimeType: 'text/csv', buffer });
    await expect(
      page.getByText(`${name}：已导入 1 笔交易`, { exact: true }),
    ).toBeVisible();
  };
  const save = async () => {
    await button('保存到加密库').click();
    await page.getByLabel('主密码', { exact: true }).fill('review-password');
    await button('加密保存').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  const reloadUnlock = async () => {
    await page.reload();
    await button('解锁本地库').click();
    await page.getByLabel('主密码', { exact: true }).fill('review-password');
    await button('解锁数据').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await importFile('first.csv', 'FIRST SHOP', '100.00');
  await importFile('second.csv', 'SECOND SHOP', '50.00');
  const first = page.locator('tbody tr').filter({ hasText: 'FIRST SHOP' });
  const total = page.locator('.primary-reward .reward-card-value');
  await expect(total).toContainText('3.60');
  await first.getByRole('button', { name: '核对交易' }).click();
  let dialog = page.getByRole('dialog', { name: '核对交易' });
  await dialog.getByLabel('支付渠道', { exact: true }).selectOption('applePay');
  await dialog.getByRole('button', { name: '应用修正' }).click();
  await expect(total).toContainText('5.60');
  await expect(first).toContainText('已人工修正');
  await first.getByRole('button', { name: '核对交易' }).click();
  await dialog.getByLabel('分类', { exact: true }).selectOption('fee');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(total).toContainText('5.60');
  await save();
  await reloadUnlock();
  await first.getByRole('button', { name: '核对交易' }).click();
  await expect(dialog.getByLabel('支付渠道', { exact: true })).toHaveValue(
    'applePay',
  );
  await dialog.locator('.review-history summary').click();
  await expect(dialog).toContainText('待确认渠道');
  // Background controls remain inert; native dialogs may tab to browser chrome.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest('dialog[open]')),
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await first.getByRole('button', { name: '核對交易' }).click();
  dialog = page.getByRole('dialog', { name: '核對交易' });
  await expect(dialog.getByRole('button', { name: '套用修正' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('review-mobile.png'),
    fullPage: true,
  });
  await expect(dialog).toBeInViewport();
  await page.keyboard.press('Escape');
  await page.getByLabel('語言', { exact: true }).selectOption('zh-CN');
  await page.getByText('查看结单与对账', { exact: false }).click();
  const firstStatement = page
    .locator('.statement-row')
    .filter({ hasText: 'first.csv' });
  page.once('dialog', (message) => message.dismiss());
  await firstStatement.getByRole('button', { name: '删除结单' }).click();
  await expect(first).toHaveCount(1);
  page.once('dialog', (message) => message.accept());
  await firstStatement.getByRole('button', { name: '删除结单' }).click();
  await expect(first).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(total).toContainText('1.20');
  await save();
  await reloadUnlock();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await importFile('first.csv', 'FIRST SHOP', '100.00');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(total).toContainText('3.60');
  const second = page.locator('tbody tr').filter({ hasText: 'SECOND SHOP' });
  await second.getByRole('button', { name: '核对交易' }).click();
  const categoryDialog = page.getByRole('dialog', { name: '核对交易' });
  await categoryDialog.getByLabel('分类', { exact: true }).selectOption('fee');
  await categoryDialog.getByRole('button', { name: '应用修正' }).click();
  await expect(total).toContainText('2.40');
  await save();
  await reloadUnlock();
  await expect(second).toContainText('费用 / 利息');
  await page.getByText('查看结单与对账', { exact: false }).click();
  for (let i = 0; i < 2; i++) {
    page.once('dialog', (message) => message.accept());
    await page
      .getByRole('button', { name: '删除结单', exact: true })
      .first()
      .click();
  }
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await save();
  await reloadUnlock();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.statement-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});

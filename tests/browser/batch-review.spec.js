import { confirmStatementImport } from './import-preview.js';
import { test, expect } from '@playwright/test';

test('batch review previews and applies only selected transactions, preserves history, and clears selections on filter changes', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-20T04:00:00Z'));
  await page.goto('/');
  const button = (parent, name) =>
    parent.getByRole('button', { name, exact: true });
  const upload = page.locator('input[accept=".pdf,.csv"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({
    name: 'batch.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction,category,channel\n2026-11-01,FIRST SHOP,100,CNY,debit,spend,standard\n2026-11-02,SECOND SHOP,200,CNY,debit,spend,standard\n2026-11-03,REFUND SHOP,25,CNY,credit,credit,standard',
    ),
  });
  await confirmStatementImport(page);
  const rows = page.locator('.transactions-section tbody tr');
  await expect(rows).toHaveCount(3);
  const row = (merchant) => rows.filter({ hasText: merchant });
  const select = (merchant) => row(merchant).getByRole('checkbox');
  await button(page, '添加活动').click();
  const campaign = page.locator('.campaign-form');
  await campaign.getByLabel('活动名称', { exact: true }).fill('Wallet offer');
  await campaign.getByLabel('币种', { exact: true }).selectOption('CNY');
  await campaign.getByLabel('渠道', { exact: true }).selectOption('applePay');
  await campaign.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await campaign.getByRole('checkbox').check();
  await button(campaign, '保存活动').click();
  const total = page.locator('.primary-reward .reward-card-value');
  await expect(total).toContainText('6.60');
  const campaignReward = page.locator('.activity-card .reward-card-value');
  await expect(campaignReward).toContainText('0.00');
  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic batch review password');
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await button(page, '选择交易').click();
  await select('FIRST SHOP').check();
  await select('REFUND SHOP').check();
  await button(page, '批量核对交易').click();
  const dialog = page.getByRole('dialog', {
    name: '批量核对交易',
    exact: true,
  });
  await expect(dialog.getByLabel('分类', { exact: true })).toBeDisabled();
  await expect(button(dialog, '应用批量修正')).toBeDisabled();
  await dialog.getByLabel('支付渠道', { exact: true }).selectOption('standard');
  await button(dialog, '预览批量修正').click();
  await expect(dialog).toContainText('将修正 0 笔交易');
  await expect(button(dialog, '应用批量修正')).toBeDisabled();
  await button(dialog, '取消').click();
  const search = page.getByLabel('搜索商户、卡号或备注');
  await search.fill('SECOND');
  await expect(rows).toHaveCount(1);
  await expect(row('SECOND SHOP').getByRole('checkbox')).toHaveCount(0);
  await search.fill('');
  await button(page, '选择交易').click();
  await select('FIRST SHOP').check();
  await select('SECOND SHOP').check();
  await button(page, '批量核对交易').click();
  const channel = dialog.getByLabel('支付渠道', { exact: true });
  await channel.selectOption('applePay');
  await button(dialog, '预览批量修正').click();
  await expect(dialog).toContainText('将修正 2 笔交易');
  await expect(dialog).toContainText('CNY 6.60 → 12.60');
  await expect(dialog).toContainText('Wallet offer · CNY 0.00 → 15.00');
  await expect(dialog.locator('.batch-review-rows')).not.toContainText(
    'REFUND SHOP',
  );
  await expect(dialog.locator('.batch-review-rows li').first()).toContainText(
    '结单 1',
  );
  await expect(total).toContainText('6.60');
  await expect(page.locator('.workspace-status')).not.toHaveClass(
    /has-changes/,
  );
  await channel.selectOption('online');
  await expect(button(dialog, '应用批量修正')).toBeDisabled();
  await channel.selectOption('applePay');
  await button(dialog, '预览批量修正').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({
    path: testInfo.outputPath('batch-review-mobile.png'),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await button(dialog, '应用批量修正').click();
  await expect(dialog).toBeHidden();
  await expect(total).toContainText('12.60');
  await expect(campaignReward).toContainText('15.00');
  await expect(row('FIRST SHOP')).toContainText('Apple Pay');
  await expect(row('SECOND SHOP')).toContainText('已人工修正');
  await expect(row('REFUND SHOP')).not.toContainText('已人工修正');
  await expect(page.locator('.workspace-status')).toContainText(
    '已修正 2 笔交易',
  );
  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic batch review password');
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic batch review password');
  await button(page, '解锁数据').click();
  await expect(total).toContainText('12.60');
  await button(row('FIRST SHOP'), '核对交易').click();
  await expect(page.getByText('修改记录 · 1', { exact: true })).toBeVisible();
});

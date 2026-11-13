import { test, expect } from '@playwright/test';
const button = (parent, name) =>
  parent.getByRole('button', { name, exact: true });
test('cross-statement warnings preserve records, support review, ignore table filters and clear after statement removal', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:00:00Z'));
  await page.goto('/');
  const upload = page.locator('input[accept=".pdf,.csv"]');
  await expect(upload).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  const importFile = async (name, rows) => {
    await upload.setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,description,amount,currency,direction\n' + rows.join('\n'),
      ),
    });
    await expect(
      page.getByText(`${name}：已导入 ${rows.length} 笔交易`, { exact: true }),
    ).toBeVisible();
  };
  await importFile('first.csv', [
    '2026-11-01,SHOP ONE,100,HKD,debit',
    '2026-11-01,SHOP ONE,100,HKD,debit',
    '2026-11-02,ONLY A,50,HKD,debit',
  ]);
  const panel = page.locator('.duplicate-transactions');
  await panel.locator('summary').click();
  await expect(panel).toContainText('未发现符合检查条件');
  await importFile('second.csv', [
    '2026-11-01, shop   one ,100.00,HKD,debit',
    '2026-11-03,ONLY B,25,HKD,debit',
  ]);
  await expect(panel).toContainText('发现 1 组可能重叠，涉及 3 笔记录');
  await expect(panel.locator('.duplicate-group li')).toHaveCount(3);
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(5);
  await button(page, '添加活动').click();
  const form = page.locator('.campaign-form');
  await form.getByLabel('活动名称', { exact: true }).fill('Duplicate review');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await form.getByRole('checkbox').check();
  await button(form, '保存活动').click();
  const reward = page.locator('.activity-card .reward-card-value');
  await expect(reward).toContainText('18.75');
  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic duplicate password');
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.workspace-status')).not.toHaveClass(
    /has-changes/,
  );
  await page.locator('.bank-tile').filter({ hasText: '汇丰' }).click();
  await expect(panel).toHaveCount(0);
  await page.locator('.bank-tile').filter({ hasText: '中银香港' }).click();
  await panel.locator('summary').click();
  await expect(panel.locator('.duplicate-group li')).toHaveCount(3);
  await page.getByLabel('搜索商户、卡号或备注').fill('nothing matches');
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(0);
  await expect(panel.locator('.duplicate-group li')).toHaveCount(3);
  await expect(page.locator('.workspace-status')).not.toHaveClass(
    /has-changes/,
  );
  const overlap = panel.locator('li').filter({ hasText: 'second.csv' });
  await expect(overlap).toContainText('结单 2');
  await button(overlap, '核对交易').click();
  const dialog = page.getByRole('dialog', { name: '核对交易', exact: true });
  await dialog.getByLabel('支付渠道', { exact: true }).selectOption('exclude');
  await button(dialog, '应用修正').click();
  await expect(overlap).toContainText('已设为不计奖赏');
  await expect(reward).toContainText('13.75');
  await expect(panel.locator('.duplicate-group li')).toHaveCount(3);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(panel).toContainText('跨結單重複交易檢查');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({
    path: testInfo.outputPath('duplicates-mobile.png'),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('.statement-status summary').click();
  const statement = page
    .locator('.statement-row')
    .filter({ hasText: 'second.csv' });
  await expect(statement).toContainText('結單 2');
  page.once('dialog', (confirmation) => confirmation.accept());
  await button(statement, '刪除結單').click();
  await expect(panel).toContainText('未發現符合檢查條件');
  await page.getByLabel('搜尋商戶、卡號或備註').fill('');
  await expect(page.locator('.transactions-section tbody tr')).toHaveCount(3);
  await expect(reward).toContainText('12.50');
});

test('overlap groups and large groups both paginate without rendering every record', async ({
  page,
}) => {
  await page.goto('/');
  const upload = page.locator('input[accept=".pdf,.csv"]');
  await expect(upload).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  const rows = Array.from(
    { length: 36 },
    (_, index) => `2026-11-01,GROUP ${Math.floor(index / 6)},100,HKD,debit`,
  );
  for (const [name, records] of [
    ['a.csv', rows],
    ['b.csv', [...rows].reverse()],
  ]) {
    await upload.setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,description,amount,currency,direction\n' + records.join('\n'),
      ),
    });
    await expect(
      page.getByText(`${name}：已导入 36 笔交易`, { exact: true }),
    ).toBeVisible();
  }
  const panel = page.locator('.duplicate-transactions');
  await panel.locator('summary').click();
  await expect(panel).toContainText('发现 6 组可能重叠，涉及 72 笔记录');
  await expect(panel.locator('.duplicate-group')).toHaveCount(5);
  await expect(panel.locator('.duplicate-group li')).toHaveCount(50);
  await button(panel, '下一组页').click();
  await expect(panel.locator('.duplicate-group')).toHaveCount(1);
  const group = panel.locator('.duplicate-group');
  await expect(group.locator('li')).toHaveCount(10);
  await button(group, '下一页').click();
  await expect(group.locator('li')).toHaveCount(2);
  await button(group, '上一页').click();
  await expect(group.locator('li')).toHaveCount(10);
});

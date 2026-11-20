import { test, expect } from '@playwright/test';

test('batch undo restores previous reviews and rejects later edits, while imported state can be restored after unlocking', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-20T04:00:00Z'));
  await page.goto('/');
  const button = (context, name) =>
    context.getByRole('button', { name, exact: true });
  const upload = page.locator('input[accept=".pdf,.csv"]');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({
    name: 'undo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction\n2026-11-01,FIRST SHOP,100,CNY,debit\n2026-11-02,SECOND SHOP,200,CNY,debit',
    ),
  });
  const rows = page.locator('.transactions-section tbody tr');
  await expect(rows).toHaveCount(2);
  const first = rows.filter({ hasText: 'FIRST SHOP' });
  const second = rows.filter({ hasText: 'SECOND SHOP' });
  const review = page.getByRole('dialog', { name: '核对交易', exact: true });
  const batch = page.getByRole('dialog', { name: '批量核对交易', exact: true });
  const total = page.locator('.primary-reward .reward-card-value');
  const undo = button(page, '撤销上次批量修正');
  const selectChannel = (context, channel) =>
    context.getByLabel('支付渠道', { exact: true }).selectOption(channel);
  const excludeBoth = async () => {
    await button(page, '选择交易').click();
    await first.getByRole('checkbox').check();
    await second.getByRole('checkbox').check();
    await button(page, '批量核对交易').click();
    await selectChannel(batch, 'exclude');
    await button(batch, '预览批量修正').click();
    await button(batch, '应用批量修正').click();
    await expect(total).toContainText('0.00');
  };

  await button(first, '核对交易').click();
  await selectChannel(review, 'applePay');
  await button(review, '应用修正').click();
  await expect(total).toContainText('9.20');
  await excludeBoth();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await undo.click();
  await expect(total).toContainText('0.00');
  page.once('dialog', (confirmation) => confirmation.accept());
  await undo.click();
  await expect(undo).toHaveCount(0);
  await expect(total).toContainText('9.20');
  await expect(first).toContainText('Apple Pay');
  await expect(second).toContainText('待确认渠道');
  await excludeBoth();
  await button(first, '核对交易').click();
  await selectChannel(review, 'online');
  await button(review, '应用修正').click();
  await expect(total).toContainText('2.40');
  await undo.click();
  await expect(page.locator('.workspace-status')).toContainText(
    '已改动或删除，无法整批撤销',
  );
  await expect(second).toContainText('不计奖赏');
  await expect(total).toContainText('2.40');

  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic review undo password');
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic review undo password');
  await button(page, '解锁数据').click();
  await expect(total).toContainText('2.40');
  await expect(undo).toHaveCount(0);
  await button(second, '核对交易').click();
  await review.getByText('修改记录 · 3', { exact: true }).click();
  await expect(review.getByText('撤销批量修正', { exact: true })).toBeVisible();
  page.once('dialog', async (confirmation) => {
    expect(confirmation.message()).toContain('导入时：消费 · 待确认渠道');
    await confirmation.accept();
  });
  await button(review, '恢复导入状态').click();
  await expect(total).toContainText('7.20');
  await expect(second).toContainText('待确认渠道');
  await expect(page.locator('.workspace-status')).toHaveClass(/has-changes/);
  await button(second, '核对交易').click();
  await review.getByText('修改记录 · 4', { exact: true }).click();
  await expect(review.getByText('恢复导入状态', { exact: true })).toBeVisible();
  await expect(button(review, '恢复导入状态')).toHaveCount(0);
});

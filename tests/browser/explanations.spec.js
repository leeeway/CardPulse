import { test, expect } from '@playwright/test';

test('campaign explanations show caps, refunds, exclusions, pagination and updated review results', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-19T04:00:00Z'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const button = (name) => page.getByRole('button', { name, exact: true });
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  const rows = Array.from(
    { length: 26 },
    (_, index) => `2026-10-01,SHOP ${index + 1},100.00,HKD,debit,spend,online`,
  );
  rows.push(
    '2026-10-02,SHOP REFUND,100.00,HKD,credit,credit,online',
    '2026-10-03,SHOP FEE,10.00,HKD,debit,fee,online',
    '2026-10-03,COFFEE,100.00,HKD,debit,spend,online',
    '2026-10-03,SHOP CHANNEL,100.00,HKD,debit,spend,other',
    '2027-01-01,SHOP FUTURE,100.00,HKD,debit,spend,online',
    '2025-12-31,SHOP OLD,100.00,HKD,debit,spend,online',
  );
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'explanations.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,description,amount,currency,direction,category,channel\n' +
          rows.join('\n'),
      ),
    });
  await expect(page.locator('tbody tr')).toHaveCount(32);
  await button('添加活动').click();
  const form = page.locator('.campaign-form');
  await form
    .getByLabel('活动名称', { exact: true })
    .fill('Explain my campaign');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await form.getByLabel('每周期消费上限', { exact: true }).fill('1000');
  await form.getByLabel('每周期奖赏上限', { exact: true }).fill('20');
  await form.getByLabel('每周期净消费门槛', { exact: true }).fill('100');
  await form.getByLabel('商户关键词', { exact: true }).fill('SHOP');
  await form.getByLabel('渠道', { exact: true }).selectOption('online');
  await form.getByRole('checkbox').check();
  await button('保存活动').click();
  const card = page.locator('.activity-card');
  await expect(card.locator('.reward-card-value')).toContainText('15.00');
  await card.locator('.period-breakdown > summary').click();
  const period = card.locator('.period-calculation');
  await expect(
    period.locator('dl > div').filter({ hasText: '匹配消费总额' }),
  ).toContainText('2600.00');
  await expect(
    period.locator('dl > div').filter({ hasText: '退款后净消费' }),
  ).toContainText('2500.00');
  await expect(
    period.locator('dl > div').filter({ hasText: '奖赏封顶后' }),
  ).toContainText('20.00');
  await expect(
    period.locator('dl > div').filter({ hasText: '本期退款扣回' }),
  ).toContainText('5.00');
  await card.locator('.transaction-explanations > summary').click();
  const audit = card.locator('.transaction-explanations');
  await expect(audit).toContainText('计入 27 笔，排除 5 笔');
  await expect(audit.locator('tbody tr')).toHaveCount(25);
  await audit.getByRole('button', { name: '下一页' }).click();
  await expect(audit.locator('tbody tr')).toHaveCount(7);
  await expect(audit.locator('tbody')).toContainText('计入退款扣回');
  await expect(audit.locator('tbody')).toContainText('商户关键词不匹配');
  await audit.getByLabel('说明记录范围').selectOption('excluded');
  await expect(audit.locator('tbody tr')).toHaveCount(5);
  await expect(audit).toContainText('第 1 / 1 页');
  await page.getByLabel('搜索商户、卡号或备注').fill('SHOP CHANNEL');
  await page
    .locator('.transactions-section tbody tr')
    .getByRole('button', { name: '核对交易' })
    .click();
  const review = page.getByRole('dialog', { name: '核对交易' });
  await review.getByLabel('支付渠道', { exact: true }).selectOption('online');
  await review.getByRole('button', { name: '应用修正' }).click();
  await expect(audit).toContainText('计入 28 笔，排除 4 笔');
  await expect(audit.locator('tbody tr')).toHaveCount(4);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(audit.getByLabel('說明記錄範圍')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('campaign-explanation-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card.getByRole('button', { name: '編輯活動' }).click();
  await form.getByLabel('每週期淨簽賬門檻', { exact: true }).fill('5000');
  await button('儲存活動').click();
  await expect(card.locator('.reward-card-value')).toContainText('0.00');
  await expect(period).toContainText('未達淨簽賬門檻，本週期獎賞為零。');
  expect(errors).toEqual([]);
});

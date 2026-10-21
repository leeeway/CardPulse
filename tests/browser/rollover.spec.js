import { test, expect } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

test('Hong Kong date rollover updates Pulse, campaign totals and open explanations without editing data', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // UTC is still June 30 when the Hong Kong half-year boundary passes.
  await page.clock.install({ time: new Date('2026-06-30T15:59:40Z') });
  await page.clock.pauseAt(new Date('2026-06-30T15:59:45Z'));
  await page.goto('/');
  const input = page.locator('input[accept=".pdf,.csv"]');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'rollover.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction,category,channel\n' +
        '2026-06-30,JUNE,100.00,CNY,debit,spend,applePay\n' +
        '2026-07-01,JULY,100.00,CNY,debit,spend,applePay\n' +
        '2027-01-01,JANUARY,100.00,CNY,debit,spend,applePay',
    ),
  });
  const button = (name) => page.getByRole('button', { name, exact: true });
  await button('添加活动').click();
  const form = page.locator('.campaign-form');
  await form.getByLabel('活动名称', { exact: true }).fill('Across years');
  await form.getByLabel('币种', { exact: true }).selectOption('CNY');
  await form.getByLabel('结束日期', { exact: true }).fill('2027-12-31');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await form.getByRole('checkbox').check();
  await button('保存活动').click();
  const pulse = page.locator('.pulse-section');
  const pulseTotal = pulse.locator('.primary-reward .reward-card-value');
  const card = page.locator('.activity-card');
  const campaignTotal = card.locator('.reward-card-value');
  await pulse.getByText('Pulse 计算明细', { exact: true }).click();
  await pulse.getByText('Pulse 逐笔说明', { exact: true }).click();
  await card.locator('.period-breakdown > summary').click();
  await card.locator('.transaction-explanations > summary').click();
  const pulseAudit = pulse.locator('.transaction-explanations');
  const campaignAudit = card.locator('.transaction-explanations');
  await expect(pulseTotal).toContainText('4.40');
  await expect(campaignTotal).toContainText('5.00');
  await expect(pulseAudit).toContainText('计入 1 笔，排除 2 笔');

  await page.clock.runFor(30_000);
  await expect(pulse.locator('.pulse-calculation-details')).toContainText(
    '2026-07-01',
  );
  await expect(pulseTotal).toContainText('8.80');
  await expect(campaignTotal).toContainText('10.00');
  await expect(pulseAudit).toContainText('计入 2 笔，排除 1 笔');
  await expect(campaignAudit).toContainText('计入 2 笔，排除 1 笔');
  await expect(card.locator('.period-breakdown')).toContainText('2026-07-01');

  // Simulate waking from sleep: no timer tick is needed on focus.
  await page.clock.setSystemTime(new Date('2026-12-31T16:00:01Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(pulse.locator('.pulse-calculation-details')).toContainText(
    '2027-01-01',
  );
  await expect(pulseTotal).toContainText('4.40');
  await expect(campaignTotal).toContainText('15.00');
  await expect(pulseAudit).toContainText('计入 1 笔，排除 2 笔');
  await expect(campaignAudit).toContainText('计入 3 笔，排除 0 笔');
  await expect(pulse.locator('.pulse-half').first()).toContainText(
    '2027 · 上半年',
  );

  // A hidden tab resuming also refreshes; clock corrections can move backwards.
  await page.clock.setSystemTime(new Date('2026-06-30T15:59:45Z'));
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(pulseTotal).toContainText('4.40');
  await expect(campaignTotal).toContainText('5.00');
  await expect(card.locator('.period-breakdown')).toContainText('2026-06-30');
  expect(errors).toEqual([]);
});

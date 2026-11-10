import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('campaign list filters compose without narrowing exported rules and update at Hong Kong midnight', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-10T15:59:59Z') });
  await page.clock.pauseAt(new Date('2026-11-10T15:59:59.500Z'));
  await page.goto('/');
  await expect(page.getByLabel('选择活动规则文件')).toBeEnabled();
  const rule = {
    name: 'Today',
    bankId: 'bochk',
    cardId: '',
    currency: 'HKD',
    startDate: '2026-11-01',
    endDate: '2026-11-10',
    ratePercent: '5',
    period: 'monthly',
    dateBasis: 'posting',
    channel: 'any',
    spendingCap: '',
    rewardCap: '',
    minSpend: '',
    merchant: 'SHOP',
  };
  await page
    .getByLabel('选择活动规则文件')
    .setInputFiles({
      name: 'synthetic.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'CardPulseCampaigns',
          version: 1,
          campaigns: [
            rule,
            {
              ...rule,
              name: 'Future',
              startDate: '2026-11-11',
              endDate: '2026-12-31',
              merchant: 'OTHER',
            },
          ],
        }),
      ),
    });
  await page.getByRole('button', { name: '确认新增活动', exact: true }).click();
  const cards = page.locator('.activity-card');
  await expect(cards).toHaveCount(2);
  await page.getByLabel('活动状态', { exact: true }).selectOption('active');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Today');
  await page.getByLabel('搜索活动', { exact: true }).fill(' other ');
  await expect(cards).toHaveCount(0);
  await expect(
    page.getByText('没有符合筛选的活动', { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出活动规则', exact: true }).click();
  expect(
    JSON.parse(await readFile(await (await download).path(), 'utf8')).campaigns,
  ).toHaveLength(2);
  await page.getByRole('button', { name: '重置活动筛选', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByLabel('活动状态', { exact: true }).selectOption('active');
  await page.clock.fastForward(61_000);
  await expect(cards).toContainText('Future');
  await page
    .getByLabel('活动状态', { exact: true })
    .selectOption('unconfirmed');
  await expect(cards).toHaveCount(2);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(page.getByLabel('活動狀態', { exact: true })).toBeVisible();
});

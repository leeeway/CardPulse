import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decryptData } from '../../src/core/crypto.js';
const button = (parent, name) =>
  parent.getByRole('button', { name, exact: true });
const value = (parent, label) =>
  parent.locator('dl > div').filter({ hasText: label }).locator('dd');
const password = 'synthetic simulation password';

test('progressive refund scenarios show negative changes and refresh at Hong Kong midnight', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-11T15:59:40Z') });
  await page.clock.pauseAt(new Date('2026-11-11T15:59:45Z'));
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page
    .locator('input[accept=".pdf,.csv"]')
    .setInputFiles({
      name: 'refunds.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'day,description,amount,currency,direction\n2026-11-01,SYNTHETIC DEBIT,1000,HKD,debit\n2026-11-10,SYNTHETIC REFUND,600,HKD,credit\n2026-11-12,SYNTHETIC FUTURE REFUND,100,HKD,credit',
      ),
    });
  const rule = {
    name: 'Negative scenario',
    bankId: 'bochk',
    cardId: '',
    currency: 'HKD',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ratePercent: '0',
    rewardType: 'progressive',
    tiers: [
      { from: '0', ratePercent: '1' },
      { from: '1000', ratePercent: '3' },
    ],
    period: 'monthly',
    dateBasis: 'posting',
    channel: 'any',
    spendingCap: '',
    rewardCap: '10',
    minSpend: '',
    merchant: '',
  };
  await page
    .getByLabel('选择活动规则文件', { exact: true })
    .setInputFiles({
      name: 'tiers.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'CardPulseCampaigns',
          version: 3,
          campaigns: [rule],
        }),
      ),
    });
  await button(page, '确认新增活动').click();
  const card = page.locator('.activity-card');
  await button(card, '编辑活动').click();
  await page.locator('.campaign-form').getByRole('checkbox').check();
  await button(page, '保存活动').click();
  await card.getByText('活动消费试算', { exact: true }).click();
  const simulation = card.locator('.campaign-simulator');
  await simulation.getByLabel('试算消费金额', { exact: true }).fill('500');
  await button(simulation, '计算试算结果').click();
  const result = simulation.getByRole('region', {
    name: '试算结果',
    exact: true,
  });
  await expect(value(result, '预计奖赏变化')).toHaveText('HKD -4.00');
  await expect(value(result, '试算后预计奖赏')).toHaveText('HKD 0.00');
  await expect(card.locator('.reward-card-value')).toContainText('4.00');
  await page.clock.fastForward(40_000);
  await expect(result).toContainText('试算截止日：2026-11-12');
  await expect(value(result, '预计奖赏变化')).toHaveText('HKD -3.00');
  await expect(card.locator('.reward-card-value')).toContainText('3.00');
  await expect(
    simulation.getByLabel('试算消费日期', { exact: true }),
  ).toHaveValue('2026-11-11');
});

test('spend simulations stay outside saved data and reports, react to edits, and explain future cutoffs', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-11T04:00:00Z'));
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction\n2026-11-01,PRIVATE EXISTING,900,HKD,debit\n2026-12-01,PRIVATE FUTURE,200,HKD,debit',
    ),
  });
  await button(page, '添加活动').click();
  const form = page.locator('.campaign-form');
  await form.getByLabel('活动名称', { exact: true }).fill('Simulation example');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await form.getByLabel('每周期净消费门槛', { exact: true }).fill('1000');
  await button(page, '保存活动').click();
  const card = page.locator('.activity-card');
  await card.getByText('活动消费试算', { exact: true }).click();
  const simulation = card.locator('.campaign-simulator');
  await expect(button(simulation, '计算试算结果')).toBeDisabled();
  await expect(simulation).toContainText('请先核对并确认活动资格');
  await button(card, '编辑活动').click();
  await form.getByRole('checkbox').check();
  await button(form, '保存活动').click();
  await simulation.getByLabel('试算消费金额', { exact: true }).fill('100');
  await button(simulation, '计算试算结果').click();
  const result = simulation.getByRole('region', {
    name: '试算结果',
    exact: true,
  });
  await expect(value(result, '该周期原预计奖赏')).toHaveText('HKD 0.00');
  await expect(value(result, '试算后预计奖赏')).toHaveText('HKD 50.00');
  await expect(value(result, '预计奖赏变化')).toHaveText('HKD 50.00');
  await expect(card.locator('.reward-card-value')).toContainText('0.00');
  await expect(page.locator('.table-container tbody tr')).toHaveCount(2);
  await button(page, '保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.workspace-status')).not.toHaveClass(
    /has-changes/,
  );
  await simulation.getByLabel('试算消费金额', { exact: true }).fill('200');
  await expect(result).toBeHidden();
  await button(simulation, '计算试算结果').click();
  await expect(value(result, '试算后预计奖赏')).toHaveText('HKD 55.00');
  await expect(page.locator('.workspace-status')).not.toHaveClass(
    /has-changes/,
  );
  const reportDownloaded = page.waitForEvent('download');
  await button(card, '导出奖赏核对表').click();
  const report = await readFile(await (await reportDownloaded).path(), 'utf8');
  expect(report).not.toContain('55.00');
  expect(report).not.toContain('1100.00');
  await button(page, '导出加密备份').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  const backupDownloaded = page.waitForEvent('download');
  await button(page.getByRole('dialog'), '导出加密备份').click();
  const backup = JSON.parse(
    await readFile(await (await backupDownloaded).path(), 'utf8'),
  );
  const saved = await decryptData(backup.payload, password);
  expect(saved.transactions).toHaveLength(2);
  expect(saved.transactions.map((tx) => tx.amount)).toEqual([
    '900.00',
    '200.00',
  ]);
  expect(Object.keys(saved).sort()).toEqual([
    'campaigns',
    'exchangeRate',
    'statements',
    'transactions',
    'version',
  ]);
  await expect(page.getByRole('dialog')).toBeHidden();
  // Saved rule changes update an already submitted scenario without another click.
  await button(card, '编辑活动').click();
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('10');
  await button(form, '保存活动').click();
  await expect(value(result, '试算后预计奖赏')).toHaveText('HKD 110.00');
  await simulation
    .getByLabel('试算消费日期', { exact: true })
    .fill('2026-12-01');
  await simulation.getByLabel('试算消费金额', { exact: true }).fill('800');
  await button(simulation, '计算试算结果').click();
  await expect(result).toContainText('试算截止日：2026-12-01');
  await expect(value(result, '该周期原预计奖赏')).toHaveText('HKD 0.00');
  await expect(value(result, '试算后预计奖赏')).toHaveText('HKD 100.00');
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(
    simulation.getByLabel('試算簽賬金額', { exact: true }),
  ).toHaveValue('800');
  await page.setViewportSize({ width: 390, height: 844 });
  await simulation.screenshot({
    path: testInfo.outputPath('simulation-mobile.png'),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await button(simulation, '清除試算').click();
  await expect(simulation.locator('.simulation-result')).toHaveCount(0);
  await page.reload();
  await button(page, '解鎖本機資料庫').click();
  await page.getByLabel('主密碼', { exact: true }).fill(password);
  await button(page, '解鎖資料').click();
  await card.getByText('活動簽賬試算', { exact: true }).click();
  await expect(
    simulation.getByLabel('試算簽賬金額', { exact: true }),
  ).toHaveValue('');
  await expect(simulation.locator('.simulation-result')).toHaveCount(0);
  expect(errors).toEqual([]);
});

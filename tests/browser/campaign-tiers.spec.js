import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decryptData } from '../../src/core/crypto.js';

const button = (page, name) => page.getByRole('button', { name, exact: true });
const password = 'synthetic tier password';
async function downloaded(page, name, parent = page) {
  const download = page.waitForEvent('download');
  await button(parent, name).click();
  return readFile(await (await download).path(), 'utf8');
}

test('progressive campaigns calculate, share, copy and restore with explicit tier configuration', async ({
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
      'day,description,amount,currency,direction\n2026-01-26,PRIVATE SYNTHETIC,2000,HKD,debit\n2026-02-25,PRIVATE REFUND,600,HKD,credit',
    ),
  });
  await button(page, '添加活动').click();
  const form = page.locator('.campaign-form');
  await form
    .getByLabel('活动名称', { exact: true })
    .fill('Progressive example');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('封顶周期', { exact: true }).selectOption('statement');
  await form.getByLabel('每月结单日', { exact: true }).fill('25');
  await form
    .getByLabel('奖赏计算方式', { exact: true })
    .selectOption('progressive');
  await expect(form.getByLabel('回赠比例（%）', { exact: true })).toHaveCount(
    0,
  );
  await expect(form.getByLabel('第 1 段起点', { exact: true })).toHaveValue(
    '0',
  );
  await expect(form.getByLabel('第 2 段起点', { exact: true })).toHaveValue('');
  await form.getByLabel('第 1 段费率（%）', { exact: true }).fill('1');
  await form.getByLabel('第 2 段起点', { exact: true }).fill('1000');
  await form.getByLabel('第 2 段费率（%）', { exact: true }).fill('3');
  await button(form, '添加分段').click();
  await form.getByLabel('第 3 段起点', { exact: true }).fill('500');
  await form.getByLabel('第 3 段费率（%）', { exact: true }).fill('5');
  await button(page, '保存活动').click();
  await expect(form.getByRole('alert')).toContainText('起点须严格递增');
  await button(form, '删除第 3 段').click();
  await form.getByLabel('每周期消费上限', { exact: true }).fill('1500');
  await form.getByLabel('每周期奖赏上限', { exact: true }).fill('20');
  await form.getByRole('checkbox').check();
  await button(page, '保存活动').click();
  const cards = page.locator('.activity-card');
  const card = cards.first();
  await expect(card.locator('.reward-card-value')).toContainText('4.00');
  await expect(card).toContainText('分段累进费率');
  await card.getByText('本期估算', { exact: true }).click();
  await expect(card.locator('.tier-calculation')).toContainText(
    '500.00 × 3% = HKD 15.00',
  );
  const report = await downloaded(page, '导出奖赏核对表', card);
  expect(report).toContain('分段累进费率: 0 → 1000: 1%; 1000 → 不限: 3%');
  expect(report).toContain('4.00');
  expect(report).not.toContain('PRIVATE');
  await button(card, '复制活动').click();
  await expect(form.getByLabel('第 2 段起点', { exact: true })).toHaveValue(
    '1000',
  );
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await form.getByLabel('第 2 段费率（%）', { exact: true }).fill('4');
  await button(form, '取消').click();
  await expect(card.locator('.reward-card-value')).toContainText('4.00');
  const rules = await downloaded(page, '导出此规则', card);
  expect(JSON.parse(rules).version).toBe(3);
  await page.getByLabel('选择活动规则文件', { exact: true }).setInputFiles({
    name: 'tiers.json',
    mimeType: 'application/json',
    buffer: Buffer.from(rules),
  });
  const preview = page.getByRole('dialog', {
    name: '预览活动规则',
    exact: true,
  });
  await expect(preview).toContainText('1000 → 不限 · 3%');
  await button(page, '确认新增活动').click();
  await expect(cards).toHaveCount(2);
  await expect(cards.last()).toContainText('未确认资格');
  await expect(cards.last().locator('.reward-card-value')).toContainText(
    '0.00',
  );
  await button(page, '保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '解锁数据').click();
  await expect(card.locator('.reward-card-value')).toContainText('4.00');
  await button(page, '导出加密备份').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  const backup = await downloaded(
    page,
    '导出加密备份',
    page.getByRole('dialog'),
  );
  const data = await decryptData(JSON.parse(backup).payload, password);
  expect(data.version).toBe(3);
  expect(data.campaigns[0].tiers[1].ratePercent).toBe('3');
  await expect(page.getByRole('dialog')).toBeHidden();
  page.once('dialog', (dialog) => dialog.accept());
  await button(page, '清空数据').click();
  await page.locator('input[accept=".cardpulse"]').setInputFiles({
    name: 'synthetic.cardpulse',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await page.getByLabel('主密码', { exact: true }).fill(password);
  page.once('dialog', (dialog) => dialog.accept());
  await button(page, '确认恢复').click();
  await expect(card.locator('.reward-card-value')).toContainText('4.00');
  await button(card, '编辑活动').click();
  await expect(
    form.getByLabel('第 2 段费率（%）', { exact: true }),
  ).toHaveValue('3');
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(
    form.getByLabel('第 2 段費率（%）', { exact: true }),
  ).toHaveValue('3');
  await page.setViewportSize({ width: 390, height: 844 });
  await form.screenshot({ path: testInfo.outputPath('tiers-mobile.png') });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await form.getByLabel('獎賞計算方式', { exact: true }).selectOption('flat');
  await expect(form.locator('.campaign-tiers')).toHaveCount(0);
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await expect(form.getByLabel('回贈比例（%）', { exact: true })).toHaveValue(
    '',
  );
  expect(errors).toEqual([]);
});

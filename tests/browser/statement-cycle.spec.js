import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const button = (page, name) => page.getByRole('button', { name, exact: true });

test('statement cycles expose boundaries, survive encryption, and share through versioned previews', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-06T04:00:00Z') });
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'synthetic-cycle.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'day,description,amount,currency,direction',
        '2026-01-25,SYNTHETIC CLOSE,100,HKD,debit',
        '2026-01-26,SYNTHETIC NEW,100,HKD,debit',
        '2026-02-25,SYNTHETIC CLOSE,200,HKD,debit',
        '2026-02-26,SYNTHETIC REFUND,10,HKD,credit',
        '2026-03-01,SYNTHETIC NEW,100,HKD,debit',
      ].join('\n'),
    ),
  });
  await button(page, '添加活动').click();
  const form = page.locator('.campaign-form');
  await form.getByLabel('活动名称', { exact: true }).fill('Cycle example');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await form.getByLabel('封顶周期', { exact: true }).selectOption('statement');
  await expect(form.getByLabel('每月结单日', { exact: true })).toHaveValue('');
  await button(page, '保存活动').click();
  await expect(form).toBeVisible(); // A closing day must be chosen explicitly.
  await form.getByLabel('每月结单日', { exact: true }).fill('25');
  await form.getByLabel('每周期奖赏上限', { exact: true }).fill('7');
  await form.getByLabel('起始日期', { exact: true }).fill('2026-01-20');
  await form.getByLabel('结束日期', { exact: true }).fill('2026-03-01');
  await form.getByRole('checkbox').check();
  await button(page, '保存活动').click();
  const card = page.locator('.activity-card').first();
  await expect(card).toContainText('每月 25 日结单');
  await expect(card.locator('.reward-card-value')).toContainText('16.50');
  const reportDownload = page.waitForEvent('download');
  await card
    .getByRole('button', { name: '导出奖赏核对表', exact: true })
    .click();
  const report = await readFile(await (await reportDownload).path(), 'utf8');
  expect(report).toContain('活动合计');
  expect(report).toContain('16.50');
  expect(report).not.toContain('SYNTHETIC');

  await card.getByText('本期估算', { exact: true }).click();
  await expect(card.locator('.period-calculation')).toHaveCount(3);
  await expect(
    card.getByRole('heading', { name: '2025-12-26 → 2026-01-25' }),
  ).toBeVisible();
  await expect(
    card.getByRole('heading', { name: '2026-01-26 → 2026-02-25' }),
  ).toBeVisible();
  await expect(card).toContainText('首尾周期可能不完整');
  await card.getByText('逐笔计算说明', { exact: true }).click();
  await expect(card.locator('.explanation-table')).toContainText(
    '2026-02-26 → 2026-03-25',
  );
  await card.getByRole('button', { name: '复制活动', exact: true }).click();
  await expect(form.getByLabel('每月结单日', { exact: true })).toHaveValue(
    '25',
  );
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await form.getByRole('button', { name: '取消', exact: true }).click();

  const downloaded = page.waitForEvent('download');
  await button(page, '导出活动规则').click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  const data = JSON.parse(content);
  expect(data.version).toBe(2);
  expect(data.campaigns[0].statementDay).toBe('25');
  expect(content).not.toContain('SYNTHETIC');
  await page.getByLabel('选择活动规则文件', { exact: true }).setInputFiles({
    name: 'cycle-rules.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  const preview = page.getByRole('dialog', {
    name: '预览活动规则',
    exact: true,
  });
  await expect(preview).toContainText('每月结单日');
  await expect(preview).toContainText('25');
  await expect(preview).toContainText('短月取月末');
  await button(page, '确认新增活动').click();
  await expect(page.locator('.activity-card')).toHaveCount(2);
  await expect(page.locator('.activity-card').last()).toContainText(
    '未确认资格',
  );
  await expect(
    page.locator('.activity-card').last().locator('.reward-card-value'),
  ).toContainText('0.00');

  await button(page, '保存到加密库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic cycle password');
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page
    .getByLabel('主密码', { exact: true })
    .fill('synthetic cycle password');
  await button(page, '解锁数据').click();
  await expect(card.locator('.reward-card-value')).toContainText('16.50');
  await card.getByRole('button', { name: '编辑活动', exact: true }).click();
  await expect(form.getByLabel('每月结单日', { exact: true })).toHaveValue(
    '25',
  );
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(form.getByLabel('每月結單日', { exact: true })).toHaveValue(
    '25',
  );
  await expect(form).toContainText('短月取月末');
  await page.setViewportSize({ width: 390, height: 844 });
  await form.screenshot({
    path: testInfo.outputPath('statement-cycle-mobile.png'),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

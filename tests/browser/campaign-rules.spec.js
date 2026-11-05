import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const password = 'synthetic rules password';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const uploadRules = (page, content) =>
  page
    .getByLabel('选择活动规则文件', { exact: true })
    .setInputFiles({
      name: 'rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
const cards = (page) => page.locator('.activity-card');
const card = (page, name) =>
  cards(page).filter({ has: page.getByRole('heading', { name, exact: true }) });
async function exported(page, name = '导出活动规则', parent = page) {
  const downloaded = page.waitForEvent('download');
  await parent.getByRole('button', { name, exact: true }).click();
  return readFile(await (await downloaded).path(), 'utf8');
}

test('rule export, copying and previewed imports preserve originals and never inherit eligibility', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-05T04:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-05T04:00:01Z'));
  await page.goto('/');
  await expect(page.locator('input[accept=".pdf,.csv"]')).toBeEnabled();
  await expect(button(page, '导出活动规则')).toBeDisabled();
  await page.getByLabel('导入银行', { exact: true }).selectOption('bochk');
  await page.locator('input[accept=".pdf,.csv"]').setInputFiles({
    name: 'PRIVATE.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'day,description,amount,currency,direction,last4,channel\n2026-11-01,PRIVATE SHOP TRANSACTION,100.00,HKD,debit,1234,online',
    ),
  });
  await button(page, '添加活动').click();
  const form = page.locator('.campaign-form');
  await form.getByLabel('活动名称', { exact: true }).fill('Original');
  await form.getByLabel('银行', { exact: true }).selectOption('bochk');
  await form.getByLabel('回赠比例（%）', { exact: true }).fill('5');
  await form.getByLabel('卡号末四位', { exact: true }).fill('1234');
  await form.getByLabel('商户关键词', { exact: true }).fill('SHOP');
  await form.getByRole('checkbox').check();
  await button(page, '保存活动').click();
  await expect(
    card(page, 'Original').locator('.reward-card-value'),
  ).toContainText('5.00');
  const content = await exported(page);
  const rules = JSON.parse(content);
  expect(rules.campaigns).toHaveLength(1);
  for (const secret of ['PRIVATE', '1234', 'registrationConfirmed', '"id"'])
    expect(content).not.toContain(secret);
  expect(rules.campaigns[0].merchant).toBe('SHOP');

  await card(page, 'Original')
    .getByRole('button', { name: '复制活动', exact: true })
    .click();
  await expect(form.getByLabel('活动名称', { exact: true })).toHaveValue(
    'Original（副本）',
  );
  await expect(form.getByLabel('卡号末四位', { exact: true })).toHaveValue(
    '1234',
  );
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await expect(button(page, '导入活动规则')).toBeDisabled();
  await form.getByLabel('活动名称', { exact: true }).fill('Copied');
  page.once('dialog', (dialog) => dialog.dismiss());
  await card(page, 'Original')
    .getByRole('button', { name: '复制活动', exact: true })
    .click();
  await expect(form.getByLabel('活动名称', { exact: true })).toHaveValue(
    'Copied',
  );
  await button(page, '保存活动').click();
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, 'Copied')).toContainText('未确认资格，不计算奖赏');
  await expect(
    card(page, 'Copied').locator('.reward-card-value'),
  ).toContainText('0.00');
  await expect(
    card(page, 'Original').locator('.reward-card-value'),
  ).toContainText('5.00');
  await button(page, '保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('空闲锁定时限').selectOption('5');
  await uploadRules(page, content);
  const preview = page.getByRole('dialog', {
    name: '预览活动规则',
    exact: true,
  });
  await expect(preview).toContainText('将新增 1 个活动');
  await expect(preview).toContainText('已有同名活动');
  await expect(preview).toContainText('中银香港');
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('.idle-lock-settings')).toContainText(
    '自动锁定暂缓',
  );
  await page.clock.fastForward(10 * 60_000);
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(cards(page)).toHaveCount(2);
  await uploadRules(page, content);
  await button(page, '确认新增活动').click();
  await expect(preview).toBeHidden();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('已新增 1 个活动');
  await expect(card(page, 'Original').last()).toContainText('未确认资格');
  await expect(
    card(page, 'Original').first().locator('.reward-card-value'),
  ).toContainText('5.00');
  await card(page, 'Original')
    .last()
    .getByRole('button', { name: '编辑活动', exact: true })
    .click();
  await expect(form.getByLabel('卡号末四位', { exact: true })).toHaveValue('');
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await form.getByRole('checkbox').check();
  await button(page, '保存活动').click();
  await expect(
    card(page, 'Original').last().locator('.reward-card-value'),
  ).toContainText('5.00');
  // A damaged batch is rejected atomically even if the first rule is valid.
  const bad = {
    ...rules,
    campaigns: [
      rules.campaigns[0],
      { ...rules.campaigns[0], registrationConfirmed: true },
    ],
  };
  await uploadRules(page, JSON.stringify(bad));
  await expect(page.getByRole('alert')).toContainText('不支持的字段');
  await expect(cards(page)).toHaveCount(3);
  const otherBank = {
    ...rules,
    campaigns: [
      {
        ...rules.campaigns[0],
        name: 'HSBC RULE',
        bankId: 'hsbc',
        cardId: 'hsbc_red',
        currency: 'CNY',
      },
    ],
  };
  await uploadRules(page, JSON.stringify(otherBank));
  await button(page, '确认新增活动').click();
  await expect(cards(page)).toHaveCount(4);
  await page.locator('.bank-tile').filter({ hasText: '中银香港' }).click();
  const filtered = JSON.parse(await exported(page));
  expect(filtered.campaigns).toHaveLength(3);
  expect(filtered.campaigns.every((rule) => rule.bankId === 'bochk')).toBe(
    true,
  );
  const single = JSON.parse(
    await exported(page, '导出此规则', card(page, 'Copied')),
  );
  expect(single.campaigns).toHaveLength(1);
  await page.locator('.bank-tile').filter({ hasText: '全部银行' }).click();
  await button(page, '保存到加密库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '加密保存').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await button(page, '解锁本地库').click();
  await page.getByLabel('主密码', { exact: true }).fill(password);
  await button(page, '解锁数据').click();
  await expect(cards(page)).toHaveCount(4);
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await page
    .getByLabel('選擇活動規則檔案', { exact: true })
    .setInputFiles({
      name: 'rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
  const traditionalPreview = page.getByRole('dialog', {
    name: '預覽活動規則',
    exact: true,
  });
  await expect(traditionalPreview).toContainText('不覆蓋現有活動');
  await page.setViewportSize({ width: 390, height: 844 });
  await traditionalPreview.screenshot({
    path: testInfo.outputPath('rules-mobile.png'),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

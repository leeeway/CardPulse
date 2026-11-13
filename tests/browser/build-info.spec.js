import { test, expect } from '@playwright/test';
test('public build identity supports safe copy and a manual clipboard fallback', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__buildReport = text;
        },
      },
    }),
  );
  await page.goto('/');
  const info = page.locator('.build-info');
  await info.getByText('版本与构建信息 · v0.2.0', { exact: true }).click();
  const text = info.getByLabel('构建信息文本', { exact: true });
  const report = JSON.parse(await text.inputValue());
  expect(report.version).toBe('0.2.0');
  expect(report.revision).toMatch(/^[a-f0-9]{40,64}$/);
  expect(report.mode).toBe('development');
  expect(report.runtime).toBe('browser');
  expect(Object.keys(report).sort()).toEqual([
    'builtAt',
    'dirty',
    'format',
    'mode',
    'revision',
    'runtime',
    'schemaVersion',
    'version',
  ]);
  await info.getByRole('button', { name: '复制构建信息', exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => window.__buildReport))).toEqual(
    report,
  );
  await expect(info).toContainText('构建信息已复制');
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw Error('denied');
    };
  });
  await info.getByRole('button', { name: '复制构建信息', exact: true }).click();
  await expect(info).toContainText('复制失败，请选中文本手动复制');
  await expect(text).toHaveAttribute('readonly', '');
  await page.getByLabel('语言', { exact: true }).selectOption('zh-TW');
  await expect(info.getByLabel('建置資訊文字', { exact: true })).toHaveValue(
    JSON.stringify(report, null, 2),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await info.screenshot({ path: testInfo.outputPath('build-info-mobile.png') });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

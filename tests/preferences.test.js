import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readPreferences, savePreferences } from '../src/core/preferences.js';
import { translate } from '../src/core/i18n.js';
it('语言及配色可恢复，无效或禁用存储使用安全默认值', () => {
  const storage = {
    getItem: () => JSON.stringify({ locale: 'zh-TW', theme: 'light' }),
  };
  assert.deepEqual(readPreferences(storage, 'zh-CN'), {
    locale: 'zh-TW',
    theme: 'light',
  });
  assert.equal(
    readPreferences({ getItem: () => '{invalid' }, 'zh-HK').locale,
    'zh-TW',
  );
  assert.equal(
    readPreferences(
      { getItem: () => JSON.stringify({ theme: 'bad', locale: 'bad' }) },
      'en',
    ).theme,
    'navy',
  );
  assert.doesNotThrow(() =>
    savePreferences(
      { locale: 'zh-TW', theme: 'jade' },
      {
        setItem: () => {
          throw new Error('blocked');
        },
      },
    ),
  );
  let saved;
  savePreferences(
    { locale: 'zh-TW', theme: 'jade', transactions: ['private'] },
    { setItem: (key, value) => (saved = JSON.parse(value)) },
  );
  assert.deepEqual(saved, { locale: 'zh-TW', theme: 'jade' });
});
it('翻译动态文案和诊断信息，不更改商户原始文本', () => {
  assert.equal(
    translate('zh-TW', '已导入 {count} 笔交易', { count: 2 }),
    '已匯入 2 筆交易',
  );
  assert.equal(
    translate('zh-TW', 'CSV 第 3 行：交易分类无效'),
    'CSV 第 3 行：交易分類無效',
  );
  assert.equal(translate('zh-TW', 'SHOP 商户原文'), 'SHOP 商户原文');
  assert.equal(translate('zh-CN', '活动名称'), '活动名称');
});

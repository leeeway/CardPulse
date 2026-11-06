import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeCampaignRules,
  parseCampaignRules,
  instantiateCampaignRules,
  copyCampaign,
  MAX_RULES_BYTES,
} from '../src/core/campaign-rules.js';
import { calculateCampaign } from '../src/core/campaigns.js';
const campaign = (patch = {}) => ({
  id: 'original',
  name: 'Example campaign',
  bankId: 'bochk',
  cardId: 'bochk_custom',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  ratePercent: '5',
  period: 'monthly',
  dateBasis: 'posting',
  channel: 'online',
  spendingCap: '1000',
  rewardCap: '30',
  minSpend: '100',
  merchant: 'Example',
  last4: '1234',
  registrationConfirmed: true,
  ...patch,
});
const wrap = (rules, patch = {}) =>
  JSON.stringify({
    format: 'CardPulseCampaigns',
    version: 1,
    campaigns: rules,
    ...patch,
  });

it('规则导出严格投影，不泄漏交易、文件、卡号和确认状态，保持计算配置可往返', () => {
  const source = campaign({
    transactions: ['SECRET'],
    sources: [{ fileName: 'PRIVATE.pdf' }],
    password: 'secret',
  });
  const content = serializeCampaignRules([source]);
  const parsed = parseCampaignRules('\uFEFF' + content);
  for (const text of [
    'SECRET',
    'PRIVATE.pdf',
    'secret',
    '1234',
    'registrationConfirmed',
    '"id"',
  ])
    assert.ok(!content.includes(text));
  const [imported] = instantiateCampaignRules(parsed, [source]);
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.registrationConfirmed, false);
  assert.equal(imported.last4, '');
  for (const field of [
    'name',
    'bankId',
    'cardId',
    'currency',
    'startDate',
    'endDate',
    'ratePercent',
    'period',
    'dateBasis',
    'channel',
    'spendingCap',
    'rewardCap',
    'minSpend',
    'merchant',
  ])
    assert.equal(imported[field], source[field]);
  const tx = {
    id: 'tx',
    bankId: 'bochk',
    ruleId: 'bochk_custom',
    day: '2026-10-01',
    description: 'Example SHOP',
    amount: '100.00',
    currency: 'HKD',
    direction: 'debit',
    category: 'spend',
    last4: '1234',
    channel: { key: 'online' },
  };
  const options = { today: '2026-12-31' };
  assert.equal(calculateCampaign([tx], imported, options).cashback, 0n);
  assert.equal(
    calculateCampaign(
      [tx],
      { ...imported, last4: source.last4, registrationConfirmed: true },
      options,
    ).cashback,
    calculateCampaign([tx], source, options).cashback,
  );
});

it('未知版本、未知字段、恶意字段类型及损坏的批次整体拒绝', () => {
  const rule = parseCampaignRules(serializeCampaignRules([campaign()]))[0];
  for (const value of [
    '{bad',
    'null',
    wrap([rule], { version: 3 }),
    wrap([rule], { transactions: [] }),
    wrap([{ ...rule, id: 'overwrite' }]),
    wrap([{ ...rule, last4: '1234' }]),
    wrap([{ ...rule, registrationConfirmed: true }]),
    wrap([{ ...rule, cardId: false }]),
    wrap([{ ...rule, merchant: {} }]),
    wrap([rule, { ...rule, ratePercent: '101' }]),
    wrap([{ ...rule, startDate: '2026-02-30' }]),
    wrap([{ ...rule, bankId: '__proto__' }]),
  ])
    assert.throws(() => parseCampaignRules(value));
  assert.throws(() =>
    parseCampaignRules(
      wrap([rule]).replace('"name":', '"__proto__":{},"name":'),
    ),
  );
});

it('结单周期通过第 2 版共享及复制，旧规则仍导出第 1 版；错误结单配置整批拒绝', () => {
  const original = campaign({ period: 'statement', statementDay: '31' });
  const content = serializeCampaignRules([campaign(), original]);
  assert.equal(JSON.parse(content).version, 2);
  const rules = parseCampaignRules(content);
  assert.equal(rules[1].statementDay, '31');
  assert.equal(copyCampaign(original, '（副本）').statementDay, '31');
  assert.equal(instantiateCampaignRules(rules)[1].statementDay, '31');
  assert.equal(JSON.parse(serializeCampaignRules([campaign()])).version, 1);
  assert.ok(!Object.hasOwn(rules[0], 'statementDay'));
  for (const value of [
    wrap(rules),
    wrap([{ ...rules[0], statementDay: '25' }], { version: 2 }),
    wrap([{ ...rules[1], statementDay: false }], { version: 2 }),
    wrap([rules[0], { ...rules[1], statementDay: '32' }], { version: 2 }),
    wrap([{ ...rules[1], statementDay: undefined }], { version: 2 }),
  ])
    assert.throws(() => parseCampaignRules(value));
});

it('文件字节数与批次数量边界被校验，数字配置规范化且空上限仍保持不限', () => {
  const fifty = Array.from({ length: 50 }, () =>
    campaign({ ratePercent: 5, spendingCap: null, rewardCap: 0 }),
  );
  const result = parseCampaignRules(serializeCampaignRules(fifty));
  assert.equal(result.length, 50);
  assert.equal(result[0].ratePercent, '5');
  assert.equal(result[0].spendingCap, '');
  assert.equal(result[0].rewardCap, '0');
  assert.throws(() => serializeCampaignRules([]));
  assert.throws(() => serializeCampaignRules([...fifty, campaign()]));
  assert.throws(
    () => parseCampaignRules('中'.repeat(MAX_RULES_BYTES / 3 + 1)),
    /256 KB/,
  );
});

it('重复导入不会复用标识，生成标识冲突时批次不能部分生效', () => {
  const rules = parseCampaignRules(
    serializeCampaignRules([campaign(), campaign({ name: 'Second' })]),
  );
  let index = 0;
  const first = instantiateCampaignRules(rules, [], () => `new-${++index}`);
  const second = instantiateCampaignRules(rules, first, () => `new-${++index}`);
  assert.equal(new Set([...first, ...second].map((c) => c.id)).size, 4);
  assert.throws(
    () => instantiateCampaignRules(rules, first, () => 'new-1'),
    /标识/,
  );
  assert.equal(first.length, 2);
});

it('本地复制保留末四位但取消资格确认，名称长度和Unicode字符均有效，原活动不变', () => {
  const original = campaign({ name: '🦄'.repeat(40) });
  const copied = copyCampaign(original, '（副本）');
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.last4, '1234');
  assert.equal(copied.registrationConfirmed, false);
  assert.ok(copied.name.length <= 80);
  assert.ok(copied.name.endsWith('（副本）'));
  assert.ok(!/\uFFFD/.test(copied.name));
  assert.equal(original.registrationConfirmed, true);
  assert.equal(original.name.length, 80);
});

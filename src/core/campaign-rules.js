import { validateCampaign } from './campaigns.js';
import { isProgressive } from './campaign-tiers.js';

export const MAX_RULES_BYTES = 256 * 1024;
export const MAX_RULES_COUNT = 50;
const fields = [
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
];
const numericFields = ['ratePercent', 'spendingCap', 'rewardCap', 'minSpend'];
const optionalFields = [
  'cardId',
  'spendingCap',
  'rewardCap',
  'minSpend',
  'merchant',
];
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function projectRule(value) {
  if (!record(value)) throw new Error('活动规则格式无效');
  const selected = Object.fromEntries(
    fields.map((field) => [
      field,
      value[field] == null && optionalFields.includes(field)
        ? ''
        : value[field],
    ]),
  );
  for (const field of fields) {
    const type = typeof selected[field];
    if (
      type !== 'string' &&
      !(numericFields.includes(field) && type === 'number')
    )
      throw new Error('活动规则字段类型无效');
  }
  const valid = validateCampaign({
    ...selected,
    ...(value.rewardType != null ? { rewardType: value.rewardType } : {}),
    ...(value.tiers != null ? { tiers: value.tiers } : {}),
    ...(value.period === 'statement'
      ? { statementDay: value.statementDay }
      : {}),
    last4: '',
    registrationConfirmed: false,
  });
  const projected = Object.fromEntries(
    fields.map((field) => [
      field,
      numericFields.includes(field) ? String(valid[field]) : valid[field],
    ]),
  );
  if (valid.period === 'statement')
    projected.statementDay = String(valid.statementDay);
  if (isProgressive(valid)) {
    projected.rewardType = 'progressive';
    projected.tiers = valid.tiers;
  }
  return projected;
}

function checkCount(rules) {
  if (!Array.isArray(rules) || !rules.length || rules.length > MAX_RULES_COUNT)
    throw new Error('活动规则须包含 1 至 50 个活动');
}

export function serializeCampaignRules(campaigns) {
  checkCount(campaigns);
  const rules = campaigns.map(projectRule);
  // Explicit projection prevents extra workspace fields from leaking into a shared file.
  const content = JSON.stringify(
    {
      format: 'CardPulseCampaigns',
      version: rules.some(isProgressive)
        ? 3
        : rules.some((rule) => rule.period === 'statement')
          ? 2
          : 1,
      campaigns: rules,
    },
    null,
    2,
  );
  if (new TextEncoder().encode(content).length > MAX_RULES_BYTES)
    throw new Error('活动规则文件不能超过 256 KB');
  return content;
}

export function parseCampaignRules(content) {
  if (
    typeof content !== 'string' ||
    new TextEncoder().encode(content).length > MAX_RULES_BYTES
  )
    throw new Error('活动规则文件不能超过 256 KB');
  let data;
  try {
    data = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('活动规则文件不是有效的 JSON');
  }
  if (
    !record(data) ||
    data.format !== 'CardPulseCampaigns' ||
    ![1, 2, 3].includes(data.version)
  )
    throw new Error('活动规则格式或版本不受支持');
  if (
    Object.keys(data).some(
      (key) => !['format', 'version', 'campaigns'].includes(key),
    )
  )
    throw new Error('活动规则包含不支持的字段');
  checkCount(data.campaigns);
  return data.campaigns.map((value) => {
    if (
      !record(value) ||
      Object.keys(value).some(
        (key) =>
          !fields.includes(key) &&
          !(data.version >= 2 && key === 'statementDay') &&
          !(data.version === 3 && ['rewardType', 'tiers'].includes(key)),
      )
    )
      throw new Error('活动规则包含不支持的字段');
    if (data.version === 1 && value.period === 'statement')
      throw new Error('结单周期规则须使用第 2 版规则文件');
    if (value.period !== 'statement' && Object.hasOwn(value, 'statementDay'))
      throw new Error('仅结单周期可设置结单日');
    return projectRule(value);
  });
}

export function instantiateCampaignRules(
  rules,
  existingCampaigns = [],
  createId = () => crypto.randomUUID(),
) {
  checkCount(rules);
  const ids = new Set(existingCampaigns.map((value) => value.id));
  return rules.map((rule) => {
    const projected = projectRule(rule);
    const id = createId();
    if (typeof id !== 'string' || !id.trim() || ids.has(id))
      throw new Error('活动标识重复或无效，请重试');
    ids.add(id);
    return { ...projected, id, last4: '', registrationConfirmed: false };
  });
}

export function copyCampaign(campaign, suffix) {
  const valid = validateCampaign(campaign);
  if (typeof suffix !== 'string' || !suffix || suffix.length > 20)
    throw new Error('活动规则格式无效');
  const name = Array.from(valid.name);
  while (name.join('').length + suffix.length > 80) name.pop();
  return {
    ...projectRule(valid),
    id: crypto.randomUUID(),
    name: name.join('') + suffix,
    last4: valid.last4 || '',
    registrationConfirmed: false,
  };
}

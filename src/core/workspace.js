import { validateCampaign } from './campaigns.js';
import { isIsoDate } from './campaigns.js';
import { cents } from './reconciliation.js';
export const emptyWorkspace = () => ({
  version: 2,
  transactions: [],
  statements: [],
  campaigns: [],
  exchangeRate: null,
});
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value) => value == null || typeof value === 'string';
const strings = (value) =>
  value == null ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));
const uniqueIds = (items) =>
  items.every(
    (item) => record(item) && typeof item.id === 'string' && item.id.trim(),
  ) && new Set(items.map((item) => item.id)).size === items.length;

const validChannel = (value) =>
  value == null ||
  (record(value) &&
    typeof value.key === 'string' &&
    optionalString(value.label) &&
    ['pulse', 'uncertain'].every(
      (key) => value[key] == null || typeof value[key] === 'boolean',
    ));
const validSnapshot = (value) =>
  record(value) &&
  optionalString(value.category) &&
  validChannel(value.channel);
const validHistory = (value) =>
  value == null ||
  (Array.isArray(value) &&
    value.every(
      (change) =>
        record(change) &&
        typeof change.at === 'string' &&
        Number.isFinite(Date.parse(change.at)) &&
        validSnapshot(change.before) &&
        validSnapshot(change.after),
    ));

export function normalizeWorkspace(data) {
  if (
    !record(data) ||
    !Array.isArray(data.transactions) ||
    (data.statements != null && !Array.isArray(data.statements)) ||
    (data.campaigns != null && !Array.isArray(data.campaigns))
  )
    throw new Error('本地库不存在或格式无效');
  // Missing version denotes the original transaction-only vault.
  if (data.version != null && ![1, 2].includes(data.version))
    throw new Error('本地库版本不受支持，请使用兼容版本的应用');
  if (!uniqueIds(data.transactions) || !uniqueIds(data.statements || []))
    throw new Error('本地库不存在或格式无效');
  if (
    data.transactions.some(
      (tx) =>
        !tx ||
        typeof tx.id !== 'string' ||
        !isIsoDate(tx.day) ||
        typeof tx.description !== 'string' ||
        typeof tx.amount !== 'string' ||
        !optionalString(tx.bankId) ||
        !optionalString(tx.ruleId) ||
        !optionalString(tx.category) ||
        !optionalString(tx.last4) ||
        (tx.transactionDay != null &&
          tx.transactionDay !== '' &&
          !isIsoDate(tx.transactionDay)) ||
        !optionalString(tx.statementId) ||
        !validChannel(tx.channel) ||
        !validHistory(tx.reviewHistory) ||
        (tx.sources != null &&
          (!Array.isArray(tx.sources) ||
            tx.sources.some(
              (source) =>
                !record(source) || typeof source.fileName !== 'string',
            ))) ||
        !['CNY', 'HKD'].includes(tx.currency) ||
        !['debit', 'credit'].includes(tx.direction) ||
        (tx.notes != null &&
          (!Array.isArray(tx.notes) ||
            tx.notes.some((note) => typeof note !== 'string'))),
    )
  )
    throw new Error('本地库不存在或格式无效');
  for (const tx of data.transactions)
    if (cents(tx.amount) <= 0n) throw new Error('本地库不存在或格式无效');
  if (
    (data.statements || []).some(
      (statement) =>
        !optionalString(statement.fileName) ||
        !optionalString(statement.bankId) ||
        !optionalString(statement.ruleId) ||
        !strings(statement.warnings) ||
        !strings(statement.currencies) ||
        (statement.transactionCount != null &&
          (!Number.isSafeInteger(statement.transactionCount) ||
            statement.transactionCount < 0)) ||
        (statement.reconciliation != null &&
          (!Array.isArray(statement.reconciliation) ||
            statement.reconciliation.some(
              (result) =>
                !record(result) ||
                !['CNY', 'HKD'].includes(result.currency) ||
                !['matched', 'mismatch', 'unverified'].includes(
                  result.status,
                ) ||
                !optionalString(result.difference),
            ))),
    )
  )
    throw new Error('本地库不存在或格式无效');
  if (
    data.exchangeRate != null &&
    (!(data.exchangeRate.rate > 0) ||
      !Number.isFinite(data.exchangeRate.rate) ||
      data.exchangeRate.rate > 10000 ||
      !isIsoDate(data.exchangeRate.date) ||
      !['manual', 'Frankfurter'].includes(data.exchangeRate.source))
  )
    throw new Error('汇率格式无效');
  const campaigns = (data.campaigns || []).map(validateCampaign);
  if (!uniqueIds(campaigns)) throw new Error('本地库不存在或格式无效');
  return {
    version: 2,
    transactions: data.transactions,
    statements: data.statements || [],
    campaigns,
    exchangeRate: data.exchangeRate || null,
  };
}

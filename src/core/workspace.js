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
export function normalizeWorkspace(data) {
  if (
    !data ||
    !Array.isArray(data.transactions) ||
    (data.statements != null && !Array.isArray(data.statements)) ||
    (data.campaigns != null && !Array.isArray(data.campaigns))
  )
    throw new Error('本地库不存在或格式无效');
  if (
    data.transactions.some(
      (tx) =>
        !tx ||
        typeof tx.id !== 'string' ||
        !isIsoDate(tx.day) ||
        typeof tx.description !== 'string' ||
        typeof tx.amount !== 'string' ||
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
    data.exchangeRate != null &&
    (!(data.exchangeRate.rate > 0) ||
      !Number.isFinite(data.exchangeRate.rate) ||
      data.exchangeRate.rate > 10000 ||
      !isIsoDate(data.exchangeRate.date) ||
      !['manual', 'Frankfurter'].includes(data.exchangeRate.source))
  )
    throw new Error('汇率格式无效');
  const campaigns = (data.campaigns || []).map(validateCampaign);
  if (
    campaigns.some((c) => !c.id) ||
    new Set(campaigns.map((c) => c.id)).size !== campaigns.length
  )
    throw new Error('本地库不存在或格式无效');
  return {
    version: 2,
    transactions: data.transactions,
    statements: data.statements || [],
    campaigns,
    exchangeRate: data.exchangeRate || null,
  };
}

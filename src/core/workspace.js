import { validateCampaign } from './campaigns.js';
export const emptyWorkspace = () => ({
  version: 2,
  transactions: [],
  statements: [],
  campaigns: [],
});
export function normalizeWorkspace(data) {
  if (
    !data ||
    !Array.isArray(data.transactions) ||
    (data.statements != null && !Array.isArray(data.statements)) ||
    (data.campaigns != null && !Array.isArray(data.campaigns))
  )
    throw new Error('本地库不存在或格式无效');
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
  };
}

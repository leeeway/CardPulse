import { cents, formatCents } from './reconciliation.js';
import { toScaledBigInt } from './rewards.js';

export const MAX_CAMPAIGN_TIERS = 8;
export const isProgressive = (campaign) =>
  campaign.rewardType === 'progressive';

export function validateTiers(tiers) {
  if (
    !Array.isArray(tiers) ||
    tiers.length < 2 ||
    tiers.length > MAX_CAMPAIGN_TIERS
  )
    throw new Error('分段费率须包含 2 至 8 段');
  let previous = -1n;
  let hasReward = false;
  return Array.from(tiers, (tier, index) => {
    if (
      !tier ||
      typeof tier !== 'object' ||
      Array.isArray(tier) ||
      Object.keys(tier).some((key) => !['from', 'ratePercent'].includes(key)) ||
      ['from', 'ratePercent'].some(
        (key) => !['string', 'number'].includes(typeof tier[key]),
      )
    )
      throw new Error('分段费率字段无效');
    const from = cents(tier.from);
    const rate = cents(tier.ratePercent);
    if ((index === 0 && from !== 0n) || from <= previous)
      throw new Error('首段须从 0 开始，后续起点须严格递增');
    if (rate < 0n || rate > 10000n)
      throw new Error('各段费率须在 0% 至 100% 之间');
    previous = from;
    hasReward ||= rate > 0n;
    if (index === tiers.length - 1 && !hasReward)
      throw new Error('至少一段费率须大于 0%');
    return {
      from: formatCents(from).replace(/\.00$/, ''),
      ratePercent: formatCents(rate).replace(/\.00$/, ''),
    };
  });
}

// Input tiers have already been validated. Each band taxes only its own spending slice.
export function calculateTierReward(amount, tiers) {
  let numerator = 0n;
  const breakdown = tiers.map((tier, index) => {
    const from = toScaledBigInt(tier.from);
    const to =
      index + 1 < tiers.length ? toScaledBigInt(tiers[index + 1].from) : null;
    const upper = to === null || amount < to ? amount : to;
    const used = upper > from ? upper - from : 0n;
    const weighted = used * cents(tier.ratePercent);
    numerator += weighted;
    return {
      from,
      to,
      used,
      ratePercent: tier.ratePercent,
      reward: weighted / 10000n,
    };
  });
  return { reward: numerator / 10000n, breakdown };
}

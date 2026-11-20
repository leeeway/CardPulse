import { bankOf } from './banks.js';
import { calculateCampaign } from './campaigns.js';
import { calculateRewards } from './rewards.js';

export function previewReviewRewards(before, after, changes, today) {
  const rows = [];
  const add = (key, label, currency, previous, next) => {
    if (previous !== next) rows.push({ key, label, currency, previous, next });
  };
  if (changes.some(({ before: tx }) => bankOf(tx) === 'hsbc')) {
    const previous = calculateRewards(before.transactions, { today });
    const next = calculateRewards(after.transactions, { today });
    const cny = ({ base, world, pulse }) =>
      base.cny + world.cashback + pulse.cashback;
    add('pulse:cny', 'Pulse', 'CNY', cny(previous), cny(next));
    add('pulse:hkd', 'Pulse', 'HKD', previous.base.hkd, next.base.hkd);
  }
  for (const campaign of before.campaigns) {
    if (
      !campaign.registrationConfirmed ||
      !changes.some(
        ({ before: tx }) =>
          bankOf(tx) === campaign.bankId && tx.currency === campaign.currency,
      )
    )
      continue;
    add(
      `campaign:${campaign.id}`,
      campaign.name,
      campaign.currency,
      calculateCampaign(before.transactions, campaign, { today }).cashback,
      calculateCampaign(after.transactions, campaign, { today }).cashback,
    );
  }
  return rows;
}

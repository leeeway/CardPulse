// Date status is independent of eligibility; boundaries use the shared Hong Kong date.
export function campaignStatus(campaign, today) {
  if (today < campaign.startDate) return 'upcoming';
  if (today > campaign.endDate) return 'ended';
  return 'active';
}

export function filterCampaigns(
  campaigns,
  { query = '', status = 'all', today },
) {
  const needle = query.trim().toLowerCase();
  return campaigns.filter((campaign) => {
    const statusMatches =
      status === 'all' ||
      (status === 'unconfirmed'
        ? !campaign.registrationConfirmed
        : campaignStatus(campaign, today) === status);
    return (
      statusMatches &&
      (!needle ||
        [campaign.name, campaign.merchant || ''].some((text) =>
          text.toLowerCase().includes(needle),
        ))
    );
  });
}

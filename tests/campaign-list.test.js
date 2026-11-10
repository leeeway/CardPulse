import { it } from 'node:test';
import assert from 'node:assert/strict';
import { campaignStatus, filterCampaigns } from '../src/core/campaign-list.js';

const active = {
  id: 'a',
  name: 'Online Bonus',
  merchant: 'SHOP',
  startDate: '2026-11-01',
  endDate: '2026-11-10',
  registrationConfirmed: false,
};
const ended = {
  ...active,
  id: 'b',
  name: 'Old',
  endDate: '2026-11-09',
  registrationConfirmed: true,
};
const upcoming = {
  ...active,
  id: 'c',
  name: 'Future',
  merchant: '',
  startDate: '2026-11-11',
  endDate: '2026-12-31',
  registrationConfirmed: true,
};
it('活动日期状态包含起止当日，跨日更新，资格独立', () => {
  assert.equal(campaignStatus(active, '2026-11-01'), 'active');
  assert.equal(campaignStatus(active, '2026-11-10'), 'active');
  assert.equal(campaignStatus(active, '2026-10-31'), 'upcoming');
  assert.equal(campaignStatus(active, '2026-11-11'), 'ended');
});
it('活动搜索组合状态，不更改输入、顺序或资格，可查商户及缺省商户', () => {
  const campaigns = [active, ended, upcoming];
  const original = structuredClone(campaigns);
  const filter = (options) =>
    filterCampaigns(campaigns, { today: '2026-11-10', ...options }).map(
      (c) => c.id,
    );
  assert.deepEqual(filter({ query: ' shop ' }), ['a', 'b']);
  assert.deepEqual(filter({ status: 'active', query: 'BONUS' }), ['a']);
  assert.deepEqual(filter({ status: 'unconfirmed' }), ['a']);
  assert.deepEqual(filter({ status: 'ended' }), ['b']);
  assert.deepEqual(filter({ status: 'upcoming' }), ['c']);
  assert.deepEqual(filter({ query: 'missing' }), []);
  assert.deepEqual(filter({}), ['a', 'b', 'c']);
  assert.deepEqual(
    filterCampaigns([{ ...active, merchant: undefined }], {
      query: 'online',
      today: '2026-11-10',
    }).length,
    1,
  );
  assert.deepEqual(campaigns, original);
});

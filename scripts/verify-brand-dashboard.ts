import assert from 'node:assert/strict';
import type { Deal } from '../types';
import {
  brandStatusPillText,
  buildBrandGettingStarted,
  brandPulseCounts,
  developerSpendInLastDays,
  topCreatorsFromPaidDeals,
} from '../lib/brandDashboard';

assert.equal(brandStatusPillText(0), "You're all caught up.");
assert.equal(brandStatusPillText(1), '1 pitch needs review');
assert.equal(brandStatusPillText(3), '3 pitches need review');

const items = buildBrandGettingStarted({
  hasPhoto: false,
  hasDisplayName: true,
  campaignCount: 0,
  hasCampaignShopLink: false,
  hasInvitedCreator: false,
});
assert.equal(items.filter((i) => i.done).length, 0);
assert.equal(items.length, 4);
assert.equal(items[0]?.id, 'profile');
assert.equal(items[1]?.id, 'campaign');
assert.equal(items[2]?.id, 'shop-link');
assert.equal(items[3]?.id, 'invite');

const done = buildBrandGettingStarted({
  hasPhoto: true,
  hasDisplayName: true,
  campaignCount: 2,
  hasCampaignShopLink: true,
  hasInvitedCreator: true,
});
assert.equal(done.every((i) => i.done), true);

assert.deepEqual(
  brandPulseCounts({ activeCampaigns: 2, openPitches: 4, followers: 10 }),
  { activeCampaigns: 2, openPitches: 4, followers: 10 },
);

const now = Date.now();
const paidFixturesWithinAndOutside30d = [
  {
    id: 'd1',
    influencerId: 'i1',
    influencerName: 'Ada',
    amount: 100,
    paidAt: new Date(now - 2 * 86400000).toISOString(),
    status: 'Completed',
    type: 'completed',
    paymentStatus: 'held',
  },
  {
    id: 'd2',
    influencerId: 'i1',
    influencerName: 'Ada',
    amount: 50,
    paidAt: new Date(now - 40 * 86400000).toISOString(),
    status: 'Completed',
    type: 'completed',
    paymentStatus: 'held',
  },
  {
    id: 'd3',
    influencerId: 'i2',
    influencerName: 'Ben',
    amount: 200,
    paidAt: new Date(now - 1 * 86400000).toISOString(),
    status: 'Completed',
    type: 'completed',
    paymentStatus: 'held',
  },
] as Deal[];

const spend = developerSpendInLastDays(paidFixturesWithinAndOutside30d, 30);
assert.equal(spend, 300);

const tops = topCreatorsFromPaidDeals(paidFixturesWithinAndOutside30d, 3);
assert.equal(tops[0]?.influencerId, 'i2');
assert.equal(tops.find((t) => t.influencerId === 'i1')?.dealCount, 2);

console.log('brandDashboard helpers ok');

import { isDealPaidByDeveloper } from '@/lib/dealPaidStatus';
import type { Deal } from '@/types';

export function brandStatusPillText(newPitchCount: number): string {
  if (newPitchCount <= 0) return "You're all caught up.";
  if (newPitchCount === 1) return '1 pitch needs review';
  return `${newPitchCount} pitches need review`;
}

export type BrandGettingStartedId = 'profile' | 'campaign' | 'shop-link' | 'invite';

export interface BrandGettingStartedItem {
  id: BrandGettingStartedId;
  title: string;
  done: boolean;
}

export interface BrandGettingStartedInput {
  hasPhoto: boolean;
  hasDisplayName: boolean;
  campaignCount: number;
  hasCampaignShopLink: boolean;
  hasInvitedCreator: boolean;
}

export function buildBrandGettingStarted(
  input: BrandGettingStartedInput,
): BrandGettingStartedItem[] {
  return [
    {
      id: 'profile',
      title: 'Complete brand profile',
      done: input.hasPhoto && input.hasDisplayName,
    },
    {
      id: 'campaign',
      title: 'Create your first campaign',
      done: input.campaignCount > 0,
    },
    {
      id: 'shop-link',
      title: 'Add shop/website on a campaign',
      done: input.hasCampaignShopLink,
    },
    {
      id: 'invite',
      title: 'Invite a creator',
      done: input.hasInvitedCreator,
    },
  ];
}

export interface BrandPulseCounts {
  activeCampaigns: number;
  openPitches: number;
  followers: number;
}

export function brandPulseCounts(input: BrandPulseCounts): BrandPulseCounts {
  return {
    activeCampaigns: Math.max(0, input.activeCampaigns),
    openPitches: Math.max(0, input.openPitches),
    followers: Math.max(0, input.followers),
  };
}

export function developerSpendInLastDays(deals: Deal[], days: number): number {
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  return deals
    .filter((deal) => isDealPaidByDeveloper(deal))
    .reduce((sum, deal) => {
      const ts = deal.paidAt ? Date.parse(deal.paidAt) : 0;
      if (!ts || ts < start) return sum;
      return sum + (deal.amount ?? 0);
    }, 0);
}

export interface BrandTopCreator {
  influencerId: string;
  name: string;
  totalSpent: number;
  dealCount: number;
}

export function topCreatorsFromPaidDeals(deals: Deal[], limit = 3): BrandTopCreator[] {
  const map = new Map<string, BrandTopCreator>();
  for (const deal of deals) {
    if (!isDealPaidByDeveloper(deal) || !deal.influencerId) continue;
    const existing = map.get(deal.influencerId);
    const amount = deal.amount ?? 0;
    if (existing) {
      existing.totalSpent += amount;
      existing.dealCount += 1;
    } else {
      map.set(deal.influencerId, {
        influencerId: deal.influencerId,
        name: deal.influencerName?.trim() || 'Creator',
        totalSpent: amount,
        dealCount: 1,
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);
}

/** True if any campaign has a non-empty shop/download URL. */
export function campaignsHaveShopLink(
  campaigns: { appStoreUrl?: string | null }[],
): boolean {
  return campaigns.some((c) => Boolean(c.appStoreUrl?.trim()));
}

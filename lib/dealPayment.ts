import { formatCurrency } from '@/constants/mockData';
import {
  POST_CONFIRMATION_AUTO_RELEASE_MS,
  POST_CONFIRMATION_AUTO_RELEASE_DAYS,
} from '@/lib/dealAutoRelease';
import { isDealPaidByDeveloper } from '@/lib/dealPaidStatus';
import type { Deal } from '@/types';

export { isDealPaidByDeveloper } from '@/lib/dealPaidStatus';

export { POST_CONFIRMATION_AUTO_RELEASE_DAYS, POST_CONFIRMATION_AUTO_RELEASE_MS };
export const PLATFORM_FEE_RATE = 0.08;
export const PLATFORM_FEE_PERCENT = 8;
export const INFLUENCER_PAYOUT_RATE = 1 - PLATFORM_FEE_RATE;
export const INFLUENCER_PAYOUT_PERCENT = Math.round(INFLUENCER_PAYOUT_RATE * 100);

export function influencerPayoutAmount(dealAmount: number): number {
  return Math.round(dealAmount * INFLUENCER_PAYOUT_RATE * 100) / 100;
}

export function formatCurrencyAmount(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  if (hasCents) {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatCurrency(amount);
}

export function formatPayoutBreakdown(dealAmount: number): string {
  const payout = influencerPayoutAmount(dealAmount);
  return `${formatCurrencyAmount(payout)} of ${formatCurrency(dealAmount)} (${INFLUENCER_PAYOUT_PERCENT}% after ${PLATFORM_FEE_PERCENT}% platform fee)`;
}

export function applyPaymentSecuredState(deal: Deal): Deal {
  const amount = deal.amount;
  const payout = influencerPayoutAmount(amount);
  const deadlineDate = new Date();
  deadlineDate.setDate(deadlineDate.getDate() + 14);
  const deadline = deadlineDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (deal.paymentStatus === 'withdrawn' || deal.cashedOutAt) {
    return applyDealCashedOutState(deal);
  }

  if (deal.paymentStatus === 'released' && isDealPostConfirmed(deal)) {
    return applyDealPayoutReleasedState(deal);
  }

  const paidAt = deal.paidAt ?? new Date().toISOString();
  const postAutoReleaseAt = new Date(
    Date.parse(paidAt) + POST_CONFIRMATION_AUTO_RELEASE_MS,
  ).toISOString();

  return {
    ...deal,
    developerReviewStatus: 'accepted',
    type: 'active',
    status: 'Post by deadline',
    statusLabel: 'Paid · post your content',
    paymentStatus: 'held',
    paidAt,
    postAutoReleaseAt,
    totalDays: 14,
    daysLeft: 14,
    deadline,
    deadlineDate,
    detailsDescription: `${deal.appName} paid ${formatCurrency(amount)}. Funds are held until the developer confirms your post is live, or automatically after ${POST_CONFIRMATION_AUTO_RELEASE_DAYS} days. You will receive ${formatCurrencyAmount(payout)} (${INFLUENCER_PAYOUT_PERCENT}%) — Faze keeps a ${PLATFORM_FEE_PERCENT}% platform fee. Post by ${deadline}.`,
  };
}

export function applyDealPayoutReleasedState(deal: Deal): Deal {
  const payout = influencerPayoutAmount(deal.amount);

  return {
    ...deal,
    paymentStatus: 'released',
    statusLabel: `Paid · ${formatCurrencyAmount(payout)} available`,
    detailsDescription: `${deal.appName} confirmed your post — ${formatCurrencyAmount(payout)} (${INFLUENCER_PAYOUT_PERCENT}%) is ready to cash out from Earnings.`,
  };
}

export function applyDealCashedOutState(deal: Deal): Deal {
  const payout = influencerPayoutAmount(deal.amount);

  return {
    ...deal,
    paymentStatus: 'withdrawn',
    statusLabel: `Cashed out · ${formatCurrencyAmount(payout)}`,
    cashedOutAt: deal.cashedOutAt ?? new Date().toISOString(),
  };
}

export function isDealPaymentSecured(deal: Deal): boolean {
  // Payment intent is only saved after the Stripe sheet succeeds.
  return Boolean(deal.paymentIntentId);
}

export function isDealPayoutReleased(deal: Deal): boolean {
  return deal.paymentStatus === 'released' || deal.paymentStatus === 'withdrawn';
}

export function isDealFundsHeld(deal: Deal): boolean {
  if (!isDealPaymentSecured(deal) || isDealCashedOut(deal)) return false;
  return !isDealAvailableToWithdraw(deal);
}

export function isDealAvailableToWithdraw(deal: Deal): boolean {
  return (
    isDealPayoutReleased(deal) &&
    isDealPostConfirmed(deal) &&
    !isDealCashedOut(deal)
  );
}

export function isDealAwaitingDeveloperPayment(deal: Deal): boolean {
  return isDealReadyForDeveloperPayment(deal);
}

/** Creator accepted the developer's counter — developer can pay after video approval. */
export function isDealReadyForDeveloperPayment(deal: Deal): boolean {
  if (isDealPaidByDeveloper(deal)) return false;
  return deal.deliveryStatus === 'approved';
}

export function isDealCashedOut(deal: Deal): boolean {
  return deal.paymentStatus === 'withdrawn';
}

export function isDealPostConfirmed(deal: Deal): boolean {
  return deal.type === 'completed' || deal.status === 'Completed' || Boolean(deal.completedAt);
}

export function applyDealCompletedState(deal: Deal): Deal {
  const completedAt = deal.completedAt ?? new Date().toISOString();

  return {
    ...deal,
    type: 'completed',
    status: 'Completed',
    statusLabel: 'Completed',
    completedAt,
    detailsDescription: deal.postAutoReleased
      ? `${deal.appName} — payout auto-released after ${POST_CONFIRMATION_AUTO_RELEASE_DAYS} days without developer confirmation.`
      : deal.influencerName
        ? `${deal.influencerName}'s post is live — deal complete.`
        : 'Post confirmed — deal complete.',
  };
}

/** Counter UI is only relevant while negotiation is still open. */
export function hasActiveCounterOffer(deal: Deal): boolean {
  if (deal.counterOfferAmount == null) return false;
  if (isDealPaidByDeveloper(deal)) return false;
  if (deal.status === 'Awaiting Payment') return false;
  if (deal.deliveryStatus === 'approved') return false;
  const label = deal.statusLabel?.toLowerCase() ?? '';
  if (label.includes('counter accepted') || label.includes('video approved')) return false;
  return true;
}

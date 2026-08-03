import type { Deal } from '@/types';

export function isDealPaidByDeveloper(deal: Deal): boolean {
  return (
    Boolean(deal.paymentIntentId) ||
    deal.paymentStatus === 'held' ||
    deal.paymentStatus === 'released' ||
    deal.paymentStatus === 'withdrawn'
  );
}

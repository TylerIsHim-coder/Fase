/** Fase platform fee — 15% of deal amount */
export const PLATFORM_FEE_PERCENT = 0.15;

export function calculateFees(amountCents) {
  const applicationFeeAmount = Math.round(amountCents * PLATFORM_FEE_PERCENT);
  const influencerPayoutAmount = amountCents - applicationFeeAmount;

  return {
    totalAmount: amountCents,
    applicationFeeAmount,
    influencerPayoutAmount,
    platformFeePercent: PLATFORM_FEE_PERCENT,
  };
}

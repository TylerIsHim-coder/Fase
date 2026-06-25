/** @typedef {import('stripe').default} Stripe */

export const POST_CONFIRMATION_AUTO_RELEASE_MS = 3 * 24 * 60 * 60 * 1000;

function parseTimestampMs(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value.toDate === 'function') {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

export function getDealPaidAtMs(deal) {
  const paidAt = parseTimestampMs(deal.paidAt);
  if (paidAt != null) return paidAt;

  const postAutoReleaseAt = parseTimestampMs(deal.postAutoReleaseAt);
  if (postAutoReleaseAt != null) {
    return postAutoReleaseAt - POST_CONFIRMATION_AUTO_RELEASE_MS;
  }

  return null;
}

export function isDealEligibleForAutoPostRelease(deal, nowMs = Date.now()) {
  if (!deal?.paymentIntentId) return false;
  if (deal.paymentStatus === 'released' || deal.paymentStatus === 'withdrawn') return false;
  if (deal.completedAt || deal.type === 'completed' || deal.status === 'Completed') return false;

  const paidAt = getDealPaidAtMs(deal);
  if (paidAt == null) return false;

  return nowMs >= paidAt + POST_CONFIRMATION_AUTO_RELEASE_MS;
}

function transferIdFromCharge(charge) {
  if (!charge?.transfer) return null;
  return typeof charge.transfer === 'string' ? charge.transfer : charge.transfer.id;
}

function isTransferAlreadyExistsError(error) {
  const message = error?.message ?? '';
  return (
    message.includes('already a transfer using this source') ||
    message.includes('must not exceed the source amount')
  );
}

function isInsufficientFundsError(error) {
  const message = error?.message ?? '';
  return message.includes('insufficient available funds');
}

function rejectsSourceTransactionParam(error) {
  const message = error?.message ?? '';
  return message.includes('unknown parameter') && message.includes('source_transaction');
}

async function findExistingDealTransfer(stripe, { dealId, chargeId, influencerStripeAccountId }) {
  const charge = await stripe.charges.retrieve(chargeId);
  const fromCharge = transferIdFromCharge(charge);
  if (fromCharge) {
    return fromCharge;
  }

  const byGroup = await stripe.transfers.list({
    transfer_group: dealId,
    limit: 10,
  });

  if (byGroup.data.length > 0) {
    const match =
      byGroup.data.find((transfer) => transfer.destination === influencerStripeAccountId) ??
      byGroup.data[0];
    return match.id;
  }

  return null;
}

async function createDealTransfer(stripe, input, { useSourceTransaction }) {
  const payload = {
    amount: input.influencerPayoutAmount,
    currency: input.currency,
    destination: input.influencerStripeAccountId,
    transfer_group: input.dealId,
    metadata: {
      dealId: input.dealId,
      paymentIntentId: input.paymentIntentId,
      developerId: input.developerId,
    },
  };

  if (useSourceTransaction) {
    payload.source_transaction = input.chargeId;
  }

  return stripe.transfers.create(payload);
}

export async function resolveInfluencerTransfer(
  stripe,
  {
    chargeId,
    dealId,
    paymentIntentId,
    developerId,
    influencerStripeAccountId,
    influencerPayoutAmount,
    currency,
  },
) {
  const existingTransferId = await findExistingDealTransfer(stripe, {
    dealId,
    chargeId,
    influencerStripeAccountId,
  });

  if (existingTransferId) {
    return { transferId: existingTransferId, alreadyTransferred: true };
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (paymentIntent.transfer_data?.destination) {
    console.info('[dealPayoutRelease] Legacy destination charge — payout already sent at payment', {
      dealId,
      paymentIntentId,
    });
    return { transferId: null, alreadyTransferred: true };
  }

  const input = {
    chargeId,
    dealId,
    paymentIntentId,
    developerId,
    influencerStripeAccountId,
    influencerPayoutAmount,
    currency,
  };

  let useSourceTransaction = true;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const transfer = await createDealTransfer(stripe, input, { useSourceTransaction });
      return { transferId: transfer.id, alreadyTransferred: false };
    } catch (error) {
      if (rejectsSourceTransactionParam(error)) {
        useSourceTransaction = false;
        continue;
      }

      if (isTransferAlreadyExistsError(error)) {
        const retryTransferId = await findExistingDealTransfer(stripe, {
          dealId,
          chargeId,
          influencerStripeAccountId,
        });
        if (retryTransferId) {
          return { transferId: retryTransferId, alreadyTransferred: true };
        }
        return { transferId: null, alreadyTransferred: true };
      }

      if (isInsufficientFundsError(error) && useSourceTransaction) {
        useSourceTransaction = false;
        continue;
      }

      if (isInsufficientFundsError(error)) {
        const charge = await stripe.charges.retrieve(chargeId);
        if (transferIdFromCharge(charge)) {
          return { transferId: transferIdFromCharge(charge), alreadyTransferred: true };
        }
      }

      throw error;
    }
  }

  throw new Error('Could not release payout — try again in a few minutes.');
}

/**
 * @param {Stripe} stripe
 * @param {object} deal
 * @param {string} influencerStripeAccountId
 */
export async function releaseDealPayoutForDeal(stripe, deal, influencerStripeAccountId) {
  const paymentIntent = await stripe.paymentIntents.retrieve(deal.paymentIntentId);

  if (paymentIntent.status !== 'succeeded') {
    throw new Error(`Payment is not complete (status: ${paymentIntent.status})`);
  }

  const influencerPayoutAmount = Number(
    paymentIntent.metadata?.influencerPayoutAmount ?? deal.influencerPayoutAmount,
  );

  if (!Number.isFinite(influencerPayoutAmount) || influencerPayoutAmount < 50) {
    throw new Error('Invalid influencer payout amount');
  }

  const chargeId =
    typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;

  if (!chargeId) {
    throw new Error('Payment charge not found');
  }

  return resolveInfluencerTransfer(stripe, {
    chargeId,
    dealId: deal.dealId,
    paymentIntentId: paymentIntent.id,
    developerId: deal.developerId,
    influencerStripeAccountId,
    influencerPayoutAmount,
    currency: paymentIntent.currency ?? 'usd',
  });
}

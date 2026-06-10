import { Router } from 'express';

import { getPublishableKey, getStripe } from '../config/stripe.js';
import { calculateFees } from '../lib/fees.js';
import { getDealForPayoutRelease, markDealPayoutReleased } from '../lib/firestoreDeals.js';
import { getUserStripeAccountId, saveUserStripeAccountId } from '../lib/firestoreUsers.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

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

/**
 * Escrow payments need a manual transfer on post confirm. Legacy destination
 * charges already moved funds when the developer paid — detect and skip.
 */
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

async function resolveInfluencerTransfer(
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

  try {
    const transfer = await stripe.transfers.create({
      amount: influencerPayoutAmount,
      currency,
      destination: influencerStripeAccountId,
      transfer_group: dealId,
      metadata: {
        dealId,
        paymentIntentId,
        developerId,
      },
    });

    return { transferId: transfer.id, alreadyTransferred: false };
  } catch (error) {
    if (!isTransferAlreadyExistsError(error)) {
      throw error;
    }

    const retryTransferId = await findExistingDealTransfer(stripe, {
      dealId,
      chargeId,
      influencerStripeAccountId,
    });

    if (retryTransferId) {
      return { transferId: retryTransferId, alreadyTransferred: true };
    }

    console.info('[release-deal-payout] Legacy destination charge — marking released without transfer', {
      dealId,
      chargeId,
    });

    return { transferId: null, alreadyTransferred: true };
  }
}

/**
 * GET /influencer-stripe-account/:influencerId
 * Developers use this to check if a creator can receive payouts.
 */
router.get('/influencer-stripe-account/:influencerId', requireAuth, async (req, res) => {
  try {
    const { influencerId } = req.params;
    if (!influencerId) {
      return res.status(400).json({ error: 'influencerId is required' });
    }

    const stripeAccountId = await getUserStripeAccountId(influencerId);

    return res.json({
      influencerId,
      stripeAccountId,
      connected: Boolean(stripeAccountId),
    });
  } catch (error) {
    console.error('[influencer-stripe-account]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to load Stripe account' });
  }
});

function getConnectUrls(body) {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3001';

  return {
    refreshUrl: body.refreshUrl ?? `${appUrl}/connect/refresh`,
    returnUrl: body.returnUrl ?? `${appUrl}/connect/return`,
  };
}

/**
 * POST /create-account-link
 * Returns a fresh Stripe onboarding link for an existing connected account.
 */
router.post('/create-account-link', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { accountId } = req.body ?? {};
    const { refreshUrl, returnUrl } = getConnectUrls(req.body ?? {});

    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const account = await stripe.accounts.retrieve(accountId);

    if (account.metadata?.firebaseUid && account.metadata.firebaseUid !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized for this connected account' });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    await saveUserStripeAccountId(req.user.uid, accountId);

    return res.json({
      accountId,
      onboardingUrl: accountLink.url,
      expiresAt: accountLink.expires_at,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  } catch (error) {
    console.error('[create-account-link]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to create account link' });
  }
});

/**
 * POST /create-connected-account
 * Creates a Stripe Connect Express account for an influencer and returns onboarding URL.
 */
router.post('/create-connected-account', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { email, country = 'US' } = req.body ?? {};
    const { refreshUrl, returnUrl } = getConnectUrls(req.body ?? {});

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country,
      email,
      capabilities: {
        transfers: { requested: true },
      },
      metadata: {
        firebaseUid: req.user.uid,
      },
    });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    await saveUserStripeAccountId(req.user.uid, account.id);

    return res.json({
      accountId: account.id,
      onboardingUrl: accountLink.url,
      expiresAt: accountLink.expires_at,
    });
  } catch (error) {
    console.error('[create-connected-account]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to create connected account' });
  }
});

/**
 * POST /create-payment-intent
 * Developer pays after video approval — funds capture to Fase immediately.
 * Influencer payout is released separately when the developer confirms the post.
 */
router.post('/create-payment-intent', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const {
      amount,
      currency = 'usd',
      dealId,
      influencerStripeAccountId,
      description,
    } = req.body ?? {};

    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'amount (cents) must be at least 50' });
    }

    if (!dealId) {
      return res.status(400).json({ error: 'dealId is required' });
    }

    if (!influencerStripeAccountId) {
      return res.status(400).json({ error: 'influencerStripeAccountId is required' });
    }

    const amountCents = Math.round(amount);
    const fees = calculateFees(amountCents);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      capture_method: 'automatic',
      automatic_payment_methods: { enabled: true },
      transfer_group: dealId,
      description: description ?? `Fase deal ${dealId}`,
      metadata: {
        dealId,
        developerId: req.user.uid,
        influencerStripeAccountId,
        platformFeeAmount: String(fees.applicationFeeAmount),
        influencerPayoutAmount: String(fees.influencerPayoutAmount),
      },
    });

    return res.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      publishableKey: getPublishableKey(),
      status: paymentIntent.status,
      fees,
    });
  } catch (error) {
    console.error('[create-payment-intent]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to create payment intent' });
  }
});

/**
 * POST /release-deal-payout
 * Developer confirms post delivered — transfers held funds (85%) to the influencer.
 */
router.post('/release-deal-payout', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { dealId } = req.body ?? {};

    if (!dealId) {
      return res.status(400).json({ error: 'dealId is required' });
    }

    const deal = await getDealForPayoutRelease(dealId);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (deal.developerId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized to release this payout' });
    }

    if (!deal.paymentIntentId) {
      return res.status(400).json({ error: 'Deal has no payment on file' });
    }

    if (deal.paymentStatus === 'released' || deal.paymentStatus === 'withdrawn') {
      return res.json({
        status: 'already_released',
        dealId,
        transferId: deal.stripeTransferId ?? null,
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(deal.paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: `Payment is not complete (status: ${paymentIntent.status})`,
      });
    }

    const influencerStripeAccountId =
      paymentIntent.metadata?.influencerStripeAccountId ?? deal.influencerStripeAccountId;
    const influencerPayoutAmount = Number(
      paymentIntent.metadata?.influencerPayoutAmount ?? deal.influencerPayoutAmount,
    );

    if (!influencerStripeAccountId) {
      return res.status(400).json({ error: 'Influencer Stripe account is missing' });
    }

    if (!Number.isFinite(influencerPayoutAmount) || influencerPayoutAmount < 50) {
      return res.status(400).json({ error: 'Invalid influencer payout amount' });
    }

    const chargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

    if (!chargeId) {
      return res.status(400).json({ error: 'Payment charge not found' });
    }

    const { transferId, alreadyTransferred } = await resolveInfluencerTransfer(stripe, {
      chargeId,
      dealId,
      paymentIntentId: paymentIntent.id,
      developerId: req.user.uid,
      influencerStripeAccountId,
      influencerPayoutAmount,
      currency: paymentIntent.currency ?? 'usd',
    });

    await markDealPayoutReleased(dealId, transferId);

    return res.json({
      status: alreadyTransferred ? 'already_transferred' : 'released',
      dealId,
      transferId,
      influencerPayoutAmount,
    });
  } catch (error) {
    console.error('[release-deal-payout]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to release deal payout' });
  }
});

/**
 * POST /cancel-deal-payment
 * Cancels an uncaptured payment or refunds a captured one when a deal falls through.
 */
router.post('/cancel-deal-payment', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { paymentIntentId } = req.body ?? {};

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'paymentIntentId is required' });
    }

    const existing = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (existing.status === 'canceled') {
      return res.json({ status: 'already_canceled', paymentIntentId: existing.id });
    }

    if (existing.status === 'requires_capture') {
      const canceled = await stripe.paymentIntents.cancel(paymentIntentId);
      return res.json({ status: 'canceled', paymentIntentId: canceled.id });
    }

    if (existing.status === 'succeeded') {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
      return res.json({ status: 'refunded', paymentIntentId: existing.id, refundId: refund.id });
    }

    return res.status(400).json({
      error: `Payment cannot be canceled in status: ${existing.status}`,
    });
  } catch (error) {
    console.error('[cancel-deal-payment]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to cancel deal payment' });
  }
});

/**
 * GET /influencer-balance
 * Returns the connected account's Stripe balance (available + pending).
 */
router.get('/influencer-balance', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const accountId = await getUserStripeAccountId(req.user.uid);

    if (!accountId) {
      return res.json({ available: 0, pending: 0, connected: false });
    }

    const balance = await stripe.balance.retrieve({ stripeAccount: accountId });

    const sum = (entries, currency = 'usd') =>
      entries
        .filter((entry) => entry.currency === currency)
        .reduce((total, entry) => total + entry.amount, 0);

    return res.json({
      available: sum(balance.available),
      pending: sum(balance.pending),
      connected: true,
      accountId,
    });
  } catch (error) {
    console.error('[influencer-balance]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to load balance' });
  }
});

/**
 * POST /create-express-login-link
 * Opens the influencer's Stripe Express dashboard to manage payouts.
 */
router.post('/create-express-login-link', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const accountId = await getUserStripeAccountId(req.user.uid);

    if (!accountId) {
      return res.status(400).json({ error: 'Connect Stripe on your profile first.' });
    }

    const loginLink = await stripe.accounts.createLoginLink(accountId);

    return res.json({
      url: loginLink.url,
      accountId,
    });
  } catch (error) {
    console.error('[create-express-login-link]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to create Stripe login link' });
  }
});

/**
 * POST /create-pack-payment-intent
 * Developer purchases a campaign boost pack — charged directly to Fase (no Connect split).
 */
router.post('/create-pack-payment-intent', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { packTierId, campaignId } = req.body ?? {};

    const PACK_PRICES_CENTS = {
      starter: 299,
      pro: 499,
      legend: 999,
    };

    if (!packTierId || !(packTierId in PACK_PRICES_CENTS)) {
      return res.status(400).json({ error: 'Valid packTierId is required (starter, pro, legend)' });
    }

    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }

    const amountCents = PACK_PRICES_CENTS[packTierId];

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: `Fase ${packTierId} campaign pack`,
      metadata: {
        type: 'campaign_pack',
        packTierId,
        campaignId,
        developerId: req.user.uid,
      },
    });

    return res.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      publishableKey: getPublishableKey(),
      status: paymentIntent.status,
      amount: amountCents,
    });
  } catch (error) {
    console.error('[create-pack-payment-intent]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to create pack payment intent' });
  }
});

export default router;

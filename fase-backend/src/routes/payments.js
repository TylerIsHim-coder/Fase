import { Router } from 'express';

import { getPublishableKey, getStripe } from '../config/stripe.js';
import { calculateFees } from '../lib/fees.js';
import {
  isDealEligibleForAutoPostRelease,
  releaseDealPayoutForDeal,
} from '../lib/dealPayoutRelease.js';
import {
  getDealForPayoutRelease,
  markDealPayoutReleased,
} from '../lib/firestoreDeals.js';
import { getConnectUrls } from '../lib/connectUrls.js';
import {
  getInfluencerStripeStatus,
  reconcileStripeAccountId,
  resolveStripeAccountId,
} from '../lib/stripeAccountStatus.js';
import { getUserStripeAccountId, saveUserStripeAccountId } from '../lib/firestoreUsers.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

async function resolveInfluencerStripeAccountId(deal, paymentIntent) {
  let influencerStripeAccountId =
    paymentIntent.metadata?.influencerStripeAccountId ?? deal.influencerStripeAccountId;

  if (deal.influencerId) {
    const currentStripeAccountId = await getUserStripeAccountId(deal.influencerId);
    if (currentStripeAccountId) {
      influencerStripeAccountId = currentStripeAccountId;
    }
  }

  return influencerStripeAccountId;
}

async function executeDealPayoutRelease(deal, influencerStripeAccountId, options = {}) {
  const stripe = getStripe();
  const { transferId, alreadyTransferred } = await releaseDealPayoutForDeal(
    stripe,
    deal,
    influencerStripeAccountId,
  );

  await markDealPayoutReleased(deal.dealId, transferId, options);

  return {
    status: alreadyTransferred ? 'already_transferred' : 'released',
    dealId: deal.dealId,
    transferId,
  };
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

    const status = await getInfluencerStripeStatus(influencerId);
    return res.json(status);
  } catch (error) {
    console.error('[influencer-stripe-account]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to load Stripe account' });
  }
});

/**
 * POST /reconcile-stripe-account
 * Re-links the signed-in user to their best Stripe Connect account (by Firebase UID + email).
 */
router.post('/reconcile-stripe-account', requireAuth, async (req, res) => {
  try {
    const { email } = req.body ?? {};
    await reconcileStripeAccountId(req.user.uid, email);
    const status = await getInfluencerStripeStatus(req.user.uid);
    return res.json(status);
  } catch (error) {
    console.error('[reconcile-stripe-account]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to reconcile Stripe account' });
  }
});

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
    const message = error.message ?? 'Failed to create account link';
    const status = message.includes('HTTPS redirect URLs') ? 400 : 500;
    return res.status(status).json({ error: message });
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

    const existingAccountId = await resolveStripeAccountId(req.user.uid, email);
    if (existingAccountId) {
      const account = await stripe.accounts.retrieve(existingAccountId);
      const accountLink = await stripe.accountLinks.create({
        account: existingAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      await saveUserStripeAccountId(req.user.uid, existingAccountId);

      return res.json({
        accountId: existingAccountId,
        onboardingUrl: accountLink.url,
        expiresAt: accountLink.expires_at,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      });
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
    const message = error.message ?? 'Failed to create connected account';
    const status = message.includes('HTTPS redirect URLs') ? 400 : 500;
    return res.status(status).json({ error: message });
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
 * Developer confirms post delivered — transfers held funds (95%) to the influencer.
 */
router.post('/release-deal-payout', requireAuth, async (req, res) => {
  try {
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

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(deal.paymentIntentId);
    const influencerStripeAccountId = await resolveInfluencerStripeAccountId(deal, paymentIntent);

    if (!influencerStripeAccountId) {
      return res.status(400).json({ error: 'Influencer Stripe account is missing' });
    }

    const result = await executeDealPayoutRelease(deal, influencerStripeAccountId, {
      markCompleted: true,
    });

    return res.json(result);
  } catch (error) {
    console.error('[release-deal-payout]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to release deal payout' });
  }
});

/**
 * POST /auto-release-deal-payout
 * Influencer-triggered release after the developer misses the 3-day post confirmation window.
 */
router.post('/auto-release-deal-payout', requireAuth, async (req, res) => {
  try {
    const { dealId } = req.body ?? {};

    if (!dealId) {
      return res.status(400).json({ error: 'dealId is required' });
    }

    const deal = await getDealForPayoutRelease(dealId);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (deal.influencerId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized to auto-release this payout' });
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

    if (!isDealEligibleForAutoPostRelease(deal)) {
      return res.status(400).json({
        error: 'Payout auto-release is not available yet. The developer has 3 days to confirm the post.',
      });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(deal.paymentIntentId);
    const influencerStripeAccountId = await resolveInfluencerStripeAccountId(deal, paymentIntent);

    if (!influencerStripeAccountId) {
      return res.status(400).json({ error: 'Influencer Stripe account is missing' });
    }

    const result = await executeDealPayoutRelease(deal, influencerStripeAccountId, {
      markCompleted: true,
      autoReleased: true,
    });

    return res.json({
      ...result,
      autoReleased: true,
    });
  } catch (error) {
    console.error('[auto-release-deal-payout]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to auto-release deal payout' });
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

/**
 * POST /create-contest-payment-intent
 * Developer funds a CPM contest prize pool — charged directly to Fase.
 */
router.post('/create-contest-payment-intent', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { amount, currency = 'usd', contestId, description } = req.body ?? {};

    if (!amount || amount < 10000) {
      return res.status(400).json({ error: 'amount (cents) must be at least 10000 ($100 minimum)' });
    }

    if (!contestId) {
      return res.status(400).json({ error: 'contestId is required' });
    }

    const amountCents = Math.round(amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      description: description ?? `Fase contest ${contestId}`,
      metadata: {
        type: 'contest',
        contestId,
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
    console.error('[create-contest-payment-intent]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to create contest payment intent' });
  }
});

export default router;

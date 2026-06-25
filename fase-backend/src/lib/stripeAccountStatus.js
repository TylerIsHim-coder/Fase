import { getStripe } from '../config/stripe.js';
import {
  getUserEmail,
  getUserStripeAccountId,
  saveUserStripeAccountId,
} from './firestoreUsers.js';

function scoreConnectAccount(account) {
  let score = 0;
  if (account.details_submitted) score += 100;
  if (account.payouts_enabled) score += 50;
  if (account.capabilities?.transfers === 'active') score += 25;

  const dueCount =
    (account.requirements?.past_due?.length ?? 0) +
    (account.requirements?.currently_due?.length ?? 0);
  score -= dueCount * 10;

  return score;
}

async function searchConnectAccounts(stripe, query, limit = 10) {
  try {
    const result = await stripe.accounts.search({ query, limit });
    return result.data ?? [];
  } catch (error) {
    console.warn('[stripeAccountStatus] Search failed:', query, error.message);
    return [];
  }
}

async function findBestStripeAccountForUser(influencerId, email) {
  const stripe = getStripe();
  const candidates = new Map();

  const byUid = await searchConnectAccounts(
    stripe,
    `metadata['firebaseUid']:'${influencerId}'`,
  );
  for (const account of byUid) {
    candidates.set(account.id, account);
  }

  if (email) {
    const escapedEmail = email.replace(/'/g, "\\'");
    const byEmail = await searchConnectAccounts(stripe, `email:'${escapedEmail}'`);
    for (const account of byEmail) {
      const linkedUid = account.metadata?.firebaseUid;
      if (!linkedUid || linkedUid === influencerId) {
        candidates.set(account.id, account);
      }
    }
  }

  let best = null;
  let bestScore = -Infinity;

  for (const account of candidates.values()) {
    const score = scoreConnectAccount(account);
    if (score > bestScore) {
      bestScore = score;
      best = account;
    }
  }

  return best;
}

async function ensureAccountMetadata(stripe, account, influencerId) {
  if (account.metadata?.firebaseUid === influencerId) return;

  try {
    await stripe.accounts.update(account.id, {
      metadata: {
        ...(account.metadata ?? {}),
        firebaseUid: influencerId,
      },
    });
  } catch (error) {
    console.warn('[stripeAccountStatus] Could not update account metadata:', account.id, error.message);
  }
}

export async function reconcileStripeAccountId(influencerId, emailHint) {
  const email = emailHint ?? (await getUserEmail(influencerId));
  const best = await findBestStripeAccountForUser(influencerId, email);

  if (best) {
    const stripe = getStripe();
    await saveUserStripeAccountId(influencerId, best.id);
    await ensureAccountMetadata(stripe, best, influencerId);
    return best.id;
  }

  return getUserStripeAccountId(influencerId);
}

export async function resolveStripeAccountId(influencerId, emailHint) {
  const stored = await getUserStripeAccountId(influencerId);
  const email = emailHint ?? (await getUserEmail(influencerId));
  const best = await findBestStripeAccountForUser(influencerId, email);

  if (!best) {
    return stored ?? null;
  }

  const stripe = getStripe();

  if (stored && stored !== best.id) {
    try {
      const storedAccount = await stripe.accounts.retrieve(stored);
      if (scoreConnectAccount(best) <= scoreConnectAccount(storedAccount)) {
        await ensureAccountMetadata(stripe, storedAccount, influencerId);
        return stored;
      }
    } catch {
      // Stored account is stale — fall through to the best match.
    }
  }

  await saveUserStripeAccountId(influencerId, best.id);
  await ensureAccountMetadata(stripe, best, influencerId);
  return best.id;
}

export async function getInfluencerStripeStatus(influencerId) {
  const stripeAccountId = await resolveStripeAccountId(influencerId);

  if (!stripeAccountId) {
    return {
      influencerId,
      stripeAccountId: null,
      connected: false,
      payoutsEnabled: false,
      readyForPayouts: false,
    };
  }

  try {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const payoutsEnabled = Boolean(account.payouts_enabled);
    const transfersStatus = account.capabilities?.transfers ?? 'unrequested';
    const transfersActive = transfersStatus === 'active';
    const readyForPayouts = payoutsEnabled && transfersActive;
    const currentlyDue = account.requirements?.currently_due ?? [];
    const pastDue = account.requirements?.past_due ?? [];
    const requirementsDue = [...new Set([...pastDue, ...currentlyDue])];
    const detailsSubmitted = Boolean(account.details_submitted);
    const pendingVerification =
      detailsSubmitted &&
      requirementsDue.length === 0 &&
      !readyForPayouts &&
      (transfersStatus === 'pending' || !payoutsEnabled);

    return {
      influencerId,
      stripeAccountId,
      connected: true,
      payoutsEnabled,
      chargesEnabled: Boolean(account.charges_enabled),
      readyForPayouts,
      detailsSubmitted,
      transfersStatus,
      requirementsDue,
      pendingVerification,
    };
  } catch (error) {
    console.warn('[stripeAccountStatus] Could not load account:', stripeAccountId, error.message);
    return {
      influencerId,
      stripeAccountId,
      connected: true,
      payoutsEnabled: false,
      readyForPayouts: false,
    };
  }
}

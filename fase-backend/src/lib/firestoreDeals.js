import { initFirebase } from '../config/firebase.js';

const DEALS_COLLECTION = 'deals';
const USERS_COLLECTION = 'users';

function getFirestoreBundle() {
  const firebase = initFirebase();
  if (!firebase) {
    throw new Error('Firebase is not configured');
  }
  return {
    db: firebase.firestore(),
    FieldValue: firebase.firestore.FieldValue,
  };
}

export async function markDealPaymentSucceeded(dealId, paymentIntentId) {
  if (!dealId) return;

  const { db, FieldValue } = getFirestoreBundle();
  const dealRef = db.collection(DEALS_COLLECTION).doc(dealId);
  const snapshot = await dealRef.get();

  if (!snapshot.exists) {
    console.warn('[firestoreDeals] Deal not found for payment webhook:', dealId);
    return;
  }

  const existing = snapshot.data() ?? {};
  if (existing.paymentStatus === 'withdrawn' || existing.cashedOutAt) {
    return;
  }

  await dealRef.set(
    {
      paymentIntentId,
      paymentStatus: 'held',
      paidAt: FieldValue.serverTimestamp(),
      developerReviewStatus: 'accepted',
      type: 'active',
      status: 'Post by deadline',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getDealParticipants(dealId) {
  if (!dealId) return null;

  const { db } = getFirestoreBundle();
  const snapshot = await db.collection(DEALS_COLLECTION).doc(dealId).get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() ?? {};
  return {
    dealId,
    developerId: data.developerId ? String(data.developerId) : undefined,
    influencerId: data.influencerId ? String(data.influencerId) : undefined,
  };
}

export async function getDealForPayoutRelease(dealId) {
  if (!dealId) return null;

  const { db } = getFirestoreBundle();
  const snapshot = await db.collection(DEALS_COLLECTION).doc(dealId).get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() ?? {};
  return {
    dealId,
    developerId: data.developerId ? String(data.developerId) : undefined,
    influencerId: data.influencerId ? String(data.influencerId) : undefined,
    paymentIntentId: data.paymentIntentId ? String(data.paymentIntentId) : undefined,
    paymentStatus: data.paymentStatus ? String(data.paymentStatus) : undefined,
    stripeTransferId: data.stripeTransferId ? String(data.stripeTransferId) : undefined,
    influencerStripeAccountId: data.influencerStripeAccountId
      ? String(data.influencerStripeAccountId)
      : undefined,
    influencerPayoutAmount: data.influencerPayoutAmount
      ? Number(data.influencerPayoutAmount)
      : undefined,
    paidAt: data.paidAt,
    postAutoReleaseAt: data.postAutoReleaseAt,
    completedAt: data.completedAt,
    type: data.type ? String(data.type) : undefined,
    status: data.status ? String(data.status) : undefined,
  };
}

export async function markDealPayoutReleased(dealId, transferId, options = {}) {
  if (!dealId) return;

  const { db, FieldValue } = getFirestoreBundle();
  const payload = {
    paymentStatus: 'released',
    payoutReleasedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (transferId) {
    payload.stripeTransferId = transferId;
  }

  if (options.markCompleted) {
    payload.type = 'completed';
    payload.status = 'Completed';
    payload.statusLabel = 'Completed';
    payload.completedAt = FieldValue.serverTimestamp();
    if (options.autoReleased) {
      payload.postAutoReleased = true;
    }
  }

  await db.collection(DEALS_COLLECTION).doc(dealId).set(payload, { merge: true });
}

export async function markDealPaymentRefunded(dealId) {
  if (!dealId) return;

  const { db, FieldValue } = getFirestoreBundle();
  await db.collection(DEALS_COLLECTION).doc(dealId).set(
    {
      paymentIntentId: FieldValue.delete(),
      paymentStatus: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateConnectAccountStatus(stripeAccountId, account) {
  if (!stripeAccountId) return;

  const { db, FieldValue } = getFirestoreBundle();
  const firebaseUid = account.metadata?.firebaseUid;
  let userRef = null;

  if (firebaseUid) {
    userRef = db.collection(USERS_COLLECTION).doc(firebaseUid);
  } else {
    const usersSnapshot = await db
      .collection(USERS_COLLECTION)
      .where('stripeAccountId', '==', stripeAccountId)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      userRef = usersSnapshot.docs[0].ref;
    }
  }

  if (!userRef) {
    console.warn('[firestoreDeals] No user found for Stripe account:', stripeAccountId);
    return;
  }

  await userRef.set(
    {
      stripeAccountId,
      stripeChargesEnabled: Boolean(account.charges_enabled),
      stripePayoutsEnabled: Boolean(account.payouts_enabled),
      stripeDetailsSubmitted: Boolean(account.details_submitted),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function recordPackPurchase(paymentIntent) {
  const { packTierId, campaignId, developerId } = paymentIntent.metadata ?? {};
  if (!packTierId || !campaignId || !developerId) return;

  const { db, FieldValue } = getFirestoreBundle();
  await db.collection('packPurchases').doc(paymentIntent.id).set({
    paymentIntentId: paymentIntent.id,
    packTierId,
    campaignId,
    developerId,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: 'succeeded',
    createdAt: FieldValue.serverTimestamp(),
  });
}

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

  await dealRef.set(
    {
      paymentIntentId,
      paymentStatus: 'released',
      developerReviewStatus: 'accepted',
      type: 'active',
      status: 'Post by deadline',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
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
  const usersSnapshot = await db
    .collection(USERS_COLLECTION)
    .where('stripeAccountId', '==', stripeAccountId)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.warn('[firestoreDeals] No user found for Stripe account:', stripeAccountId);
    return;
  }

  const userRef = usersSnapshot.docs[0].ref;
  await userRef.set(
    {
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

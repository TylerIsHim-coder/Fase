import { initFirebase } from '../config/firebase.js';

export async function getUserStripeAccountId(userId) {
  const firebase = initFirebase();
  if (!firebase) {
    throw new Error('Firebase is not configured');
  }

  const snapshot = await firebase.firestore().collection('users').doc(userId).get();
  if (!snapshot.exists) return null;

  const data = snapshot.data();
  return typeof data?.stripeAccountId === 'string' ? data.stripeAccountId : null;
}

export async function saveUserStripeAccountId(userId, stripeAccountId) {
  const firebase = initFirebase();
  if (!firebase) {
    throw new Error('Firebase is not configured');
  }

  await firebase.firestore().collection('users').doc(userId).set(
    {
      stripeAccountId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

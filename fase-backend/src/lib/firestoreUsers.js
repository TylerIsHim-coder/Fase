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

export async function getUserEmail(userId) {
  const firebase = initFirebase();
  if (!firebase || !userId) return null;

  const snapshot = await firebase.firestore().collection('users').doc(userId).get();
  if (!snapshot.exists) return null;

  const email = snapshot.data()?.email;
  return typeof email === 'string' && email.length > 0 ? email : null;
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

export async function getExpoPushTokens(userId) {
  const firebase = initFirebase();
  if (!firebase || !userId) return [];

  const snapshot = await firebase.firestore().collection('users').doc(userId).get();
  if (!snapshot.exists) return [];

  const tokens = snapshot.data()?.expoPushTokens;
  if (!Array.isArray(tokens)) return [];

  return tokens.filter((token) => typeof token === 'string' && token.length > 0);
}

export async function addExpoPushToken(userId, token) {
  const firebase = initFirebase();
  if (!firebase) {
    throw new Error('Firebase is not configured');
  }

  await firebase.firestore().collection('users').doc(userId).set(
    {
      expoPushTokens: firebase.firestore.FieldValue.arrayUnion(token),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeExpoPushTokens(userId, tokens) {
  const firebase = initFirebase();
  if (!firebase || !userId || !tokens?.length) return;

  await firebase.firestore().collection('users').doc(userId).set(
    {
      expoPushTokens: firebase.firestore.FieldValue.arrayRemove(...tokens),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

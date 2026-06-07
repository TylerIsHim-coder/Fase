import { readFileSync } from 'fs';
import { resolve } from 'path';

import admin from 'firebase-admin';

let initialized = false;

function loadServiceAccount() {
  const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (credentialsPath) {
    const absolutePath = resolve(process.cwd(), credentialsPath);
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    return JSON.parse(raw);
  }

  return null;
}

export function initFirebase() {
  if (initialized) return admin;

  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      console.warn(
        '[firebase] Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT — auth disabled',
      );
      return null;
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    console.info('[firebase] Admin initialized for project:', serviceAccount.project_id);
    return admin;
  } catch (error) {
    console.error('[firebase] Failed to initialize:', error.message);
    return null;
  }
}

export async function verifyIdToken(idToken) {
  const firebase = initFirebase();
  if (!firebase) {
    throw new Error('Firebase is not configured');
  }

  return firebase.auth().verifyIdToken(idToken);
}

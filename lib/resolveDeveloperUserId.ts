import { doc, getDoc } from 'firebase/firestore';

import { getDb } from '@/lib/firebase';

/** Firebase Auth uids are long alphanumeric strings — not app slugs like "focusflow". */
export function isFirebaseUid(value: string): boolean {
  return value.length >= 20 && /^[A-Za-z0-9]+$/.test(value);
}

/**
 * Campaigns may store a slug developerId in older clips; notifications must target
 * the developer's Firebase uid (where push tokens live).
 */
export async function resolveDeveloperNotificationUserId(
  developerId: string,
  campaignId?: string,
): Promise<string | null> {
  if (isFirebaseUid(developerId)) {
    return developerId;
  }

  if (!campaignId) {
    return null;
  }

  const db = getDb();
  if (!db) return null;

  try {
    const snapshot = await getDoc(doc(db, 'campaigns', campaignId));
    if (!snapshot.exists()) return null;

    const fromCampaign = String(snapshot.data()?.developerId ?? '');
    if (isFirebaseUid(fromCampaign)) {
      return fromCampaign;
    }
  } catch {
    // Fall through.
  }

  return null;
}

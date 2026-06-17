import { initFirebase } from '../config/firebase.js';

/**
 * Removes campaigns (and related user/stats docs) whose developer no longer exists in Auth.
 * Handles the case where accounts were deleted manually in the Firebase console.
 */
export async function pruneOrphanedCampaigns() {
  const firebase = initFirebase();
  if (!firebase) {
    return { deleted: 0, campaignIds: [] };
  }

  const db = firebase.firestore();
  const snapshot = await db.collection('campaigns').get();
  const deletedCampaignIds = [];

  for (const campaignDoc of snapshot.docs) {
    const developerId = campaignDoc.data()?.developerId;
    if (!developerId) continue;

    let authUserExists = true;
    try {
      await firebase.auth().getUser(String(developerId));
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        authUserExists = false;
      } else {
        throw error;
      }
    }

    if (authUserExists) continue;

    const campaignId = campaignDoc.id;
    const batch = db.batch();
    batch.delete(campaignDoc.ref);
    batch.delete(db.collection('users').doc(String(developerId)));
    batch.delete(db.collection('campaignStats').doc(campaignId));
    await batch.commit();
    deletedCampaignIds.push(campaignId);
  }

  return { deleted: deletedCampaignIds.length, campaignIds: deletedCampaignIds };
}

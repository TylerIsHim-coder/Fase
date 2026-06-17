import { Router } from 'express';

import { getDealParticipants } from '../lib/firestoreDeals.js';
import { addExpoPushToken, getExpoPushTokens, removeExpoPushTokens } from '../lib/firestoreUsers.js';
import { sendExpoPushNotifications } from '../lib/push.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /register-push-token
 * Saves the caller's Expo push token for remote notifications.
 */
router.post('/register-push-token', requireAuth, async (req, res) => {
  try {
    const { token } = req.body ?? {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }

    await addExpoPushToken(req.user.uid, token);

    return res.json({ ok: true });
  } catch (error) {
    console.error('[register-push-token]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to register push token' });
  }
});

async function canNotifyRecipient(callerUid, recipientUid, data = {}) {
  if (!recipientUid || callerUid === recipientUid) {
    return false;
  }

  const dealId = data.dealId ? String(data.dealId) : null;
  if (!dealId) {
    return true;
  }

  const participants = await getDealParticipants(dealId);
  if (participants?.developerId || participants?.influencerId) {
    return (
      participants.developerId === callerUid ||
      participants.influencerId === callerUid
    );
  }

  const activityType = data.type ? String(data.type) : '';
  return [
    'campaign_liked',
    'campaign_commented',
    'profile_viewed',
    'new_follower',
  ].includes(activityType);
}

/**
 * POST /send-push
 * Sends a push notification to another user (authenticated).
 */
router.post('/send-push', requireAuth, async (req, res) => {
  try {
    const { recipientUserId, title, body, data } = req.body ?? {};

    if (!recipientUserId || typeof recipientUserId !== 'string') {
      return res.status(400).json({ error: 'recipientUserId is required' });
    }

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const allowed = await canNotifyRecipient(req.user.uid, recipientUserId, data ?? {});
    if (!allowed) {
      return res.status(403).json({ error: 'Not authorized to notify this user' });
    }

    const tokens = await getExpoPushTokens(recipientUserId);
    if (tokens.length === 0) {
      return res.json({ sent: 0, reason: 'no_tokens' });
    }

    const payloadData = {
      ...(data && typeof data === 'object' ? data : {}),
      recipientUserId,
    };

    const result = await sendExpoPushNotifications(tokens, {
      title: String(title),
      body: String(body),
      data: payloadData,
    });

    if (result.invalidTokens.length > 0) {
      await removeExpoPushTokens(recipientUserId, result.invalidTokens);
    }

    return res.json({ sent: result.sent });
  } catch (error) {
    console.error('[send-push]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to send push notification' });
  }
});

export default router;

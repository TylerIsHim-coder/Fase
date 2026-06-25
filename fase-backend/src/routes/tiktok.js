import { Router } from 'express';

import { exchangeTikTokAuthorizationCode, fetchTikTokUserProfile } from '../lib/tiktok.js';
import { saveTikTokConnectionForUser } from '../lib/tiktokUserProfile.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/tiktok/connect', requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const redirectUri = String(req.body?.redirectUri ?? '').trim();
    const codeVerifier = String(req.body?.codeVerifier ?? '').trim();

    if (!code || !redirectUri || !codeVerifier) {
      return res.status(400).json({ error: 'code, redirectUri, and codeVerifier are required.' });
    }

    const tokenMeta = await exchangeTikTokAuthorizationCode({
      code,
      redirectUri,
      codeVerifier,
    });

    const profile = await fetchTikTokUserProfile(tokenMeta.accessToken);
    const result = await saveTikTokConnectionForUser(req.user.uid, profile, tokenMeta);

    return res.json(result);
  } catch (error) {
    console.error('[tiktok/connect]', error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'TikTok connection failed.',
    });
  }
});

export default router;

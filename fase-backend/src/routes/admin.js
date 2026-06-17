import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { pruneOrphanedCampaigns } from '../lib/pruneOrphanedCampaigns.js';

const router = Router();

router.post('/admin/prune-orphaned-campaigns', requireAuth, async (_req, res) => {
  try {
    const result = await pruneOrphanedCampaigns();
    return res.json(result);
  } catch (error) {
    console.error('[admin] prune-orphaned-campaigns failed', error);
    return res.status(500).json({ error: 'Failed to prune orphaned campaigns' });
  }
});

export default router;

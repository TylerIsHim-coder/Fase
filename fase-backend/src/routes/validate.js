import { Router } from 'express';

import { validateAppStoreUrl } from '../lib/validateProduct.js';

const router = Router();

router.post('/validate/product', async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    const result = await validateAppStoreUrl(url);
    return res.json(result);
  } catch (error) {
    console.error('[validate/product]', error);
    return res.status(500).json({ error: 'Validation failed. Try again.' });
  }
});

export default router;

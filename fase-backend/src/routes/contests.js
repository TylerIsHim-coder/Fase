import { Router } from 'express';

import { generateContestBriefSections } from '../lib/contestBriefGeneration.js';
import { isGroqConfigured } from '../lib/groq.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function parseQuestionnaire(body) {
  const questionnaire = body?.questionnaire;
  if (!questionnaire || typeof questionnaire !== 'object') return null;

  return {
    pitch: typeof questionnaire.pitch === 'string' ? questionnaire.pitch : '',
    audience: typeof questionnaire.audience === 'string' ? questionnaire.audience : '',
    features: typeof questionnaire.features === 'string' ? questionnaire.features : '',
    differentiator: typeof questionnaire.differentiator === 'string' ? questionnaire.differentiator : '',
    avoidPhrases:
      typeof questionnaire.avoidPhrases === 'string' ? questionnaire.avoidPhrases : '',
  };
}

/**
 * POST /generate-contest-brief
 * Uses Groq to expand a developer questionnaire into contest creator brief sections.
 */
router.post('/generate-contest-brief', requireAuth, async (req, res) => {
  try {
    if (!isGroqConfigured()) {
      return res.status(503).json({ error: 'Groq is not configured on the server (GROQ_API_KEY).' });
    }

    const { appName, bio, website, section = 'all' } = req.body ?? {};
    const questionnaire = parseQuestionnaire(req.body);

    if (!appName?.trim()) {
      return res.status(400).json({ error: 'appName is required' });
    }

    if (!questionnaire) {
      return res.status(400).json({ error: 'questionnaire is required' });
    }

    const allowedSections = new Set(['all', 'overview', 'languageRules', 'videoFramework', 'creativeDirection']);
    if (!allowedSections.has(section)) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    const sections = await generateContestBriefSections({
      appName: appName.trim(),
      bio: typeof bio === 'string' ? bio : '',
      website: typeof website === 'string' ? website : '',
      questionnaire,
      section,
    });

    return res.json({ sections });
  } catch (error) {
    console.error('[generate-contest-brief]', error);
    return res.status(500).json({ error: error.message ?? 'Failed to generate contest brief' });
  }
});

export default router;

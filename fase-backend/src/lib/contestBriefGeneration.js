import { groqChatCompletion } from './groq.js';

const SECTION_KEYS = ['overview', 'languageRules', 'videoFramework', 'creativeDirection'];

const SECTION_LABELS = {
  overview: 'Project overview',
  languageRules: 'Language rules',
  videoFramework: 'Video framework',
  creativeDirection: 'Creative direction & angles',
};

function buildQuestionnaireBlock(questionnaire) {
  if (!questionnaire) return '';

  return [
    'Developer questionnaire answers:',
    `One-sentence pitch: ${questionnaire.pitch?.trim() ?? ''}`,
    `Target audience: ${questionnaire.audience?.trim() ?? ''}`,
    `Features & benefits: ${questionnaire.features?.trim() ?? ''}`,
    `Differentiator: ${questionnaire.differentiator?.trim() ?? ''}`,
    questionnaire.avoidPhrases?.trim()
      ? `Phrases to avoid on TikTok: ${questionnaire.avoidPhrases.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildContext({ appName, bio, website, questionnaire }) {
  return [
    `App name: ${appName}`,
    bio?.trim() ? `Developer bio: ${bio.trim()}` : null,
    website?.trim() ? `Website: ${website.trim()}` : null,
    buildQuestionnaireBlock(questionnaire),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildPrompt({ appName, bio, website, questionnaire, section }) {
  const context = buildContext({ appName, bio, website, questionnaire });

  if (section && section !== 'all') {
    return {
      system:
        'You write detailed TikTok contest briefs for mobile app developers. Expand the developer questionnaire into creator-ready instructions. Respond with valid JSON only.',
      user: `${context}

Write the "${SECTION_LABELS[section]}" section of a creator brief for a CPM TikTok contest promoting ${appName}.

Use the questionnaire answers as source material — expand them into a detailed, Posted.app-style brief. Do not invent features that contradict the questionnaire.

Requirements:
- Plain text with line breaks (no markdown # headers)
- Specific, actionable, and detailed enough that creators know exactly what to film
- Include concrete examples where helpful

Return JSON: { "${section}": "..." }`,
    };
  }

  return {
    system:
      'You write detailed TikTok contest briefs for mobile app developers. Expand developer questionnaire answers into a full creator brief. Respond with valid JSON only.',
    user: `${context}

Using ONLY the questionnaire above (expand, don't contradict it), write a complete 4-part creator brief for a CPM TikTok contest promoting ${appName}. Top creators win by getting the most verified TikTok views.

Return JSON with exactly these keys:
{
  "overview": "What the app is, who it's for, key benefits, positioning — expanded from questionnaire",
  "languageRules": "Phrases creators SHOULD use vs NEVER use on TikTok — include avoid list if provided",
  "videoFramework": "Hook → problem → solution → proof → CTA structure, length, must-haves",
  "creativeDirection": "Main message, retention hook, and 3 video angle ideas with hooks and emotions"
}

Each section must be plain text with line breaks (no markdown # headers), highly detailed, and ready for creators to film from.`,
  };
}

function parseSections(raw, section) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI returned invalid JSON.');
  }

  if (section && section !== 'all') {
    const text = parsed[section];
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error(`AI did not return ${section}.`);
    }
    return { [section]: text.trim() };
  }

  const result = {};
  for (const key of SECTION_KEYS) {
    const text = parsed[key];
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error(`AI did not return ${key}.`);
    }
    result[key] = text.trim();
  }
  return result;
}

function validateQuestionnaire(questionnaire) {
  if (!questionnaire || typeof questionnaire !== 'object') {
    throw new Error('questionnaire is required');
  }

  const required = ['pitch', 'audience', 'features', 'differentiator'];
  for (const field of required) {
    if (!questionnaire[field]?.trim()) {
      throw new Error(`questionnaire.${field} is required`);
    }
  }
}

export async function generateContestBriefSections(input) {
  const { appName, bio, website, questionnaire, section = 'all' } = input;

  if (!appName?.trim()) {
    throw new Error('appName is required');
  }

  validateQuestionnaire(questionnaire);

  const prompt = buildPrompt({
    appName: appName.trim(),
    bio,
    website,
    questionnaire,
    section,
  });

  const raw = await groqChatCompletion([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ]);

  return parseSections(raw, section);
}

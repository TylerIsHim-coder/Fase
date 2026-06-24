const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function isGroqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export async function groqChatCompletion(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured on the server.');
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature ?? 0.6,
      max_tokens: options.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Groq request failed (${response.status})`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (!content || typeof content !== 'string') {
    throw new Error('Groq returned an empty response.');
  }

  return content;
}

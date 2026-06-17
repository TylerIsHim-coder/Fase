export async function validateAppStoreUrl(urlString) {
  const trimmed = urlString.trim();
  if (!trimmed) {
    return { valid: false, error: 'Paste a link to continue.' };
  }

  if (!trimmed.toLowerCase().includes('apps.apple.com')) {
    return { valid: false, error: 'Paste a valid Apple App Store link.' };
  }

  return {
    valid: true,
    name: 'App Store app',
    url: trimmed,
    validatedBy: 'app_store_url',
  };
}

/** Hosted success/refresh pages — always use this for live Connect redirects. */
const LIVE_CONNECT_APP_URL = 'https://fase-6c49a.web.app';

function isStripeLiveMode() {
  return process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_');
}

function resolveAppUrl() {
  if (isStripeLiveMode()) {
    return (process.env.STRIPE_CONNECT_APP_URL ?? LIVE_CONNECT_APP_URL).replace(/\/$/, '');
  }

  return (
    process.env.STRIPE_CONNECT_APP_URL ??
    process.env.APP_URL ??
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

export function getConnectUrls(body = {}) {
  const appUrl = resolveAppUrl();
  const refreshUrl = body.refreshUrl ?? `${appUrl}/connect/refresh`;
  const returnUrl = body.returnUrl ?? `${appUrl}/connect/return`;

  if (
    isStripeLiveMode() &&
    (!refreshUrl.startsWith('https://') || !returnUrl.startsWith('https://'))
  ) {
    throw new Error(
      'Live Stripe keys require HTTPS redirect URLs. Set APP_URL=https://your-backend.onrender.com in fase-backend/.env',
    );
  }

  return { refreshUrl, returnUrl };
}

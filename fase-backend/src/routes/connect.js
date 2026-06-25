import { Router } from 'express';

const router = Router();

function connectPage({ title, message, success = false }) {
  const accent = success ? '#00A67E' : '#111';
  const icon = success
    ? `<div style="width:64px;height:64px;border-radius:32px;background:#E6F7F2;color:#00A67E;display:grid;place-items:center;font-size:32px;margin:0 auto 20px;">✓</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f7;
      color: #111;
      display: grid;
      place-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 24px;
    }
    main {
      max-width: 420px;
      background: #fff;
      border-radius: 16px;
      padding: 36px 24px 32px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
    }
    h1 {
      font-size: 28px;
      margin: 0 0 12px;
      color: ${accent};
    }
    p {
      margin: 0;
      line-height: 1.5;
      color: #444;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <main>
    ${icon}
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;
}

router.get('/connect/return', (_req, res) => {
  res.type('html').send(
    connectPage({
      success: true,
      title: 'Success!',
      message: 'Stripe setup is complete. Close this tab and return to the Faze app.',
    }),
  );
});

router.get('/connect/refresh', (_req, res) => {
  res.type('html').send(
    connectPage({
      title: 'Continue setup',
      message: 'Close this tab, return to Faze, and tap Stripe payouts again to continue onboarding.',
    }),
  );
});

export default router;

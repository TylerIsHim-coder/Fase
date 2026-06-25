import { initFirebase, verifyIdToken } from '../config/firebase.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  if (!initFirebase()) {
    return res.status(503).json({ error: 'Firebase auth is not configured on the server' });
  }

  const token = header.slice('Bearer '.length).trim();

  if (!token || token.split('.').length !== 3) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const decoded = await verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[auth] Token verification failed:', error.code ?? error.message);
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

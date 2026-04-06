import { logger } from '../utils/logger.js';

/**
 * API-key authentication middleware.
 *
 * Clients must send their key in one of:
 *   x-api-key: <key>
 *   Authorization: Bearer <key>
 *
 * Valid keys are loaded once at startup from the API_KEYS env variable
 * (comma-separated).  The set is stored as a Set<string> for O(1) lookup.
 */

function loadValidKeys() {
  const raw = process.env.API_KEYS || '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    logger.warn('No API_KEYS configured — all requests will be rejected');
  }
  return new Set(keys);
}

const validKeys = loadValidKeys();

export function authMiddleware(req, res, next) {
  // Accept key from x-api-key header or Authorization: Bearer <key>
  const fromHeader = req.headers['x-api-key'];
  const fromBearer = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  const key = fromHeader || fromBearer;

  if (!key) {
    return res.status(401).json({
      error: { type: 'authentication_error', message: 'Missing API key.' },
    });
  }

  if (!validKeys.has(key)) {
    logger.warn('Invalid API key attempt', { keyPrefix: logger.safeKeyPrefix(key), ip: req.ip });
    return res.status(401).json({
      error: { type: 'authentication_error', message: 'Invalid API key.' },
    });
  }

  next();
}

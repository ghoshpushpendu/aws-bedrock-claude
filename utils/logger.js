/**
 * Minimal structured logger.
 * Logs timestamp, route, status code, and a safe prefix of the API key.
 * Never logs the full API key.
 */

function formatTimestamp() {
  return new Date().toISOString();
}

/** Return only the first 8 characters of an API key followed by '…' */
function safeKeyPrefix(key) {
  if (!key) return '(none)';
  return key.slice(0, 8) + '…';
}

function log(level, message, meta = {}) {
  const entry = {
    ts: formatTimestamp(),
    level,
    message,
    ...meta,
  };
  // In production keep it one-line JSON; in dev pretty-print for readability
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    const { ts, level: lvl, message: msg, ...rest } = entry;
    const metaStr = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    console.log(`[${ts}] ${lvl.toUpperCase()} ${msg}${metaStr}`);
  }
}

export const logger = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  safeKeyPrefix,

  /** Convenience: log an HTTP request once it has completed */
  request(req, statusCode) {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    log('info', 'request', {
      method: req.method,
      path: req.path,
      status: statusCode,
      ip: req.ip,
      key: safeKeyPrefix(apiKey),
    });
  },
};

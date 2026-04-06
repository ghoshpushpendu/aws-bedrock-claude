import rateLimit from 'express-rate-limit';

/**
 * Rate limiter: 30 requests per minute per IP.
 * Returns a JSON body on rejection so clients get a machine-readable error.
 */
export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,  // Send RateLimit-* headers
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: {
        type: 'rate_limit_error',
        message: 'Too many requests. Please retry after 1 minute.',
      },
    });
  },
});

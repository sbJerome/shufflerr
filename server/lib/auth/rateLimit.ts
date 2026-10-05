import rateLimit from 'express-rate-limit';

/**
 * Sign-in endpoints: 10 failed attempts per minute per IP (docs/AUTH.md §Session & security).
 * Disabled under the test runner unless AUTH_RATE_LIMIT_IN_TESTS is set, so
 * unrelated route tests can sign in freely.
 */
export const AUTH_RATE_LIMIT = 10;
export const AUTH_RATE_WINDOW_MS = 60 * 1000;

export const authRateLimit = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MS,
  limit: AUTH_RATE_LIMIT,
  // Only failed attempts count, so a household behind one address (or a
  // reverse proxy without "trust proxy") isn't locked out by normal sign-ins.
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () =>
    process.env.NODE_ENV === 'test' &&
    process.env.AUTH_RATE_LIMIT_IN_TESTS !== 'true',
  handler: (_req, res) => {
    res.status(429).json({
      status: 429,
      message: 'Too many sign-in attempts. Wait a minute and try again.',
    });
  },
});

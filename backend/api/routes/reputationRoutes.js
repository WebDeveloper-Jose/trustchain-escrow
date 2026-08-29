import express from 'express';
import reputationController from '../controllers/reputationController.js';
import { cacheResponse, TTL } from '../middleware/cache.js';
import { reputationSearchRateLimit } from '../../middleware/rateLimit.js';

const router = express.Router();

// ── Error context & redaction (issue #285) ──────────────────────────────────
//
// Controllers respond with `err.message` directly, which is fine for
// intentional validation errors but leaks unfiltered driver output for
// anything unexpected — e.g. a Prisma connection error whose message embeds
// the database host/credentials ("Can't reach database server at
// `user:pass@host:5432`"). This strips anything that looks like a
// connection string or credential before it can reach the client, and tags
// the response with which operation actually failed.

const SENSITIVE_PATTERNS = [
  /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, // connection strings / URLs (postgres://, redis://, https://user:pass@..., ...)
  /(password|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi,
];

export function redactSensitive(message = '') {
  return SENSITIVE_PATTERNS.reduce(
    (msg, pattern) => msg.replace(pattern, '[redacted]'),
    String(message ?? 'Unknown error'),
  );
}

/**
 * Tags the response context on `res.locals` so the router's error handler
 * can prefix a clear, operation-specific message ("Fetching leaderboard
 * failed: ...") instead of a generic "Internal error", while still routing
 * every failure through the same redaction step below.
 */
function withErrorContext(operation, handler) {
  return async (req, res, next) => {
    res.locals.routeOperation = operation;
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * @route  GET /api/reputation/search?q=<prefix>
 * ES-backed address autocomplete + full-text search. Prisma fallback on outage.
 */
router.get(
  '/search',
  reputationSearchRateLimit,
  withErrorContext('Reputation search', reputationController.search),
);

/**
 * @route  GET /api/reputation/leaderboard
 */
router.get(
  '/leaderboard',
  cacheResponse({ ttl: TTL.LEADERBOARD, tags: ['reputation:leaderboard'] }),
  withErrorContext('Fetching leaderboard', reputationController.getLeaderboard),
);

/**
 * @route  POST /api/reputation/admin/recalculate
 * Admin-only: recompute all scores from event history
 */
router.post(
  '/admin/recalculate',
  withErrorContext('Reputation recalculation', reputationController.recalculate),
);

/**
 * @route  GET /api/reputation/:address
 */
router.get(
  '/:address',
  cacheResponse({
    ttl: TTL.REPUTATION,
    tags: (req) => ['reputation', `reputation:${req.params.address}`],
  }),
  withErrorContext('Fetching reputation', reputationController.getReputation),
);

// ── Router-level error handler ──────────────────────────────────────────────
// Catches anything the controllers pass to next(err), plus anything thrown
// synchronously by the middleware above. Every response here goes through
// redaction and gets the operation name from withErrorContext, so callers
// get "Fetching leaderboard failed: <reason>" instead of a bare
// "Internal error" — with connection strings/credentials stripped first.
router.use((err, req, res, _next) => {
  const operation = res.locals.routeOperation || 'Reputation request';
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: `${operation} failed: ${redactSensitive(err.message)}`,
  });
});

export default router;

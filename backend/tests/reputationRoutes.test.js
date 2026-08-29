/**
 * Tests for backend/api/routes/reputationRoutes.js (issue #285)
 *
 * Covers:
 *  - Errors thrown by a controller reach the client with route-specific
 *    context instead of a generic "Internal error".
 *  - Connection strings / credentials embedded in the underlying error
 *    message are redacted before the response is sent.
 */

import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockController = {
  search: jest.fn(),
  getLeaderboard: jest.fn(),
  recalculate: jest.fn(),
  getReputation: jest.fn(),
};

jest.unstable_mockModule('../api/controllers/reputationController.js', () => ({
  default: mockController,
}));

// Real cache/rate-limit middleware talk to Redis; swap them for no-ops so
// this test only exercises the router's own error handling.
jest.unstable_mockModule('../api/middleware/cache.js', () => ({
  cacheResponse: () => (_req, _res, next) => next(),
  TTL: { LEADERBOARD: 300, REPUTATION: 60 },
}));

jest.unstable_mockModule('../middleware/rateLimit.js', () => ({
  reputationSearchRateLimit: (_req, _res, next) => next(),
}));

describe('reputationRoutes error handling', () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    const { default: reputationRoutes } = await import('../api/routes/reputationRoutes.js');
    app = express();
    app.use(express.json());
    app.use('/api/reputation', reputationRoutes);
  });

  it('surfaces a route-specific message instead of a generic error', async () => {
    mockController.getLeaderboard.mockImplementation(async () => {
      throw new Error('score column missing');
    });

    const res = await request(app).get('/api/reputation/leaderboard').expect(500);

    expect(res.body.error).toBe('Fetching leaderboard failed: score column missing');
  });

  it('redacts a database connection string embedded in the error message', async () => {
    mockController.getReputation.mockImplementation(async () => {
      throw new Error(
        "Can't reach database server at `postgres://svc_user:sup3rS3cret@db.internal:5432/app`",
      );
    });

    const res = await request(app).get('/api/reputation/GADDRESS').expect(500);

    expect(res.body.error).toBe(
      "Fetching reputation failed: Can't reach database server at `[redacted]",
    );
    expect(res.body.error).not.toMatch(/sup3rS3cret/);
  });

  it('redacts a bare credential assignment in the error message', async () => {
    mockController.search.mockImplementation(async () => {
      throw new Error('auth failed: api_key=abc123secret');
    });

    const res = await request(app).get('/api/reputation/search?q=a').expect(500);

    expect(res.body.error).toBe('Reputation search failed: auth failed: [redacted]');
  });

  it('passes an explicit statusCode through unchanged', async () => {
    mockController.recalculate.mockImplementation(async () => {
      const err = new Error('admin token expired');
      err.statusCode = 401;
      throw err;
    });

    const res = await request(app).post('/api/reputation/admin/recalculate').expect(401);

    expect(res.body.error).toBe('Reputation recalculation failed: admin token expired');
  });

  it('does not touch a successful response', async () => {
    mockController.getReputation.mockImplementation(async (_req, res) => {
      res.json({ address: 'GADDRESS', totalScore: 42 });
    });

    const res = await request(app).get('/api/reputation/GADDRESS').expect(200);

    expect(res.body).toEqual({ address: 'GADDRESS', totalScore: 42 });
  });
});

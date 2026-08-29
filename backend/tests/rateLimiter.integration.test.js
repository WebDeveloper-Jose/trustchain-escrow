/**
 * Integration test for the rate-limiting flow on POST /api/webhooks/subscribe
 * (issue #284).
 *
 * Unlike tests/rateLimiter.test.js (which exercises createSlidingWindowRateLimiter
 * / createPerUserRateLimiter in isolation against synthetic apps with arbitrary
 * config), this test mounts the real, unmodified backend/api/routes/webhookRoutes.js
 * router — using its actual production configuration (max: 10 requests per
 * 10-minute window, keyed by req.user.address) — and drives the complete flow
 * with real HTTP requests via supertest: request -> real rate limiter instance
 * -> real controller -> real service -> (mocked) Prisma -> response.
 *
 * Prisma and the webhook delivery queue are mocked using the same pattern as
 * tests/webhook.test.js, since those are the only true external boundaries.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prismaMock = {
  webhookSubscription: {
    create: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  webhookDelivery: {
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../queues/webhookQueue.js', () => ({
  enqueueWebhookDelivery: jest.fn(),
}));

const { default: webhookRoutes } = await import('../api/routes/webhookRoutes.js');
const { getUsageStore } = await import('../api/middleware/rateLimiter.js');

const VALID_BODY = {
  url: 'https://example.com/webhook',
  eventTypes: ['esc_crt'],
};

function mockSuccessfulCreate() {
  prismaMock.webhookSubscription.create.mockResolvedValue({
    id: 'sub_1',
    url: VALID_BODY.url,
    eventTypes: VALID_BODY.eventTypes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Builds a test app mounting the real webhookRoutes.js router.
 *
 * server.js documents that "Auth is handled by the gateway above — no
 * per-route authMiddleware needed" — production requests already carry
 * req.user by the time they reach this router. We simulate that gateway
 * step here (rather than modifying any production code) so the router
 * under test is exactly what ships.
 */
function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api/webhooks', webhookRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  getUsageStore().clear();
});

describe('POST /api/webhooks/subscribe — rate limiting integration (issue #284)', () => {
  it('allows requests up to the configured limit through the full controller/service flow', async () => {
    mockSuccessfulCreate();
    const app = buildApp({ address: 'GFULLFLOW1' });

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/webhooks/subscribe').send(VALID_BODY);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ id: 'sub_1', url: VALID_BODY.url });
    }

    expect(prismaMock.webhookSubscription.create).toHaveBeenCalledTimes(10);
  });

  it('sets X-RateLimit-* headers reflecting the real configured max (10)', async () => {
    mockSuccessfulCreate();
    const app = buildApp({ address: 'GHEADERS1' });

    const res = await request(app).post('/api/webhooks/subscribe').send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.headers['x-ratelimit-limit']).toBe('10');
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('blocks the 11th request in the same window with a 429 and never reaches the service layer', async () => {
    mockSuccessfulCreate();
    const app = buildApp({ address: 'GFULLFLOW2' });

    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/webhooks/subscribe').send(VALID_BODY).expect(201);
    }

    const res = await request(app).post('/api/webhooks/subscribe').send(VALID_BODY);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.body.error).toBe('Too many webhook subscription requests — try again later');
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['x-ratelimit-remaining']).toBe('0');

    // The blocked request must be rejected by the middleware before it ever
    // reaches the controller/service/database layer.
    expect(prismaMock.webhookSubscription.create).toHaveBeenCalledTimes(10);
  });

  it('tracks separate addresses independently (per-key isolation)', async () => {
    mockSuccessfulCreate();
    const appA = buildApp({ address: 'GADDR_A' });
    const appB = buildApp({ address: 'GADDR_B' });

    for (let i = 0; i < 10; i++) {
      await request(appA).post('/api/webhooks/subscribe').send(VALID_BODY).expect(201);
    }
    await request(appA).post('/api/webhooks/subscribe').send(VALID_BODY).expect(429);

    // A different address must still have its own, untouched quota.
    await request(appB).post('/api/webhooks/subscribe').send(VALID_BODY).expect(201);
  });

  it('falls back to IP-based limiting for unauthenticated requests', async () => {
    mockSuccessfulCreate();
    const app = buildApp(null);

    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/webhooks/subscribe').send(VALID_BODY).expect(201);
    }
    await request(app).post('/api/webhooks/subscribe').send(VALID_BODY).expect(429);
  });

  it('does not apply the subscribe rate limit to other routes on the same router', async () => {
    mockSuccessfulCreate();
    prismaMock.webhookSubscription.findMany.mockResolvedValue([]);
    const app = buildApp({ address: 'GUNAFFECTED' });

    // Exhaust the subscribe limiter for this address.
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/webhooks/subscribe').send(VALID_BODY).expect(201);
    }
    await request(app).post('/api/webhooks/subscribe').send(VALID_BODY).expect(429);

    // GET / has no rate limiter applied on this router — must still succeed freely.
    for (let i = 0; i < 15; i++) {
      await request(app).get('/api/webhooks').expect(200);
    }
  });
});

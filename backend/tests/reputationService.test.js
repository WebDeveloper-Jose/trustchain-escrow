import { jest } from '@jest/globals';

// ── Prisma mock ───────────────────────────────────────────────────────────────

const prismaMock = {
  reputationEvent: { findMany: jest.fn(async () => []) },
  reputationRecord: { update: jest.fn(async ({ data }) => ({ totalScore: 0, ...data })) },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({
  default: prismaMock,
}));

const { BADGE_THRESHOLDS, recalculateFromEventHistory } =
  await import('../services/reputationService.js');

describe('BADGE_THRESHOLDS', () => {
  it('has the expected tier values', () => {
    expect(BADGE_THRESHOLDS.TRUSTED).toBe(100);
    expect(BADGE_THRESHOLDS.VERIFIED).toBe(250);
    expect(BADGE_THRESHOLDS.EXPERT).toBe(500);
    expect(BADGE_THRESHOLDS.ELITE).toBe(1000);
  });
});

describe('recalculateFromEventHistory — tenant scoping (#287)', () => {
  beforeEach(() => {
    prismaMock.reputationEvent.findMany.mockClear();
  });

  it('applies a tenant filter for a non-empty tenantId', async () => {
    await recalculateFromEventHistory('tenant-a');
    expect(prismaMock.reputationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
  });

  it('applies a tenant filter for a falsy-but-real tenantId, not a truthy check', async () => {
    // A truthy check (`tenantId ? {...} : {}`) would treat '' as "no
    // tenant" and silently recalculate every tenant's records together —
    // the exact subtle-bug shape this issue is about.
    await recalculateFromEventHistory('');
    expect(prismaMock.reputationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: '' } }),
    );
  });

  it('omits the tenant filter only when tenantId is genuinely absent', async () => {
    await recalculateFromEventHistory(undefined);
    expect(prismaMock.reputationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );

    await recalculateFromEventHistory(null);
    expect(prismaMock.reputationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

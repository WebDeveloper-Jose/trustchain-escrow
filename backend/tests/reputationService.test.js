import { jest } from '@jest/globals';

// ── Null/undefined handling (issue #287) ───────────────────────────────────
//
// Motivating case: `getReputationByAddress` used a truthy fallback
// (`record || null`) while write operations performed no validation at all,
// so a caller that accidentally passed `undefined` for `address` (e.g. an
// upstream event with a missing freelancer address) fell through to Prisma
// and surfaced a raw, unfriendly Prisma validation error instead of a clear
// one. These tests lock in the standardized `== null` / `??` handling.
//
// NOTE: the mock below must be registered before `services/reputationService.js`
// is imported anywhere (including transitively) — that's why this whole file
// uses dynamic `import()` instead of a static `import` of the service.

const mockPrisma = {
  reputationRecord: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  reputationEvent: {
    upsert: jest.fn(),
  },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({
  default: mockPrisma,
}));

let reputationService;

beforeAll(async () => {
  reputationService = (await import('../services/reputationService.js')).default;
});

describe('BADGE_THRESHOLDS', () => {
  it('has the expected tier values', () => {
    const { BADGE_THRESHOLDS } = reputationService;
    expect(BADGE_THRESHOLDS.TRUSTED).toBe(100);
    expect(BADGE_THRESHOLDS.VERIFIED).toBe(250);
    expect(BADGE_THRESHOLDS.EXPERT).toBe(500);
    expect(BADGE_THRESHOLDS.ELITE).toBe(1000);
  });
});

describe('null/undefined handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getReputationByAddress returns null (not undefined) when no record exists', async () => {
    mockPrisma.reputationRecord.findUnique.mockResolvedValue(null);
    const result = await reputationService.getReputationByAddress('GADDRESS');
    expect(result).toBeNull();
  });

  it('getReputationByAddress short-circuits to null for a null/undefined address without querying Prisma', async () => {
    const resultForNull = await reputationService.getReputationByAddress(null);
    const resultForUndefined = await reputationService.getReputationByAddress(undefined);
    expect(resultForNull).toBeNull();
    expect(resultForUndefined).toBeNull();
    expect(mockPrisma.reputationRecord.findUnique).not.toHaveBeenCalled();
  });

  it('recordEscrowCompletion throws a clear error instead of hitting Prisma when address is missing', async () => {
    await expect(
      reputationService.recordEscrowCompletion(undefined, 'freelancer', 1n, 'tenant-1'),
    ).rejects.toThrow('address is required');
    expect(mockPrisma.reputationEvent.upsert).not.toHaveBeenCalled();
  });

  it('recordEscrowCompletion throws a clear error instead of hitting Prisma when escrowId is missing', async () => {
    await expect(
      reputationService.recordEscrowCompletion('GADDRESS', 'freelancer', null, 'tenant-1'),
    ).rejects.toThrow('escrowId is required');
    expect(mockPrisma.reputationEvent.upsert).not.toHaveBeenCalled();
  });
});

/**
 * Tests for backend/api/controllers/paymentController.js — listByAddress
 * empty state (issue #288).
 *
 * `paymentService.getByAddress` returning `[]` used to reach the client as
 * a bare empty array, indistinguishable from "still loading" or a broken
 * request. `listByAddress` should now flag it explicitly with actionable
 * copy, and leave a non-empty result unchanged apart from the `isEmpty`
 * flag and the `payments` wrapper key.
 */

import { jest } from '@jest/globals';

const ADDRESS_A = `G${'A'.repeat(55)}`;

const paymentServiceMock = {
  createCheckoutSession: jest.fn(),
  getBySessionId: jest.fn(),
  getByAddress: jest.fn(),
  getById: jest.fn(),
  refund: jest.fn(),
  handleWebhook: jest.fn(),
};

const kycServiceMock = {
  getStatus: jest.fn(),
};

jest.unstable_mockModule('../services/paymentService.js', () => ({
  default: paymentServiceMock,
}));

jest.unstable_mockModule('../services/kycService.js', () => ({
  default: kycServiceMock,
}));

const { default: paymentController } = await import('../api/controllers/paymentController.js');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status: jest.fn().mockImplementation(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn().mockImplementation(function (payload) {
      this.body = payload;
      return this;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('paymentController.listByAddress empty state', () => {
  it('returns an explicit empty state with actionable copy when there are no payments', async () => {
    paymentServiceMock.getByAddress.mockResolvedValue([]);
    const req = { params: { address: ADDRESS_A }, user: { address: ADDRESS_A } };
    const res = createMockRes();

    await paymentController.listByAddress(req, res);

    expect(res.json).toHaveBeenCalledWith({
      payments: [],
      isEmpty: true,
      emptyState: {
        title: 'No payments yet',
        description: 'Fund an escrow to see your payment history here.',
      },
    });
  });

  it('leaves a non-empty payment list unchanged apart from the wrapper', async () => {
    const payments = [{ id: 'pay_1', status: 'Completed' }];
    paymentServiceMock.getByAddress.mockResolvedValue(payments);
    const req = { params: { address: ADDRESS_A }, user: { address: ADDRESS_A } };
    const res = createMockRes();

    await paymentController.listByAddress(req, res);

    expect(res.json).toHaveBeenCalledWith({ payments, isEmpty: false });
  });
});

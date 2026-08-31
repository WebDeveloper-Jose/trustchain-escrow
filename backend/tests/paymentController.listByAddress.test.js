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

describe('paymentController.listByAddress — empty state (#288)', () => {
  it('returns a friendly message alongside the empty list when there are no payments', async () => {
    const req = { params: { address: ADDRESS_A }, user: { address: ADDRESS_A } };
    const res = createMockRes();
    paymentServiceMock.getByAddress.mockResolvedValue([]);

    await paymentController.listByAddress(req, res);

    expect(res.body).toEqual({ payments: [], message: 'No payments found for this address yet.' });
  });

  it('omits the message once there are payments to show', async () => {
    const req = { params: { address: ADDRESS_A }, user: { address: ADDRESS_A } };
    const res = createMockRes();
    const payments = [{ id: 'pay_1', status: 'Completed' }];
    paymentServiceMock.getByAddress.mockResolvedValue(payments);

    await paymentController.listByAddress(req, res);

    expect(res.body).toEqual({ payments });
  });
});

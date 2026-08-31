import { jest } from '@jest/globals';

const { default: cacheService } = await import('../services/cacheService.js');
const { getXlmUsdPrice } = await import('../services/priceOracleService.js');

const ORDER_BOOK_KEY = 'price_oracle:xlm_usd';

function mockOrderBookResponse(price) {
  return {
    ok: true,
    json: () => Promise.resolve({ bids: [{ price: String(price) }] }),
  };
}

describe('priceOracleService (#286)', () => {
  beforeEach(async () => {
    await cacheService.invalidate(ORDER_BOOK_KEY);
    global.fetch = jest.fn();
  });

  it('fetches and returns the current XLM/USD price', async () => {
    global.fetch.mockResolvedValue(mockOrderBookResponse('0.42'));

    const price = await getXlmUsdPrice();

    expect(price).toBe(0.42);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('serves a cached price on a second call without refetching', async () => {
    global.fetch.mockResolvedValue(mockOrderBookResponse('0.5'));

    await getXlmUsdPrice();
    const second = await getXlmUsdPrice();

    expect(second).toBe(0.5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent calls into a single in-flight request', async () => {
    let resolveFetch;
    global.fetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = getXlmUsdPrice();
    const second = getXlmUsdPrice();
    resolveFetch(mockOrderBookResponse('0.37'));

    const [firstPrice, secondPrice] = await Promise.all([first, second]);

    expect(firstPrice).toBe(0.37);
    expect(secondPrice).toBe(0.37);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when Horizon responds with a non-ok status', async () => {
    global.fetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });

    await expect(getXlmUsdPrice()).rejects.toThrow('Failed to fetch XLM price');
  });

  it('throws when the order book has no bids', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ bids: [] }) });

    await expect(getXlmUsdPrice()).rejects.toThrow('No bids in order book');
  });
});

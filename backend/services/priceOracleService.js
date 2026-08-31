/**
 * Price Oracle Service
 *
 * Fetches the current XLM/USD price from the Stellar DEX order book via
 * Horizon. Extracted out of paymentService.js (#286), which only needed it
 * for one fiat→crypto conversion step, into its own module so other callers
 * don't have to reach into payment internals for a price quote.
 *
 * Uses cacheService's warm() (the same short-TTL caching pattern already
 * used elsewhere in this codebase, e.g. tokenMetricsService.js) plus
 * in-flight request de-duplication: concurrent callers while a fetch is
 * already pending share that one request instead of each firing their own
 * Horizon call. That's the backend equivalent of a "loading state" here —
 * there's no UI to show a spinner in, but the point still holds: don't
 * leave callers hammering the DEX (or racing to different prices) while a
 * quote is already in flight, and don't refetch a still-fresh one.
 */

import cacheService from './cacheService.js';

const STELLAR_HORIZON = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const XLM_USD_CACHE_KEY = 'price_oracle:xlm_usd';
const XLM_USD_TTL_SECONDS = 30;

let inFlight = null;

async function fetchXlmUsdPrice() {
  const res = await fetch(
    `${STELLAR_HORIZON}/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=${process.env.USDC_ISSUER}&limit=1`,
  );
  if (!res.ok) throw new Error('Failed to fetch XLM price');
  const { bids } = await res.json();
  if (!bids?.length) throw new Error('No bids in order book');
  return parseFloat(bids[0].price);
}

/**
 * Returns the current XLM/USD price (USD per 1 XLM). Serves a cached value
 * when fresh (within XLM_USD_TTL_SECONDS); otherwise fetches, caches, and
 * returns the result — de-duplicating concurrent calls onto the same
 * in-flight request.
 */
async function getXlmUsdPrice() {
  if (inFlight) return inFlight;

  inFlight = cacheService
    .warm(XLM_USD_CACHE_KEY, fetchXlmUsdPrice, XLM_USD_TTL_SECONDS)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export { getXlmUsdPrice };

export default { getXlmUsdPrice };

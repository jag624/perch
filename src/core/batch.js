// Statbate's batch endpoints take at most 100 names per call, and a batch of 100
// costs exactly one request against the 120/min account bucket. So the fan-out
// maths of the whole live pipeline (`arrivals -> dossier lookup`) is chunking.

export const BATCH_LIMIT = 100;

/**
 * Split items into consecutive chunks of at most `size`.
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size = BATCH_LIMIT) {
  if (!Array.isArray(items)) throw new Error('chunk: items must be an array');
  if (!Number.isInteger(size) || size <= 0) throw new Error('chunk: size must be a positive integer');
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Number of requests a list of N names will cost against the account bucket. */
export function batchCost(count, size = BATCH_LIMIT) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.ceil(count / size);
}

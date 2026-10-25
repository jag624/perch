// Attention ranking — the actual product surface.
//
// Transparent on purpose: a product of named factors, not a learned score. A
// ranking the streamer cannot explain is one she will not trust, and trust is the
// whole value here. Every entry carries its reasons so the UI never has to
// reverse-engineer why someone is on the list.

import { classifyTipper, DEFAULT_THRESHOLDS } from './classify.js';

export const DEFAULT_ATTENTION = Object.freeze({
  limit: 12,
  noveltyWindowMs: 120_000, // "just walked in" window
  noveltyMultiplier: 1.25,
  recencyWindowDays: 90,
  maxRecencyBonus: 0.6,
});

/**
 * @param {{ tierWeight: number, valueTokens: number, daysSinceLastTip: number|null, arrivedAt: number|null }} entry
 * @param {{ now: number, noveltyWindowMs: number, noveltyMultiplier: number, recencyWindowDays: number, maxRecencyBonus: number }} cfg
 */
export function scoreEntry(entry, cfg) {
  const novelty = entry.arrivedAt != null && cfg.now - entry.arrivedAt <= cfg.noveltyWindowMs ? cfg.noveltyMultiplier : 1;
  const recencyBonus =
    entry.daysSinceLastTip == null
      ? 0
      : Math.min(cfg.maxRecencyBonus, Math.max(0, 1 - entry.daysSinceLastTip / cfg.recencyWindowDays) * cfg.maxRecencyBonus);
  // 1 + log10 so a viewer with no recorded spend still ranks by tier weight
  // instead of collapsing every zero-value viewer onto the same score.
  const valueFactor = 1 + Math.log10(1 + Math.max(0, entry.valueTokens));
  const score = entry.tierWeight * (1 + recencyBonus) * valueFactor * novelty;
  return { score, parts: { novelty, recencyBonus, valueFactor } };
}

/**
 * @param {Array<{ room: object, member?: object|null, modelName?: string|null, arrivedAt?: number|null }>} entries
 * @param {{ thresholds?: object, now?: number, limit?: number } & Partial<typeof DEFAULT_ATTENTION>} [opts]
 */
export function buildAttentionQueue(entries, opts = {}) {
  const { thresholds = DEFAULT_THRESHOLDS, now = Date.now(), limit = DEFAULT_ATTENTION.limit } = opts;
  const cfg = {
    now,
    noveltyWindowMs: opts.noveltyWindowMs ?? DEFAULT_ATTENTION.noveltyWindowMs,
    noveltyMultiplier: opts.noveltyMultiplier ?? DEFAULT_ATTENTION.noveltyMultiplier,
    recencyWindowDays: opts.recencyWindowDays ?? DEFAULT_ATTENTION.recencyWindowDays,
    maxRecencyBonus: opts.maxRecencyBonus ?? DEFAULT_ATTENTION.maxRecencyBonus,
  };

  const scored = entries.map((entry) => {
    const classified = classifyTipper({ ...entry, thresholds, now });
    const { score, parts } = scoreEntry(
      {
        tierWeight: classified.weight,
        valueTokens: classified.valueTokens,
        daysSinceLastTip: classified.daysSinceLastTip,
        arrivedAt: entry.arrivedAt ?? null,
      },
      cfg,
    );
    return {
      username: entry.room.username,
      color: entry.room.color,
      userType: entry.room.userType,
      isAnonymous: entry.room.isAnonymous,
      tokens: entry.room.tokens,
      arrivedAt: entry.arrivedAt ?? null,
      dwellMs: entry.arrivedAt != null ? now - entry.arrivedAt : null,
      score: Math.round(score * 100) / 100,
      scoreParts: parts,
      tier: classified.tier,
      label: classified.label,
      weight: classified.weight,
      valueTokens: classified.valueTokens,
      elsewhereTokens: classified.elsewhereTokens,
      daysSinceLastTip: classified.daysSinceLastTip,
      breadth: classified.breadth,
      reasons: classified.reasons,
    };
  });

  // Ranked by ACTIONABILITY first (tier weight), then by score within the tier.
  // That is what makes a returning big spender genuinely top of the queue: the
  // score's value term must not be able to bury the single most time-sensitive
  // state in the room, which is somebody deciding right now whether to stay.
  scored.sort((a, b) => b.weight - a.weight || b.score - a.score || a.username.localeCompare(b.username));
  return scored.slice(0, limit).map((entry, i) => ({ ...entry, rank: i + 1 }));
}

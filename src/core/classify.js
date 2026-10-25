// Tipper classification.
//
// The point of the product is not to show a spend number, it is to say what to DO.
// So every classification returns the reasons alongside the tier, and the tier
// ordering is by actionability, not by size: a big past spender who just walked
// back in outranks a currently-active whale.
//
// THRESHOLDS ARE UNCALIBRATED GUESSES. They live in one object so they can be
// tuned against real rooms, and nothing measured on them may appear in product
// copy until that has happened (vault: projects/perch/open-items).

import { toNumber } from './room-feed.js';

export const DAY_MS = 86_400_000;

export const DEFAULT_THRESHOLDS = Object.freeze({
  whaleAllTimeTokens: 50_000,
  whaleTrailing30dTokens: 10_000,
  recencyDays: 7,
  lapseDays: 30,
  newAccountDays: 30,
});

export const TIER_WEIGHTS = Object.freeze({
  returning_whale: 100,
  whale: 80,
  regular: 60,
  prospect: 50,
  lapsed: 40,
  new_face: 20,
  history_unknown: 15,
  window_shopper: 10,
  anonymous: 0,
});

export const TIER_LABELS = Object.freeze({
  returning_whale: 'Returning big spender',
  whale: 'Whale',
  prospect: 'Pays elsewhere',
  regular: 'Regular',
  lapsed: 'Went quiet',
  new_face: 'New account',
  history_unknown: 'History unknown',
  window_shopper: 'Never tipped',
  anonymous: 'Anonymous',
});

export function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function formatTokens(n) {
  return Math.round(toNumber(n)).toLocaleString('en-US');
}

/**
 * @param {{
 *   room: object,                 // normalised viewer from the live room feed
 *   member?: object|null,         // row from /members/{site}/info/batch, or null
 *   modelName?: string|null,      // the room owner, to test membership in their tip list
 *   thresholds?: typeof DEFAULT_THRESHOLDS,
 *   now?: number
 * }} input
 */
export function classifyTipper({ room, member = null, modelName = null, thresholds = DEFAULT_THRESHOLDS, now = Date.now() } = {}) {
  if (!room) throw new Error('classifyTipper: a room feed entry is required');

  // A batch row can come back shaped {name, error} rather than null — the API
  // permits per-row errors — and that is just as unavailable as no dossier at all.
  const dossierUnavailable = !member || Boolean(member.error);

  const reasons = [];
  const valueTokens = toNumber(member?.all_time_tokens) || room.tokens.room.allTime || 0;
  const elsewhereTokens = Math.max(0, valueTokens - room.tokens.room.allTime);
  const trailing30 = toNumber(member?.last_30_days_tokens) || room.tokens.room.thirtyDays || 0;
  const lastTipAt = parseDate(member?.last_tip_date);
  const daysSinceLastTip = lastTipAt == null ? null : (now - lastTipAt) / DAY_MS;
  const breadth = toNumber(member?.models_tipped_2weeks);
  const tippedList = Array.isArray(member?.models_tipped_2weeks_list) ? member.models_tipped_2weeks_list : [];
  const tippedHere = room.tokens.room.allTime > 0;
  const tippedHereRecently = room.tokens.room.week > 0 || room.tokens.room.day > 0;
  const tippedHereThisFortnight = modelName
    ? tippedList.some((n) => String(n).toLowerCase() === String(modelName).toLowerCase())
    : false;

  const result = (tier) => ({
    tier,
    label: TIER_LABELS[tier] ?? tier,
    weight: TIER_WEIGHTS[tier] ?? 0,
    valueTokens,
    elsewhereTokens,
    trailing30Tokens: trailing30,
    lastTipAt,
    daysSinceLastTip,
    breadth,
    tippedHere,
    tippedHereRecently,
    reasons,
  });

  if (room.isAnonymous) {
    reasons.push('no account — cannot tip');
    return result('anonymous');
  }

  // Context first, decisive reason unshifted after.
  if (tippedHere) reasons.push(`${formatTokens(room.tokens.room.allTime)} tokens with this room all-time`);
  else if (elsewhereTokens > 0) reasons.push(`${formatTokens(elsewhereTokens)} tokens in other rooms`);
  if (daysSinceLastTip != null) reasons.push(`last tipped ${Math.round(daysSinceLastTip)} days ago`);
  if (breadth > 0) reasons.push(`tipped ${breadth} model${breadth === 1 ? '' : 's'} in the last 2 weeks`);
  if (tippedHereRecently) reasons.push('tipping this room recently');
  if (dossierUnavailable) reasons.push('no dossier returned — tier inferred from the live feed only');

  const lapsed = daysSinceLastTip != null && daysSinceLastTip > thresholds.lapseDays;
  // The dossier's own recency beats the feed's window: if the last recorded tip is
  // inside the recency horizon they are active here, whatever the room's bucket
  // says. Scoped to viewers who HAVE tipped this room — otherwise every prospect
  // would read as a regular just for being a recent spender somewhere else.
  const recentHere = tippedHere && daysSinceLastTip != null && daysSinceLastTip <= thresholds.recencyDays;
  let tier;

  if (valueTokens >= thresholds.whaleAllTimeTokens && lapsed) {
    tier = 'returning_whale';
    reasons.unshift(`big past spender (${formatTokens(valueTokens)} tokens) back after ${Math.round(daysSinceLastTip)} days`);
  } else if (valueTokens >= thresholds.whaleAllTimeTokens || trailing30 >= thresholds.whaleTrailing30dTokens) {
    tier = 'whale';
    reasons.unshift(`whale: ${formatTokens(valueTokens)} tokens all-time`);
  } else if ((tippedHere || tippedHereThisFortnight) && lapsed) {
    tier = 'lapsed';
    reasons.unshift(`has tipped this room before, quiet ${Math.round(daysSinceLastTip)} days`);
  } else if (tippedHereRecently || tippedHereThisFortnight || recentHere) {
    tier = 'regular';
    reasons.unshift('spending here right now');
  } else if (tippedHere) {
    tier = 'lapsed';
    reasons.unshift('has tipped this room before, not recently');
  } else if (lastTipAt != null) {
    // Has tipped somewhere, just never this room. Tip breadth is supporting
    // evidence here, not the gate — a known tipper is never "never tipped".
    tier = 'prospect';
    reasons.unshift(
      breadth > 0 ? `pays other models (${breadth} in 2 weeks) and never this room` : 'has tipped before, but never this room',
    );
  } else if (dossierUnavailable) {
    tier = 'history_unknown';
    reasons.unshift('history unknown — worth a lookup, not a conclusion');
  } else {
    // No recorded tip anywhere — the only viewers who can honestly be called
    // new or never-tipped.
    const tenure = parseDate(member.first_message_date);
    const tenureDays = tenure == null ? null : (now - tenure) / DAY_MS;
    if (tenureDays != null && tenureDays < thresholds.newAccountDays) {
      tier = 'new_face';
      reasons.unshift(`new account (${Math.round(tenureDays)} days), no tips yet`);
    } else {
      tier = 'window_shopper';
      reasons.unshift(tenureDays == null ? 'no tip history' : `registered ${Math.round(tenureDays)} days, never tipped`);
    }
  }

  return result(tier);
}

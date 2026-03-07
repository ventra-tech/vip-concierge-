/**
 * policy/reign.js
 * Single source of truth for all Reign venue rules.
 * All logic here is deterministic — no LLM involved.
 */

const REIGN = {
  name: 'Reign',
  address: '215, The London Reign, 217 Piccadilly, London W1J 9HN',
  instagram: '@ldnreign',
  entry_fee: 20,
  arrival_by: '23:00',
  arrival_ideal: '11:30pm–midnight',
  dress_code_girls: 'elegant & heels',
  dress_code_guys: 'smart wear',
  id_requirement: 'Physical ID required (and photo of passport on phone)',
  door_phrase: 'Sanad guestlist',
};

// ─── TABLE MINIMUM SPEND ────────────────────────────────────────────────────

/**
 * Returns the minimum table spend for a given group.
 * @param {number} groupSize - Total number of guests
 * @param {'weekday'|'weekend'|null} nightType
 * @returns {{ min: number, max: number|null, label: string }}
 */
function getTableMinimum(groupSize, nightType) {
  const isWeekend = nightType === 'weekend';

  if (groupSize <= 3) {
    return { min: 750, max: null, label: '£750' };
  }
  if (groupSize <= 6) {
    const min = isWeekend ? 1200 : 1000;
    return { min, max: null, label: `£${min}` };
  }
  if (groupSize <= 9) {
    return { min: 1500, max: 2000, label: '£1,500–£2,000' };
  }
  return { min: 2000, max: 2500, label: '£2,000–£2,500+' };
}

// ─── GUESTLIST ELIGIBILITY ───────────────────────────────────────────────────

/**
 * Evaluates whether a group is eligible for guestlist.
 * Returns a decision with a reason.
 *
 * @param {{ guys: number, girls: number, nightType: 'weekday'|'weekend'|null }} params
 * @returns {{ decision: 'approved'|'push_table'|'handoff', reason: string }}
 */
function evaluateGuestlistEligibility({ guys, girls, nightType }) {
  // Girls only — always approved
  if (guys === 0 && girls > 0) {
    return { decision: 'approved', reason: 'girls_only' };
  }

  // Mixed or guys only
  if (guys >= 3) {
    return {
      decision: 'push_table',
      reason: '3_or_more_guys_no_guestlist',
    };
  }

  if (guys === 2) {
    if (nightType === 'weekend') {
      // Need 6–8 girls (3–4 per guy)
      if (girls >= 6) return { decision: 'approved', reason: 'ratio_met_weekend' };
      if (girls === 0 || girls === null) return { decision: 'handoff', reason: 'ratio_unclear' };
      return { decision: 'handoff', reason: 'ratio_insufficient_weekend' };
    }
    if (nightType === 'weekday') {
      // Need 4–6 girls (2–3 per guy)
      if (girls >= 4) return { decision: 'approved', reason: 'ratio_met_weekday' };
      if (girls === 0 || girls === null) return { decision: 'handoff', reason: 'ratio_unclear' };
      return { decision: 'handoff', reason: 'ratio_insufficient_weekday' };
    }
    // Night type unknown — can't confirm ratio
    return { decision: 'handoff', reason: 'night_type_unknown' };
  }

  if (guys === 1) {
    if (girls >= 5) return { decision: 'approved', reason: 'solo_guy_ratio_met' };
    if (girls === 0 || girls === null) return { decision: 'handoff', reason: 'solo_guy_ratio_unclear' };
    return { decision: 'push_table', reason: 'solo_guy_insufficient_girls' };
  }

  return { decision: 'handoff', reason: 'unknown_group_composition' };
}

// ─── HANDOFF TRIGGER CHECK ───────────────────────────────────────────────────

const OTHER_VENUES = ['tabu', 'cirque le soir', 'maddox', 'selene', 'dear darling'];

/**
 * Checks whether this message or state requires an immediate handoff.
 * @param {{ messageType: string, messageText: string, state: object }} params
 * @returns {{ required: boolean, reason: string|null }}
 */
function checkHandoffRequired({ messageType, messageText, state }) {
  // Voice / image / video messages
  if (['voice', 'image', 'video'].includes(messageType)) {
    return { required: true, reason: `${messageType}_message_received` };
  }

  const lowerText = messageText.toLowerCase();

  // Other venue mentions
  const mentionedVenue = OTHER_VENUES.find((v) => lowerText.includes(v));
  if (mentionedVenue) {
    return { required: true, reason: `other_venue_mentioned:${mentionedVenue}` };
  }

  // Pre-dinner booking intent — only fires when someone is planning a meal before the club.
  // Must match specific phrases, not casual "pre drinks" questions.
  const preDinnerPhrases = [
    'pre dinner', 'pre-dinner', 'predinner',
    'dinner before', 'meal before', 'eat before',
    'restaurant before', 'dinner then', 'dinner and then',
    'dinner first', 'food before',
  ];
  if (preDinnerPhrases.some(p => lowerText.includes(p))) {
    return { required: true, reason: 'pre_dinner_mentioned' };
  }

  return { required: false, reason: null };
}

// ─── BOOKING VALUE CALCULATOR ────────────────────────────────────────────────

/**
 * Calculate the estimated value of a confirmed booking.
 * Guestlist: entry fee × headcount.
 * Table: minimum spend from getTableMinimum().
 *
 * @param {object} state
 * @returns {{ min: number, max: number|null, label: string }}
 */
function calculateBookingValue(state) {
  if (state.lead_type === 'guestlist') {
    const headcount = state.girls || state.group_size || 0;
    const value = headcount * REIGN.entry_fee;
    return { min: value, max: null, label: value > 0 ? `£${value}` : 'Free (guestlist)' };
  }

  if (state.lead_type === 'table') {
    const groupSize = state.group_size || 0;
    if (groupSize === 0) return { min: 0, max: null, label: 'TBC' };
    return getTableMinimum(groupSize, state.night_type);
  }

  return { min: 0, max: null, label: 'TBC' };
}

// ─── NIGHT TYPE HELPER ───────────────────────────────────────────────────────

/**
 * Determines if a date string or day name is a weekday or weekend.
 * Falls back to null if unknown.
 * @param {string} input - e.g. "friday", "saturday", "monday"
 * @returns {'weekday'|'weekend'|null}
 */
function detectNightType(input) {
  if (!input) return null;
  const lower = input.toLowerCase();
  if (['friday', 'saturday', 'sunday'].some((d) => lower.includes(d))) return 'weekend';
  if (['monday', 'tuesday', 'wednesday', 'thursday'].some((d) => lower.includes(d))) return 'weekday';
  // tonight / today — use current day
  if (lower.includes('tonight') || lower.includes('today')) {
    const day = new Date().getDay(); // 0=Sun, 6=Sat
    return [0, 5, 6].includes(day) ? 'weekend' : 'weekday';
  }
  // tomorrow — use next day
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getDay(); // 0=Sun, 6=Sat
    return [0, 5, 6].includes(tomorrowDay) ? 'weekend' : 'weekday';
  }
  // this weekend / next weekend
  if (lower.includes('weekend')) return 'weekend';
  // weekday / midweek / this week
  if (lower.includes('weekday') || lower.includes('midweek') || lower.includes('this week')) return 'weekday';
  return null;
}

module.exports = {
  REIGN,
  getTableMinimum,
  calculateBookingValue,
  evaluateGuestlistEligibility,
  checkHandoffRequired,
  detectNightType,
  OTHER_VENUES,
};

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
      // Weekend: need 6+ girls — anything fewer goes to Sanad
      if (girls >= 6) return { decision: 'approved', reason: 'ratio_met_weekend' };
      if (girls === 0 || girls === null) return { decision: 'handoff', reason: 'ratio_unclear' };
      return { decision: 'handoff', reason: 'ratio_insufficient_weekend' };
    }
    if (nightType === 'weekday') {
      // Weekday: 2:2 ratio minimum — 2+ girls approved
      if (girls >= 2) return { decision: 'approved', reason: 'ratio_met_weekday' };
      if (girls === 0 || girls === null) return { decision: 'handoff', reason: 'ratio_unclear' };
      return { decision: 'handoff', reason: 'ratio_insufficient_weekday' };
    }
    // Night type unknown — can't confirm ratio
    return { decision: 'handoff', reason: 'night_type_unknown' };
  }

  if (guys === 1) {
    if (girls >= 5) return { decision: 'approved', reason: 'solo_guy_ratio_met' };
    if (girls === 0 || girls === null) return { decision: 'handoff', reason: 'solo_guy_ratio_unclear' };
    if (nightType === 'weekday') return { decision: 'approved', reason: 'solo_guy_weekday_approved' };
    // Weekend with 1–4 girls — handoff to Sanad
    return { decision: 'handoff', reason: 'solo_guy_insufficient_girls_weekend' };
  }

  return { decision: 'handoff', reason: 'unknown_group_composition' };
}

// ─── VENUE SCHEDULE ───────────────────────────────────────────────────────────

const REIGN_OPEN_DAYS = ['tuesday', 'thursday', 'friday', 'saturday'];

// Priority order for pitching partner venues when Reign is closed.
// First in the list = pitch first.
const VENUE_PRIORITY = ['tabu', 'cirque le soir', 'coco', 'maddox', 'dear darling', 'tape', 'selene'];

const VENUE_SCHEDULE = {
  'cirque le soir': ['monday', 'wednesday', 'friday', 'saturday'],
  'tabu':           ['wednesday', 'thursday', 'friday', 'saturday'],
  'coco':           ['wednesday', 'friday', 'saturday'],
  'maddox':         ['thursday', 'friday', 'saturday'],
  'selene':         ['friday', 'saturday', 'sunday'],
  'dear darling':   ['thursday', 'friday', 'saturday', 'sunday'],
  'tape':           ['tuesday', 'friday', 'saturday', 'sunday'],
};

/**
 * Returns true if Reign is open on the given day name, false if not, null if unknown.
 * @param {string|null} dayName - e.g. 'friday', 'saturday'
 * @returns {boolean|null}
 */
function isReignOpenOn(dayName) {
  if (!dayName) return null;
  return REIGN_OPEN_DAYS.includes(dayName.toLowerCase());
}

// ─── VENUE BOOKING CUTOFFS ────────────────────────────────────────────────────
// All times are HH:MM, 24h, UK local time (early morning after midnight).
// null = advance booking only — no last-minute / walk-in entries (e.g. Maddox).

const VENUE_CUTOFFS = {
  'reign': {
    'tuesday':  { guestlist: '02:00', table: '02:30' },
    'thursday': { guestlist: '01:30', table: '02:00' },
    'friday':   { guestlist: '01:30', table: '02:00' },
    'saturday': { guestlist: '02:00', table: '03:00' },
  },
  'cirque le soir': {
    'monday':    { guestlist: '02:00', table: '02:00' },
    'wednesday': { guestlist: '02:00', table: '02:00' },
    'friday':    { guestlist: '02:00', table: '02:00' },
    'saturday':  { guestlist: '02:00', table: '02:00' },
  },
  'tabu': {
    'wednesday': { guestlist: '02:00', table: '02:30' },
    'thursday':  { guestlist: '02:00', table: '02:30' },
    'friday':    { guestlist: '02:00', table: '02:30' },
    'saturday':  { guestlist: '02:00', table: '02:30' },
  },
  'coco': {
    'wednesday': { guestlist: '02:00', table: '02:00' },
    'friday':    { guestlist: '02:00', table: '02:00' },
    'saturday':  { guestlist: '02:00', table: '02:00' },
  },
  'maddox': {
    'thursday': { guestlist: null, table: null },
    'friday':   { guestlist: null, table: null },
    'saturday': { guestlist: null, table: null },
  },
  'selene': {
    'friday':   { guestlist: '01:30', table: '02:30' },
    'saturday': { guestlist: '01:30', table: '02:30' },
    'sunday':   { guestlist: '01:30', table: '02:30' },
  },
  'dear darling': {
    'thursday': { guestlist: '01:30', table: '02:00' },
    'friday':   { guestlist: '01:30', table: '02:00' },
    'saturday': { guestlist: '01:30', table: '02:00' },
    'sunday':   { guestlist: '01:30', table: '02:00' },
  },
  'tape': {
    'tuesday':  { guestlist: '01:30', table: '02:00' },
    'friday':   { guestlist: '01:30', table: '02:00' },
    'saturday': { guestlist: '01:30', table: '02:00' },
    'sunday':   { guestlist: '01:30', table: '02:00' },
  },
};

/** @param {string} t - 'HH:MM' */
function _toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Determines the effective "nightclub night" given the current time.
 * Between midnight and ~7 AM the previous calendar night is still "active"
 * until the last booking cutoff across all venues has passed.
 *
 * @returns {{ effectiveDay: string, calendarDay: string, isLateNight: boolean, now: Date }}
 */
function getEffectiveNightclubDay() {
  const now = new Date();
  const hour = now.getHours();
  const DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const calendarDay = DAY[now.getDay()];

  if (hour < 7) {
    const prevDay = DAY[(now.getDay() - 1 + 7) % 7];
    const nowMins = hour * 60 + now.getMinutes();

    // Find the latest cutoff across all venues for the previous night
    let latestMins = 0;
    for (const cutoffs of Object.values(VENUE_CUTOFFS)) {
      const c = cutoffs[prevDay];
      if (!c) continue;
      if (c.table)     latestMins = Math.max(latestMins, _toMins(c.table));
      if (c.guestlist) latestMins = Math.max(latestMins, _toMins(c.guestlist));
    }

    if (latestMins > 0 && nowMins < latestMins) {
      return { effectiveDay: prevDay, calendarDay, isLateNight: true, now };
    }
  }

  return { effectiveDay: calendarDay, calendarDay, isLateNight: false, now };
}

/**
 * Returns live booking status (guestlist / table open or closed) for a venue on a nightclub night.
 * @param {string} venue
 * @param {string} effectiveDay
 * @param {Date} now
 * @returns {{ guestlistOpen: boolean|null, tableOpen: boolean|null, guestlistCutoff: string|null, tableCutoff: string|null }|null}
 *   null = venue not open on this night
 *   guestlistOpen/tableOpen null = advance booking only (no last-minute entry)
 */
function getVenueBookingStatus(venue, effectiveDay, now) {
  const cutoffs = VENUE_CUTOFFS[venue]?.[effectiveDay];
  if (!cutoffs) return null;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isLateNight = now.getHours() < 7;

  const resolve = (t) => {
    if (t === null) return null;                         // advance booking only
    if (!isLateNight) return true;                       // daytime — always open
    return nowMins < _toMins(t);                         // late night — check cutoff
  };

  return {
    guestlistOpen:    resolve(cutoffs.guestlist),
    tableOpen:        resolve(cutoffs.table),
    guestlistCutoff:  cutoffs.guestlist,
    tableCutoff:      cutoffs.table,
  };
}

// ─── HANDOFF TRIGGER CHECK ───────────────────────────────────────────────────

const OTHER_VENUES = ['tabu', 'cirque le soir', 'maddox', 'selene', 'dear darling', 'tape', 'coco'];

/**
 * Checks whether this message or state requires an immediate handoff.
 * Returns { required, reason } for handoffs, or { required: false, otherVenueDetected, mentionedVenue }
 * when a venue is detected but we should pitch Reign first instead of handing off.
 *
 * @param {{ messageType: string, messageText: string, state: object }} params
 * @returns {{ required: boolean, reason: string|null, otherVenueDetected?: boolean, mentionedVenue?: string }}
 */
function checkHandoffRequired({ messageType, messageText, state }) {
  // Voice / image / video messages
  if (['voice', 'image', 'video'].includes(messageType)) {
    return { required: true, reason: `${messageType}_message_received` };
  }

  const lowerText = messageText.toLowerCase();

  // ── Other venue handling — pitch Reign first, only handoff if they insist ──

  // If we've already pitched Reign, check if customer is dismissing it
  if (state.mentioned_venue && state.reign_pitched) {
    const venue = state.mentioned_venue;
    const insistSignals = [venue, 'nah', 'no thanks', 'prefer', 'rather', 'stick with', 'still going', 'still want', 'pass on reign', 'not reign', "don't want reign"];
    if (insistSignals.some(s => lowerText.includes(s))) {
      return { required: true, reason: `other_venue_insists:${venue}` };
    }
  }

  // Fresh mention of another venue — don't handoff yet, pitch Reign first
  const mentionedVenue = OTHER_VENUES.find((v) => lowerText.includes(v));
  if (mentionedVenue) {
    return { required: false, reason: null, otherVenueDetected: true, mentionedVenue };
  }

  // Age queries — club is always 18+ but some nights are 21+, Sanad confirms
  const agePhrase = [
    'age limit', 'age requirement', 'minimum age', 'how old', 'old enough',
    '18+', '21+', 'over 18', 'over 21', 'age to get in', 'age restriction',
    'what age', 'age check',
  ].some(p => lowerText.includes(p));
  if (agePhrase) {
    return { required: true, reason: 'age_query' };
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

  // Specific day names
  if (['friday', 'saturday', 'sunday'].some((d) => lower.includes(d))) return 'weekend';
  if (['monday', 'tuesday', 'wednesday', 'thursday'].some((d) => lower.includes(d))) return 'weekday';

  // tonight / today — use current day
  if (lower.includes('tonight') || lower.includes('today')) {
    const day = new Date().getDay(); // 0=Sun, 6=Sat
    return [0, 5, 6].includes(day) ? 'weekend' : 'weekday';
  }

  // tomorrow / tmr / tmrw — use next day
  if (/\b(tomorrow|tmr|tmrw)\b/.test(lower)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const d = tomorrow.getDay();
    return [0, 5, 6].includes(d) ? 'weekend' : 'weekday';
  }

  // Explicit weekend signals
  if (/\b(weekend|this weekend|next weekend|sat night|saturday night|friday night)\b/.test(lower)) {
    return 'weekend';
  }

  // Weekday signals
  if (/\b(weekday|midweek|this week)\b/.test(lower)) return 'weekday';

  // Vague timing — default to weekend (safer for pricing)
  if (/\b(any night|fun night|a night|some night|next week|soon|coming up)\b/.test(lower)) {
    return 'weekend';
  }

  return null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Returns a human-readable night label from raw user input.
 * e.g. "friday" → "Friday", "tonight" → "Tonight (Friday)", "tmr" → "Tomorrow (Saturday)"
 * @param {string} input
 * @returns {string|null}
 */
function getNightLabel(input) {
  if (!input) return null;
  const lower = input.toLowerCase();

  // Specific day names — capitalise and return
  if (lower.includes('friday'))    return 'Friday';
  if (lower.includes('saturday'))  return 'Saturday';
  if (lower.includes('sunday'))    return 'Sunday';
  if (lower.includes('monday'))    return 'Monday';
  if (lower.includes('tuesday'))   return 'Tuesday';
  if (lower.includes('wednesday')) return 'Wednesday';
  if (lower.includes('thursday'))  return 'Thursday';

  // tonight / today → resolve to actual day name
  if (lower.includes('tonight') || lower.includes('today')) {
    return `Tonight (${DAY_NAMES[new Date().getDay()]})`;
  }

  // tomorrow / tmr / tmrw → resolve to actual day name
  if (/\b(tomorrow|tmr|tmrw)\b/.test(lower)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `Tomorrow (${DAY_NAMES[tomorrow.getDay()]})`;
  }

  // Weekend phrases
  if (/\bnext weekend\b/.test(lower))  return 'Next weekend';
  if (/\bthis weekend\b/.test(lower))  return 'This weekend';
  if (/\bfriday night\b/.test(lower))  return 'Friday night';
  if (/\bsat(urday)? night\b/.test(lower)) return 'Saturday night';
  if (/\bweekend\b/.test(lower))       return 'Weekend';

  // Weekday phrases
  if (/\b(midweek|weekday)\b/.test(lower)) return 'Midweek';
  if (/\bthis week\b/.test(lower))     return 'This week';

  // Vague timing
  if (/\b(next week|soon|coming up|any night|fun night|a night|some night)\b/.test(lower)) return 'Soon';

  return null;
}

module.exports = {
  REIGN,
  getTableMinimum,
  calculateBookingValue,
  checkHandoffRequired,
  detectNightType,
  getNightLabel,
  OTHER_VENUES,
  VENUE_SCHEDULE,
  VENUE_CUTOFFS,
  REIGN_OPEN_DAYS,
  VENUE_PRIORITY,
  isReignOpenOn,
  getEffectiveNightclubDay,
  getVenueBookingStatus,
  toMins: _toMins,
};

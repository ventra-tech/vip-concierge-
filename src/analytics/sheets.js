/**
 * analytics/sheets.js
 * Builds the LOG_TO_SHEETS action payload sent back to n8n.
 *
 * n8n receives this action and appends one row to each of the two tabs:
 *   Tab 1 "Metrics"       — structured per-outcome data for tracking KPIs
 *   Tab 2 "Conversations" — full transcript per conversation for LLM training
 *
 * Column order MUST match the Google Sheet header row exactly.
 * See column definitions below — share these with Sanad when setting up the sheet.
 */

// ─── METRICS TAB COLUMNS (Tab 1) ─────────────────────────────────────────────
// A  Timestamp
// B  Customer
// C  Subscriber ID
// D  Outcome          (Confirmed / Handoff / Rejected / Manual Override)
// E  Lead Type        (guestlist / table / unknown)
// F  Night
// G  Group
// H  Names Collected
// I  Instagrams
// J  Phone Number
// K  Est. Value (£)
// L  Messages (turns)
// M  Time Saved (mins)
// N  Handoff Reason

// ─── CONVERSATIONS TAB COLUMNS (Tab 2) ───────────────────────────────────────
// A  Timestamp
// B  Customer
// C  Subscriber ID
// D  Outcome
// E  Lead Type
// F  Night
// G  Full Transcript
// H  Quality          (blank — Sanad fills in manually: Good / Bad / Review)
// I  Notes            (blank — Sanad fills in manually)
// J  Use for Training (blank — Sanad ticks manually: Yes / No)

/**
 * Build a LOG_TO_SHEETS action payload for n8n to write to Google Sheets.
 *
 * @param {string} outcome   - Human-readable outcome label
 * @param {import('../state').ConversationState} state
 * @returns {object} Action payload with type 'LOG_TO_SHEETS'
 */
const { calculateBookingValue } = require('../policy/reign');

function buildSheetsLog(outcome, state) {
  const ts = new Date().toISOString();
  const customer = state.username
    ? `@${state.username}`
    : state.first_name || state.subscriberId;

  const night = state.night_label || state.night_type || 'Unknown';

  // Group description — "3G + 2F" if split known, else plain count
  const group = (state.guys !== null && state.girls !== null)
    ? `${state.guys}M + ${state.girls}F`
    : state.group_size
      ? `${state.group_size} people`
      : 'Unknown';

  const names      = (state.collected_names      || []).join(', ');
  const instagrams = (state.collected_instagrams || []).join(', ');
  const estValue   = _estimateValue(state);

  // Rough time saved: each turn takes ~2 mins to handle manually
  const timeSavedMins = Math.round((state.turn_count || 0) * 2);

  // ── Metrics row ────────────────────────────────────────────────────────────
  const metricsRow = [
    ts,                                      // A: Timestamp
    customer,                                // B: Customer
    state.subscriberId,                      // C: Subscriber ID
    outcome,                                 // D: Outcome
    state.lead_type   || 'unknown',          // E: Lead Type
    night,                                   // F: Night
    group,                                   // G: Group
    names,                                   // H: Names Collected
    instagrams,                              // I: Instagrams
    state.phone_number || '',                // J: Phone Number
    estValue ? `£${estValue}` : '',         // K: Est. Value
    state.turn_count  || 0,                  // L: Messages
    `${timeSavedMins} mins`,                 // M: Time Saved
    state.handoff_reason || '',              // N: Handoff Reason
  ];

  // ── Conversations row ───────────────────────────────────────────────────────
  const transcript = (state.conversation_history || [])
    .map(m => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content}`)
    .join('\n');

  const conversationsRow = [
    ts,                           // A: Timestamp
    customer,                     // B: Customer
    state.subscriberId,           // C: Subscriber ID
    outcome,                      // D: Outcome
    state.lead_type || 'unknown', // E: Lead Type
    night,                        // F: Night
    transcript,                   // G: Full Transcript
    '',                           // H: Quality        (manual)
    '',                           // I: Notes          (manual)
    '',                           // J: Use for Training (manual)
  ];

  return {
    type: 'LOG_TO_SHEETS',
    subscriberId: state.subscriberId,
    metrics_row: metricsRow,
    conversations_row: conversationsRow,
  };
}

// ─── INTERNAL ─────────────────────────────────────────────────────────────────

function _estimateValue(state) {
  const { min } = calculateBookingValue(state);
  return min || null;
}

module.exports = { buildSheetsLog };

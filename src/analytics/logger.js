/**
 * analytics/logger.js
 * Lightweight event logger for tracking lead activity.
 * Logs to console in dev. Swap out the _send function for a real service in prod.
 */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * @typedef {object} AnalyticsEvent
 * @property {string} event           - Event name
 * @property {string} subscriberId
 * @property {string} intent
 * @property {string} lead_type
 * @property {number|null} estimated_value  - Estimated spend in GBP
 * @property {string} status
 * @property {boolean} handoff
 * @property {string|null} handoff_reason
 * @property {number} turn_count
 * @property {string} timestamp
 */

/**
 * Build and log an analytics event from the current state.
 * @param {string} eventName
 * @param {import('../state').ConversationState} state
 * @param {object} [extra]
 * @returns {AnalyticsEvent}
 */
function logEvent(eventName, state, extra = {}) {
  const event = {
    event: eventName,
    subscriberId: state.subscriberId,
    intent: state.last_intent || 'unknown',
    lead_type: state.lead_type,
    estimated_value: _estimateValue(state),
    status: state.status,
    handoff: state.status === 'handoff',
    handoff_reason: state.handoff_reason || null,
    turn_count: state.turn_count,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  _send(event);
  return event;
}

/**
 * Log a handoff event specifically.
 * @param {import('../state').ConversationState} state
 */
function logHandoff(state) {
  return logEvent('handoff_triggered', state, {
    handoff_reason: state.handoff_reason,
  });
}

/**
 * Log a booking confirmation.
 * @param {import('../state').ConversationState} state
 */
function logConfirmation(state) {
  return logEvent('booking_confirmed', state);
}

/**
 * Log a message received event.
 * @param {import('../state').ConversationState} state
 * @param {string} intent
 */
function logMessageReceived(state, intent) {
  return logEvent('message_received', state, { intent });
}

// ─── INTERNAL ─────────────────────────────────────────────────────────────────

function _send(event) {
  if (isDev) {
    console.log(`[analytics] ${event.event}`, JSON.stringify(event, null, 2));
    return;
  }
  // TODO: Replace with real analytics service (Mixpanel, Segment, etc.)
  // Example: await fetch('https://your-analytics.com/track', { method: 'POST', body: JSON.stringify(event) });
  console.log(`[analytics] ${event.event} | subscriber: ${event.subscriberId} | value: £${event.estimated_value || 0}`);
}

function _estimateValue(state) {
  if (state.lead_type === 'table' && state.group_size) {
    // Rough estimate based on group size
    if (state.group_size <= 3) return 750;
    if (state.group_size <= 6) return state.night_type === 'weekend' ? 1200 : 1000;
    if (state.group_size <= 9) return 1750;
    return 2250;
  }
  if (state.lead_type === 'guestlist') {
    // Guestlist = entry fee per person
    const total = (state.group_size || 1) * 20;
    return total;
  }
  return null;
}

module.exports = { logEvent, logHandoff, logConfirmation, logMessageReceived };

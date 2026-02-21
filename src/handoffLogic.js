/**
 * handoffLogic.js
 * Manages the handoff process — alerting Sanad and pausing the AI.
 * Also handles resuming the AI after Sanad has made a decision.
 */

const { resumeSession } = require('./sessionStore');

// ─── HANDOFF ACTION BUILDER ───────────────────────────────────────────────────

/**
 * Build the HANDOFF_ALERT action payload sent back to n8n / the caller.
 * n8n will use this to send a WhatsApp alert to Sanad.
 *
 * @param {import('./state').ConversationState} state
 * @returns {object} Action payload
 */
function buildHandoffAlert(state) {
  const summaryLines = [
    `🚨 *HANDOFF REQUIRED*`,
    `Reason: ${formatHandoffReason(state.handoff_reason)}`,
    ``,
    `*Lead Summary:*`,
    `• Type: ${state.lead_type}`,
    `• Group: ${_describeGroup(state)}`,
    `• Night: ${state.night_type || 'not specified'}`,
    `• Status: ${state.status}`,
    `• Turn: ${state.turn_count}`,
  ];

  if (state.collected_names.length > 0) {
    summaryLines.push(`• Names: ${state.collected_names.join(', ')}`);
  }

  return {
    type: 'HANDOFF_ALERT',
    priority: 'high',
    subscriberId: state.subscriberId,
    summary: summaryLines.join('\n'),
    handoff_reason: state.handoff_reason,
    state_snapshot: state,
    // Buttons for Sanad to respond via WhatsApp bot
    sanad_options: _getSanadOptions(state),
  };
}

/**
 * Get the holding message to send to the guest while Sanad takes over.
 * @param {import('./state').ConversationState} state
 * @returns {string}
 */
function getHoldingMessage(state) {
  const reason = state.handoff_reason || '';

  if (reason.includes('voice')) {
    return "Got it ❤️‍🔥 I've listened to your voice note — I'll reply properly shortly 👀";
  }
  if (reason.includes('image') || reason.includes('video')) {
    return "Got it ❤️‍🔥 I'll get back to you shortly 👀";
  }
  if (reason.includes('other_venue')) {
    return "Let me check what's available and get back to you shortly 😏";
  }
  if (reason.includes('ratio') || reason.includes('borderline')) {
    return "Let me check this for you bro 👀 I'll confirm shortly";
  }
  if (reason.includes('large_table') || reason.includes('pre_dinner')) {
    return "Love that 🍾 Let me put something together for you — I'll be back shortly";
  }

  return "Give me a sec 👀 I'll get back to you shortly";
}

// ─── RESUME LOGIC ─────────────────────────────────────────────────────────────

/**
 * Valid decisions Sanad can make after a handoff.
 */
const SANAD_DECISIONS = {
  APPROVE_GUESTLIST: 'approve_guestlist',
  PUSH_TABLE: 'push_table',
  REJECT: 'reject',
  CUSTOM: 'custom',
};

/**
 * Resume the AI conversation after Sanad has made a decision.
 * @param {string} subscriberId
 * @param {'approve_guestlist'|'push_table'|'reject'|'custom'} decision
 * @param {object} [extra] - Extra data from Sanad (e.g. custom message)
 * @returns {{ resumedState: object, nextAction: string, extra: object }}
 */
function resumeAfterHandoff(subscriberId, decision, extra = {}) {
  let resumeData = {};
  let nextAction = '';

  switch (decision) {
    case SANAD_DECISIONS.APPROVE_GUESTLIST:
      resumeData = { status: 'approved', lead_type: 'guestlist' };
      nextAction = 'approve_guestlist';
      break;

    case SANAD_DECISIONS.PUSH_TABLE:
      resumeData = { status: 'qualifying', lead_type: 'table' };
      nextAction = 'push_table';
      break;

    case SANAD_DECISIONS.REJECT:
      resumeData = { status: 'closed' };
      nextAction = 'reject';
      break;

    case SANAD_DECISIONS.CUSTOM:
      resumeData = { status: 'qualifying' };
      nextAction = 'custom';
      break;

    default:
      resumeData = { status: 'qualifying' };
      nextAction = 'rapport';
  }

  const resumedState = resumeSession(subscriberId, resumeData);
  return { resumedState, nextAction, extra };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatHandoffReason(reason) {
  const map = {
    voice_message_received: '🎤 Voice note received',
    image_message_received: '📸 Image received',
    video_message_received: '🎥 Video received',
    large_table_group: '🍾 Large group table request (5+)',
    pre_dinner_mentioned: '🍽️ Pre-dinner mentioned',
    ratio_unclear: '❓ Guy ratio unclear',
    ratio_insufficient_weekend: '❌ Ratio not met (weekend)',
    ratio_insufficient_weekday: '❌ Ratio not met (weekday)',
    solo_guy_ratio_unclear: '❓ Solo guy — ratio unclear',
    night_type_unknown: '❓ Night type unknown for ratio check',
    '3_or_more_guys_no_guestlist': '🚫 3+ guys guestlist not allowed',
    unknown_group_composition: '❓ Group composition unknown',
  };

  if (!reason) return 'Unknown';

  // Handle dynamic reasons like "other_venue_mentioned:maddox"
  if (reason.startsWith('other_venue_mentioned:')) {
    const venue = reason.split(':')[1];
    return `🏢 Other venue mentioned: ${venue}`;
  }

  return map[reason] || reason;
}

function _describeGroup(state) {
  if (state.guys !== null && state.girls !== null) {
    return `${state.guys} guys + ${state.girls} girls`;
  }
  if (state.group_size !== null) return `${state.group_size} people`;
  if (state.gender_mix === 'girls') return 'Girls group';
  return 'Unknown';
}

function _getSanadOptions(state) {
  const options = [];

  if (state.lead_type === 'guestlist') {
    options.push({ label: '✅ Approve guestlist', value: SANAD_DECISIONS.APPROVE_GUESTLIST });
    options.push({ label: '🍾 Push table instead', value: SANAD_DECISIONS.PUSH_TABLE });
    options.push({ label: '❌ Reject', value: SANAD_DECISIONS.REJECT });
  } else if (state.lead_type === 'table') {
    options.push({ label: '✅ Confirm table', value: SANAD_DECISIONS.APPROVE_GUESTLIST });
    options.push({ label: '💬 Custom reply', value: SANAD_DECISIONS.CUSTOM });
  } else {
    options.push({ label: '💬 Handle manually', value: SANAD_DECISIONS.CUSTOM });
  }

  return options;
}

module.exports = {
  buildHandoffAlert,
  getHoldingMessage,
  resumeAfterHandoff,
  SANAD_DECISIONS,
};

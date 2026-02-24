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
  const baseUrl = 'https://vip-concierge-production.up.railway.app';
  const sid = state.subscriberId;

  // Build conversation history HTML
  const historyHtml = (state.conversation_history || []).map(msg => {
    const isBot = msg.role === 'assistant';
    const bg = isBot ? '#f0f0f0' : '#DCF8C6';
    const align = isBot ? 'left' : 'right';
    return `<div style="text-align:${align};margin:4px 0;">
      <span style="background:${bg};padding:6px 10px;border-radius:8px;display:inline-block;max-width:80%;font-size:13px;">
        <strong>${isBot ? '🤖 Bot' : '👤 Customer'}:</strong> ${msg.content}
      </span>
    </div>`;
  }).join('');

  const summaryLines = [
    `🚨 HANDOFF REQUIRED`,
    `Reason: ${formatHandoffReason(state.handoff_reason)}`,
    ``,
    `Lead Summary:`,
    `• Type: ${state.lead_type}`,
    `• Group: ${_describeGroup(state)}`,
    `• Night: ${state.night_type || 'not specified'}`,
    `• Turn count: ${state.turn_count}`,
  ];

  if (state.collected_names.length > 0) {
    summaryLines.push(`• Names: ${state.collected_names.join(', ')}`);
  }

  // Build email HTML with all buttons + conversation history
  const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;">
  <h2 style="color:#FF4444;">🚨 HANDOFF REQUIRED</h2>
  <p><strong>Reason:</strong> ${formatHandoffReason(state.handoff_reason)}</p>
  <hr>
  <h3>Lead Summary</h3>
  <p>• <strong>Type:</strong> ${state.lead_type}</p>
  <p>• <strong>Group:</strong> ${_describeGroup(state)}</p>
  <p>• <strong>Night:</strong> ${state.night_type || 'not specified'}</p>
  <p>• <strong>Subscriber ID:</strong> ${sid}</p>
  ${state.collected_names.length > 0 ? `<p>• <strong>Names:</strong> ${state.collected_names.join(', ')}</p>` : ''}
  <hr>
  <h3>Conversation History</h3>
  <div style="border:1px solid #ddd;padding:10px;border-radius:8px;max-height:300px;overflow-y:auto;">
    ${historyHtml || '<p style="color:#888;">No history recorded yet</p>'}
  </div>
  <hr>
  <h3>Your Decision</h3>
  <div style="margin:20px 0;">
    <a href="${baseUrl}/resume?subscriberId=${sid}&decision=approve_guestlist"
       style="background:#25D366;color:white;padding:10px 16px;text-decoration:none;border-radius:5px;margin:4px;display:inline-block;">
      ✅ Approve Guestlist
    </a>
    <a href="${baseUrl}/resume?subscriberId=${sid}&decision=push_table"
       style="background:#FFD700;color:black;padding:10px 16px;text-decoration:none;border-radius:5px;margin:4px;display:inline-block;">
      🍾 Push Table
    </a>
    <a href="${baseUrl}/resume?subscriberId=${sid}&decision=reject"
       style="background:#FF4444;color:white;padding:10px 16px;text-decoration:none;border-radius:5px;margin:4px;display:inline-block;">
      ❌ Reject
    </a>
    <a href="${baseUrl}/resume?subscriberId=${sid}&decision=resume_ai"
       style="background:#007AFF;color:white;padding:10px 16px;text-decoration:none;border-radius:5px;margin:4px;display:inline-block;">
      🤖 Resume AI
    </a>
    <a href="${baseUrl}/override?subscriberId=${sid}"
       style="background:#FF9500;color:white;padding:10px 16px;text-decoration:none;border-radius:5px;margin:4px;display:inline-block;">
      👤 Manual Override
    </a>
  </div>
</div>`;

  return {
    type: 'HANDOFF_ALERT',
    priority: 'high',
    subscriberId: sid,
    summary: summaryLines.join('\n'),
    email_html: emailHtml,
    handoff_reason: state.handoff_reason,
    state_snapshot: state,
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
  MANUAL_OVERRIDE: 'manual_override',
  RESUME_AI: 'resume_ai',
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

    case SANAD_DECISIONS.MANUAL_OVERRIDE:
      // Sanad takes over — keep AI paused, no reply sent
      resumeData = { status: 'handoff', paused: true, handoff_reason: 'manual_override' };
      nextAction = 'manual_override';
      break;

    case SANAD_DECISIONS.RESUME_AI:
      // Resume AI without Sanad doing anything
      resumeData = { status: 'qualifying', paused: false };
      nextAction = 'rapport';
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

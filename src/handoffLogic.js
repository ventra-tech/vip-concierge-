/**
 * handoffLogic.js
 * Manages the handoff process — alerting Sanad and pausing the AI.
 * Also handles resuming the AI after Sanad has made a decision.
 */

const { resumeSession } = require('./sessionStore');
const { calculateBookingValue } = require('./policy/reign');

// ─── HANDOFF ACTION BUILDER ───────────────────────────────────────────────────

/**
 * Build the HANDOFF_ALERT action payload sent back to n8n / the caller.
 * n8n will use this to send a WhatsApp alert to Sanad.
 *
 * @param {import('./state').ConversationState} state
 * @returns {object} Action payload
 */
function buildHandoffAlert(state) {
  const baseUrl = 'https://vip-concierge-production-cc26.up.railway.app';
  const sid = state.subscriberId;
  const displayName = state.username
    ? `@${state.username}`
    : state.first_name || `ID: ${sid}`;

  // Build conversation history HTML — full thread, scrollable in email
  const allHistory = state.conversation_history || [];
  const totalMessages = allHistory.length;

  const historyHtml = allHistory.map(msg => {
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

  // Estimated value label
  const estValue = calculateBookingValue(state).label;

  const isTableReady = state.handoff_reason === 'table_booking_ready';

  // Phone number tile — shown for table bookings where it's been collected
  const phoneRowHtml = state.phone_number ? `
      <tr>
        <td colspan="2" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">📱 Phone Number</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${state.phone_number}</div>
        </td>
      </tr>` : '';

  // Action buttons — simpler set when all table details are already collected
  const actionButtonsHtml = isTableReady
    ? `<table style="width:100%;border-collapse:separate;border-spacing:6px;">
        <tr>
          <td style="width:50%;">
            <a href="${baseUrl}/resume?subscriberId=${sid}&decision=manual_override"
               style="display:block;background:#22c55e;color:white;padding:12px 10px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
              ✅ Confirm — I'll message them now
            </a>
          </td>
          <td style="width:50%;">
            <a href="${baseUrl}/resume?subscriberId=${sid}&decision=reject"
               style="display:block;background:#ef4444;color:white;padding:12px 10px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
              ❌ Reject
            </a>
          </td>
        </tr>
      </table>`
    : `<table style="width:100%;border-collapse:separate;border-spacing:6px;">
        <tr>
          <td style="width:50%;">
            <a href="${baseUrl}/resume?subscriberId=${sid}&decision=approve_guestlist"
               style="display:block;background:#22c55e;color:white;padding:12px 10px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
              ✅ Approve Guestlist
            </a>
          </td>
          <td style="width:50%;">
            <a href="${baseUrl}/resume?subscriberId=${sid}&decision=push_table"
               style="display:block;background:#a855f7;color:white;padding:12px 10px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
              🍾 Push to Table
            </a>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <a href="${baseUrl}/resume?subscriberId=${sid}&decision=reject"
               style="display:block;background:#ef4444;color:white;padding:12px 10px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
              ❌ Reject
            </a>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <a href="${baseUrl}/override?subscriberId=${sid}"
               style="display:block;background:#f59e0b;color:white;padding:12px 10px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
              👤 Manual Override — I'll Handle This
            </a>
          </td>
        </tr>
      </table>`;

  // Lead type badge colour
  const leadBadgeColor = state.lead_type === 'table' ? '#7C3AED' : '#0EA5E9';
  const leadLabel = state.lead_type === 'table' ? '🍾 Table' : state.lead_type === 'guestlist' ? '✅ Guestlist' : '❓ Unknown';
  const nightLabel = state.night_type === 'weekend' ? '🎉 Weekend' : state.night_type === 'weekday' ? '📅 Weekday' : '❓ Not specified';

  // Build email HTML with all buttons + conversation history
  const emailHtml = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;background:#f8f9fa;padding:0;">

  <!-- Header -->
  <div style="background:#1a1a2e;padding:24px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;color:#FF6B6B;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Action Required</p>
    <h2 style="margin:0;color:#ffffff;font-size:22px;">🚨 Handoff — ${displayName}</h2>
    <p style="margin:6px 0 0;color:#a0aec0;font-size:13px;">${formatHandoffReason(state.handoff_reason)}</p>
  </div>

  <!-- Summary Tiles -->
  <div style="background:#ffffff;padding:20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <table style="width:100%;border-collapse:separate;border-spacing:8px;">
      <tr>
        <!-- Customer -->
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;width:50%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">👤 Customer</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${displayName}</div>
        </td>
        <!-- Lead Type -->
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;width:50%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">📋 Lead Type</div>
          <div style="font-size:15px;font-weight:700;color:${leadBadgeColor};">${leadLabel}</div>
        </td>
      </tr>
      <tr>
        <!-- Group -->
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">👥 Group</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${_describeGroup(state)}</div>
        </td>
        <!-- Night -->
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">🌙 Night</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${nightLabel}</div>
        </td>
      </tr>
      <tr>
        <!-- Est. Value -->
        <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">💰 Est. Value</div>
          <div style="font-size:18px;font-weight:800;color:#15803d;">${estValue}</div>
        </td>
        <!-- Turn Count -->
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">💬 Messages</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${state.turn_count} turns</div>
        </td>
      </tr>
      ${state.collected_names.length > 0 ? `
      <tr>
        <td colspan="2" style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">📝 Names Collected</div>
          <div style="font-size:14px;font-weight:600;color:#1e293b;">${state.collected_names.join(' · ')}</div>
        </td>
      </tr>` : ''}
      ${phoneRowHtml}
    </table>
  </div>

  <!-- Conversation History -->
  <div style="background:#ffffff;padding:20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:1px solid #e2e8f0;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">
      💬 Conversation ${totalMessages > 0 ? `<span style="font-weight:400;color:#9ca3af;">(${totalMessages} messages)</span>` : ''}
    </p>
  <div style="border:1px solid #e2e8f0;padding:12px;border-radius:10px;max-height:300px;overflow-y:auto;background:#fafafa;">
    ${historyHtml || '<p style="color:#9ca3af;font-size:13px;text-align:center;margin:20px 0;">No messages recorded yet</p>'}
  </div>
  </div>

  <!-- Action Buttons -->
  <div style="background:#1a1a2e;padding:20px;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;color:#a0aec0;text-transform:uppercase;letter-spacing:1px;">Your Decision</p>
    ${actionButtonsHtml}
    <p style="margin:14px 0 0;font-size:11px;color:#4a5568;text-align:center;">Reign Concierge Brain · ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}</p>
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

// ─── CONFIRMATION EMAIL BUILDER ───────────────────────────────────────────────

/**
 * Build a confirmation email to notify Sanad when a booking is fully confirmed.
 * No action buttons — this is a pure notification.
 * @param {import('./state').ConversationState} state
 * @returns {object} Action payload
 */
function buildConfirmationEmail(state) {
  const displayName = state.username
    ? `@${state.username}`
    : state.first_name || `ID: ${state.subscriberId}`;

  const leadLabel = state.lead_type === 'table' ? '🍾 Table Booking' : '✅ Guestlist Booking';
  const leadBadgeColor = state.lead_type === 'table' ? '#7C3AED' : '#16a34a';
  const nightLabel = state.night_type === 'weekend' ? '🎉 Weekend'
    : state.night_type === 'weekday' ? '📅 Weekday'
    : state.night_type || '❓ Not specified';

  // Pair names with their instagrams where possible
  const namesListHtml = state.collected_names.length > 0
    ? state.collected_names.map((name, i) => {
        const ig = state.collected_instagrams[i] ? ` <span style="color:#6366f1;font-weight:500;">${state.collected_instagrams[i]}</span>` : '';
        return `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b;">
          📝 <strong>${name}</strong>${ig}
        </div>`;
      }).join('')
    : '<div style="color:#9ca3af;font-size:13px;">No names collected</div>';

  // Extra instagram handles beyond the paired ones
  const extraHandles = state.collected_instagrams.slice(state.collected_names.length);
  const extraHandlesHtml = extraHandles.length > 0
    ? `<div style="margin-top:8px;font-size:13px;color:#6366f1;">${extraHandles.join(' · ')}</div>`
    : '';

  // Conversation history (same style as handoff email)
  const allHistory = state.conversation_history || [];
  const totalMessages = allHistory.length;
  const historyHtml = allHistory.map(msg => {
    const isBot = msg.role === 'assistant';
    const bg = isBot ? '#f0f0f0' : '#DCF8C6';
    const align = isBot ? 'left' : 'right';
    return `<div style="text-align:${align};margin:4px 0;">
      <span style="background:${bg};padding:6px 10px;border-radius:8px;display:inline-block;max-width:80%;font-size:13px;">
        <strong>${isBot ? '🤖 Bot' : '👤 Customer'}:</strong> ${msg.content}
      </span>
    </div>`;
  }).join('');

  const bookingValue = calculateBookingValue(state);
  const valueLabel = bookingValue.max
    ? `${bookingValue.label} min spend`
    : state.lead_type === 'guestlist'
      ? `${bookingValue.label} entry`
      : bookingValue.label;

  const phoneHtml = state.phone_number
    ? `<tr><td colspan="2" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;vertical-align:top;">
        <div style="font-size:11px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">📱 Phone Number</div>
        <div style="font-size:15px;font-weight:700;color:#1e293b;">${state.phone_number}</div>
      </td></tr>`
    : '';

  const emailHtml = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;background:#f8f9fa;padding:0;">

  <!-- Header -->
  <div style="background:#15803d;padding:24px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;color:#bbf7d0;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">New Booking</p>
    <h2 style="margin:0;color:#ffffff;font-size:22px;">✅ Confirmed — ${displayName}</h2>
    <p style="margin:6px 0 0;color:#dcfce7;font-size:13px;">${leadLabel} · ${nightLabel}</p>
  </div>

  <!-- Summary Tiles -->
  <div style="background:#ffffff;padding:20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <table style="width:100%;border-collapse:separate;border-spacing:8px;">
      <tr>
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;width:50%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">👤 Customer</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${displayName}</div>
        </td>
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;width:50%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">📋 Type</div>
          <div style="font-size:15px;font-weight:700;color:${leadBadgeColor};">${leadLabel}</div>
        </td>
      </tr>
      <tr>
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">👥 Group</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${_describeGroup(state)}</div>
        </td>
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">🌙 Night</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${nightLabel}</div>
        </td>
      </tr>
      <tr>
        <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">💰 Booking Value</div>
          <div style="font-size:18px;font-weight:800;color:#15803d;">${valueLabel}</div>
        </td>
        <td style="background:#f1f5f9;border-radius:10px;padding:12px 14px;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">💬 Messages</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${state.turn_count} turns</div>
        </td>
      </tr>
      ${phoneHtml}
    </table>
  </div>

  <!-- Names & Instagrams -->
  <div style="background:#ffffff;padding:20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:1px solid #e2e8f0;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">
      📝 Names & Instagrams <span style="font-weight:400;color:#9ca3af;">(${state.collected_names.length} people)</span>
    </p>
    <div style="border:1px solid #e2e8f0;padding:12px;border-radius:10px;background:#fafafa;">
      ${namesListHtml}
      ${extraHandlesHtml}
    </div>
  </div>

  <!-- Conversation History -->
  <div style="background:#ffffff;padding:20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:1px solid #e2e8f0;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">
      💬 Conversation ${totalMessages > 0 ? `<span style="font-weight:400;color:#9ca3af;">(${totalMessages} messages)</span>` : ''}
    </p>
    <div style="border:1px solid #e2e8f0;padding:12px;border-radius:10px;max-height:300px;overflow-y:auto;background:#fafafa;">
      ${historyHtml || '<p style="color:#9ca3af;font-size:13px;text-align:center;margin:20px 0;">No messages recorded yet</p>'}
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#1a1a2e;padding:16px 20px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#4a5568;">Reign Concierge Brain · ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}</p>
  </div>

</div>`;

  return {
    type: 'BOOKING_CONFIRMED',
    subscriberId: state.subscriberId,
    email_html: emailHtml,
    lead_type: state.lead_type,
    state_snapshot: state,
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
    return "Got it ❤️‍🔥 I've listened to your voice note, I'll reply properly shortly 👀";
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
  if (reason === 'male_guestlist_redirect') {
    return "Let me check with the owner and I'll get back to you shortly 👀";
  }
  if (reason.includes('large_table') || reason.includes('pre_dinner')) {
    return "Love that 🍾 Let me put something together for you, I'll be back shortly";
  }
  if (reason === 'table_booking_ready') {
    const isMale = state.detected_gender === 'male';
    const isFemale = state.detected_gender === 'female';
    if (isMale) return "Hang tight bro, let me finalise and get you sorted 🍾";
    if (isFemale) return "Hang tight darling, let me finalise and get you sorted 🥂 x";
    return "Hang tight, let me finalise and get you sorted 🍾";
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
    male_guestlist_redirect: '👤 Male/mixed group redirected from guestlist — Sanad to decide',
    pre_dinner_mentioned: '🍽️ Pre-dinner mentioned',
    ratio_unclear: '❓ Guy ratio unclear',
    ratio_insufficient_weekend: '❌ Ratio not met (weekend)',
    ratio_insufficient_weekday: '❌ Ratio not met (weekday)',
    solo_guy_ratio_unclear: '❓ Solo guy — ratio unclear',
    night_type_unknown: '❓ Night type unknown for ratio check',
    '3_or_more_guys_no_guestlist': '🚫 3+ guys guestlist not allowed',
    unknown_group_composition: '❓ Group composition unknown',
    table_booking_ready: '🍾 Table booking ready — all details collected',
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
  buildConfirmationEmail,
  getHoldingMessage,
  resumeAfterHandoff,
  SANAD_DECISIONS,
};

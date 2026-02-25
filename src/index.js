/**
 * index.js
 * Main entry point. Exports processMessage() — the single function n8n calls.
 */

const { parseIncomingPayload } = require('./adapters/manyChat');
const { getSession, saveSession } = require('./sessionStore');
const { detectGender } = require('./genderDetector');
const { classifyMessage } = require('./router');
const { decideNextAction } = require('./bookingLogic');
const { buildHandoffAlert, getHoldingMessage } = require('./handoffLogic');
const { composeReply } = require('./persona/toneComposer');
const { logEvent, logHandoff, logConfirmation, logMessageReceived } = require('./analytics/logger');
const { updateState } = require('./state');

// Holding messages when AI is paused — cycles sequentially, never repeats back to back
const HOLDING_MESSAGES = [
  "Bear with me one sec 👀",
  "Still sorting this for you 🙏",
  "Give me a moment ❤️‍🔥",
  "On it — back with you shortly 👀",
  "Just checking on this for you 😏",
  "Won't be long 🥂",
];

function _getHoldingWhilePaused(state) {
  const lastIndex = state.last_holding_index ?? -1;
  const nextIndex = (lastIndex + 1) % HOLDING_MESSAGES.length;
  return { message: HOLDING_MESSAGES[nextIndex], nextIndex };
}

/**
 * Add a message to conversation history (max 20 messages).
 */
function _addToHistory(state, role, content) {
  const history = [...(state.conversation_history || [])];
  history.push({ role, content, timestamp: new Date().toISOString() });
  // Keep last 20 messages only
  if (history.length > 20) history.shift();
  return history;
}

/**
 * Process a single incoming ManyChat message end-to-end.
 */
async function processMessage(manyChatBody) {
  // ── 1. Parse payload ──
  const { subscriberId, messageText, messageType, firstName, username } =
    parseIncomingPayload(manyChatBody);

  // ── 2. Load session ──
  let state = getSession(subscriberId);

  // ── 3. Save user message to history ──
  const history = _addToHistory(state, 'user', messageText || `[${messageType}]`);
  state = { ...state, conversation_history: history };

  // ── 4. Detect gender ──
  const detectedGender = detectGender({
    messageText,
    username,
    firstName,
    existingGender: state.detected_gender,
  });
  state = updateState(state, {
    detected_gender: detectedGender,
    username: username || state.username || null,
    first_name: firstName || state.first_name || null,
  });
  state = { ...state, turn_count: state.turn_count - 1 };

  // ── 5. If session is paused (handoff active) — send holding message ──
  if (state.paused) {
    const { message: holdingReply, nextIndex } = _getHoldingWhilePaused(state);
    // Save updated history and holding index so it never repeats
    const updatedHistory = _addToHistory(state, 'assistant', holdingReply);
    state = { ...state, conversation_history: updatedHistory, last_holding_index: nextIndex };
    saveSession(subscriberId, state);
    const analyticsEvent = logEvent('message_while_paused', state);
    return {
      reply_text: holdingReply,
      updated_state: state,
      actions: [{ type: 'PAUSED_HOLDING_REPLY', subscriberId }],
      analytics_event: analyticsEvent,
    };
  }

  // ── 6. Classify message ──
  const routerOutput = await classifyMessage(manyChatBody, messageText);

  // ── DEBUG LOGGING ──
  console.log('=== DEBUG ===');
  console.log('MSG:', JSON.stringify(messageText));
  console.log('EXTRACTED names:', routerOutput.names, '| instagrams:', routerOutput.instagrams, '| groupSize:', routerOutput.groupSize, '| nightType:', routerOutput.nightType);
  console.log('STATE BEFORE: lead_type:', state.lead_type, '| gender_mix:', state.gender_mix, '| girls:', state.girls, '| night_type:', state.night_type, '| collected_names:', state.collected_names, '| collected_instagrams:', state.collected_instagrams);

  // ── 7. Decide next action ──
  const { action, updatedState, missingField, tableMinimum, eligibilityResult } =
    decideNextAction(state, routerOutput);

  state = updatedState;

  console.log('ACTION:', action, '| missingField:', missingField);
  console.log('STATE AFTER: gender_mix:', state.gender_mix, '| girls:', state.girls, '| night_type:', state.night_type, '| collected_names:', state.collected_names, '| collected_instagrams:', state.collected_instagrams);
  console.log('=============');

  // ── 8. Log message received ──
  logMessageReceived(state, routerOutput.intent);

  // ── 9. Handle handoff ──
  const actions = [];
  let replyText;

  if (action === 'handoff') {
    const handoffAlert = buildHandoffAlert(state);
    actions.push(handoffAlert);
    replyText = getHoldingMessage(state);
    // Save bot reply to history
    const updatedHistory = _addToHistory(state, 'assistant', replyText);
    state = { ...state, conversation_history: updatedHistory };
    saveSession(subscriberId, state);
    const analyticsEvent = logHandoff(state);
    return { reply_text: replyText, updated_state: state, actions, analytics_event: analyticsEvent };
  }

  // ── 10. Compose reply ──
  replyText = await composeReply({
    action,
    state,
    missingField,
    tableMinimum,
    eligibilityResult,
    rawUserMessage: messageText,
  });

  // ── 11. Save bot reply to history ──
  const updatedHistory = _addToHistory(state, 'assistant', replyText);
  state = { ...state, conversation_history: updatedHistory };

  // ── 12. Log confirmation if applicable ──
  let analyticsEvent;
  if (action === 'confirm') {
    analyticsEvent = logConfirmation(state);
  } else {
    analyticsEvent = logEvent('message_processed', state, { action });
  }

  // ── 13. Save session ──
  saveSession(subscriberId, state);

  return {
    reply_text: replyText,
    updated_state: state,
    actions,
    analytics_event: analyticsEvent,
  };
}

/**
 * Resume the AI after Sanad completes a handoff.
 */
async function resumeFromHandoff(resumeBody) {
  const { resumeAfterHandoff } = require('./handoffLogic');
  const { subscriberId, decision, extra = {} } = resumeBody;

  const { resumedState, nextAction } = resumeAfterHandoff(subscriberId, decision, extra);

  // Manual override — don't send any message, Sanad handles it
  if (decision === 'manual_override') {
    saveSession(subscriberId, resumedState);
    logEvent('manual_override_activated', resumedState, { decision });
    return { reply_text: null, updated_state: resumedState };
  }

  // For resume_ai, don't restart with rapport — pick up from where conversation was
  let resolvedAction = nextAction;
  let resolvedMissingField = null;
  if (decision === 'resume_ai') {
    const { getNextMissingField } = require('./bookingLogic');
    resolvedMissingField = getNextMissingField(resumedState);
    if (resolvedMissingField) {
      resolvedAction = 'ask_question';
    } else if (resumedState.lead_type !== 'unknown') {
      resolvedAction = 'rapport'; // All info collected, just re-engage warmly
    }
  }

  const replyText = await composeReply({
    action: resolvedAction,
    state: resumedState,
    missingField: resolvedMissingField,
    tableMinimum: null,
    eligibilityResult: null,
    rawUserMessage: '',
  });

  // Save resume reply to history
  const updatedHistory = _addToHistory(resumedState, 'assistant', replyText || '');
  const finalState = { ...resumedState, conversation_history: updatedHistory };

  saveSession(subscriberId, finalState);
  logEvent('handoff_resumed', finalState, { decision });

  return { reply_text: replyText, updated_state: finalState };
}

module.exports = { processMessage, resumeFromHandoff };

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

// Holding messages when AI is paused — rotates so it doesn't feel robotic
const HOLDING_MESSAGES = [
  "Bear with me one sec 👀",
  "Still sorting this for you 🙏",
  "Give me a moment ❤️‍🔥",
  "On it — back with you shortly 👀",
];

function _getHoldingWhilePaused() {
  return HOLDING_MESSAGES[Math.floor(Math.random() * HOLDING_MESSAGES.length)];
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
  state = updateState(state, { detected_gender: detectedGender });
  state = { ...state, turn_count: state.turn_count - 1 };

  // ── 5. If session is paused (handoff active) — send holding message ──
  if (state.paused) {
    const holdingReply = _getHoldingWhilePaused();
    // Save updated history
    const updatedHistory = _addToHistory(state, 'assistant', holdingReply);
    state = { ...state, conversation_history: updatedHistory };
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

  // ── 7. Decide next action ──
  const { action, updatedState, missingField, tableMinimum, eligibilityResult } =
    decideNextAction(state, routerOutput);

  state = updatedState;

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

  const replyText = await composeReply({
    action: nextAction,
    state: resumedState,
    missingField: null,
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

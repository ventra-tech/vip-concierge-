/**
 * index.js
 * Main entry point. Exports processMessage() — the single function n8n calls.
 */

const { parseIncomingPayload } = require('./adapters/manyChat');
const { getSession, saveSession } = require('./sessionStore');
const { detectGender } = require('./genderDetector');
const { classifyMessage } = require('./router');
const { decideNextAction } = require('./bookingLogic');
const { buildHandoffAlert, buildConfirmationEmail, getHoldingMessage } = require('./handoffLogic');
const { composeReply } = require('./persona/toneComposer');
const { logEvent, logHandoff, logConfirmation, logMessageReceived } = require('./analytics/logger');

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

// Per-subscriber concurrency lock.
// Prevents two concurrent ManyChat webhook fires for the same subscriber
// from both processing simultaneously and overwriting each other's state.
const activeRequests = new Set();

/**
 * Process a single incoming ManyChat message end-to-end.
 */
async function processMessage(manyChatBody) {
  // ── 1. Parse payload ──
  const { subscriberId, messageText, messageType, firstName, username } =
    parseIncomingPayload(manyChatBody);

  // ── 2. Concurrency lock — drop duplicate concurrent requests per subscriber ──
  // ManyChat sometimes fires the same trigger twice in rapid succession.
  // Without this lock, both requests read the same state → both write back → one overwrites the other.
  if (activeRequests.has(subscriberId)) {
    return { reply_text: null, actions: [] };
  }
  activeRequests.add(subscriberId);

  try {
    // ── 3. Load session ──
    let state = getSession(subscriberId);

    // ── 4. Dedup guard — skip identical messages re-fired within 5 seconds ──
    // Catches ManyChat trigger re-fires that send the same message text again.
    const now = Date.now();
    const DEDUP_WINDOW_MS = 5000;
    if (
      messageText &&
      state.last_message_text === messageText &&
      state.last_message_at &&
      now - state.last_message_at < DEDUP_WINDOW_MS
    ) {
      return { reply_text: null, actions: [] };
    }
    // Stamp this message on state so the next request can dedup against it
    state = { ...state, last_message_text: messageText || null, last_message_at: now };

    // ── 5. Save user message to history ──
    const history = _addToHistory(state, 'user', messageText || `[${messageType}]`);
    state = { ...state, conversation_history: history };

    // ── 6. Detect gender — direct spread, no turn_count bump ──
    const detectedGender = detectGender({
      messageText,
      username,
      firstName,
      existingGender: state.detected_gender,
    });
    state = {
      ...state,
      detected_gender: detectedGender,
      username: username || state.username || null,
      first_name: firstName || state.first_name || null,
    };

    // ── 7. If session is paused (handoff active) — send holding message ──
    if (state.paused) {
      const { message: holdingReply, nextIndex } = _getHoldingWhilePaused(state);
      // Save updated history and holding index so it never repeats
      const updatedHistory = _addToHistory(state, 'assistant', holdingReply);
      state = { ...state, conversation_history: updatedHistory, last_holding_index: nextIndex };
      saveSession(subscriberId, state);
      logEvent('message_while_paused', state);
      return {
        reply_text: holdingReply,
        actions: [{ type: 'PAUSED_HOLDING_REPLY', subscriberId }],
      };
    }

    // ── 8. Classify message ──
    const routerOutput = await classifyMessage(manyChatBody, messageText);

    // ── 9. Decide next action ──
    const { action, updatedState, missingField, tableMinimum, eligibilityResult } =
      decideNextAction(state, routerOutput);

    state = updatedState;

    // ── 10. Log message received ──
    logMessageReceived(state, routerOutput.intent);

    // ── 11. Handle handoff ──
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
      logHandoff(state);
      return { reply_text: replyText, actions };
    }

    // ── 12. Compose reply ──
    replyText = await composeReply({
      action,
      state,
      missingField,
      tableMinimum,
      eligibilityResult,
      rawUserMessage: messageText,
    });

    // ── 13. Save bot reply to history ──
    const updatedHistory = _addToHistory(state, 'assistant', replyText);
    state = { ...state, conversation_history: updatedHistory };

    // ── 14. Log confirmation + send Sanad notification email ──
    if (action === 'confirm') {
      logConfirmation(state);
      // Push confirmation email action so n8n sends Sanad a booking notification
      actions.push(buildConfirmationEmail(state));
    } else {
      logEvent('message_processed', state, { action });
    }

    // ── 15. Save session ──
    saveSession(subscriberId, state);

    return {
      reply_text: replyText,
      actions,
    };

  } finally {
    // Always release the lock — even if an error is thrown
    activeRequests.delete(subscriberId);
  }
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

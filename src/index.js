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
const { buildSheetsLog } = require('./analytics/sheets');
const { createState } = require('./state');

// Holding messages when AI is paused — cycles sequentially, never repeats back to back
const HOLDING_MESSAGES = [
  "Bear with me one sec 👀",
  "Still sorting this for you 🙏",
  "Give me a moment ❤️‍🔥",
  "On it, back with you shortly 👀",
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

// ── Message debounce ─────────────────────────────────────────────────────────
// Collects back-to-back messages from the same subscriber before processing.
// Handles the common pattern where customers send names/details in 2 separate
// messages (e.g. "Her: Violette Crombez" then "Me: Violette Fages").
// Window: 2 seconds. Non-text messages (images, voice) are always processed immediately.
const messageBuffers = new Map();
const DEBOUNCE_MS = 2000;

function _debounce(subscriberId, text, processFn) {
  return new Promise((resolve) => {
    const existing = messageBuffers.get(subscriberId);

    if (existing) {
      // Another message is pending — cancel its timer and resolve it with no-reply.
      // Accumulate this message into the buffer.
      clearTimeout(existing.timer);
      existing.resolve({ reply_text: null, actions: [] });
      existing.messages.push(text);
      existing.resolve = resolve;
    } else {
      // First message for this subscriber — start buffer
      messageBuffers.set(subscriberId, { messages: [text], timer: null, resolve });
    }

    const entry = messageBuffers.get(subscriberId);

    // (Re)start the timer — fires after DEBOUNCE_MS of silence
    entry.timer = setTimeout(async () => {
      const combined = entry.messages.join('\n');
      messageBuffers.delete(subscriberId);
      try {
        resolve(await processFn(combined));
      } catch {
        resolve({ reply_text: null, actions: [] });
      }
    }, DEBOUNCE_MS);
  });
}

/**
 * Process a single incoming ManyChat message end-to-end.
 */
async function processMessage(manyChatBody) {
  const parsed = parseIncomingPayload(manyChatBody);
  const { subscriberId, messageText, messageType } = parsed;

  // Skip debounce for media messages — process them immediately
  if (!messageText || messageType !== 'text') {
    return _processMessage(manyChatBody, parsed, messageText);
  }

  // Debounce text messages — wait for back-to-back messages before processing
  return _debounce(subscriberId, messageText, (combinedText) =>
    _processMessage(manyChatBody, parsed, combinedText)
  );
}

/**
 * Internal: runs the full message pipeline with (possibly combined) text.
 */
async function _processMessage(manyChatBody, parsed, messageText) {
  // ── 1. Parse payload ──
  const { subscriberId, messageType, firstName, username } = parsed;

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

    // ── 3b. Returning customer — reset booking fields if previous booking was completed ──
    // Keeps personal info (gender, name, IG handle) but starts a fresh booking flow.
    // Sets returning_customer: true so the LLM can greet them warmly by name/context.
    if (state.status === 'confirmed' || state.status === 'closed') {
      const previousBooking = {
        lead_type: state.lead_type,
        night_label: state.night_label || state.night_type,
        collected_names: state.collected_names,
      };
      state = {
        ...createState(subscriberId),
        detected_gender: state.detected_gender,
        username: state.username,
        first_name: state.first_name,
        conversation_history: state.conversation_history,
        returning_customer: true,
        previous_booking: previousBooking,
      };
    }

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

    // ── 7. Classify message (needed for paused logic and main flow) ──
    const routerOutput = await classifyMessage(manyChatBody, messageText);

    // ── 8. If session is paused (handoff active) ──
    // Smart pause: only block booking-changing messages — answer general questions normally.
    if (state.paused) {
      const intent = routerOutput.intent;

      // Booking-changing = trying to modify group size, night, or lead type while Sanad is handling it
      const isBookingChange = (
        ['table', 'guestlist'].includes(intent) ||
        routerOutput.groupSize !== null ||
        (routerOutput.nightType !== null && routerOutput.nightType !== state.night_type)
      );

      let replyText;
      if (isBookingChange) {
        // Sanad needs to handle this — send cycling holding message
        const { message: holdingReply, nextIndex } = _getHoldingWhilePaused(state);
        replyText = holdingReply;
        state = { ...state, last_holding_index: nextIndex };
      } else {
        // General question or chat — LLM can answer without affecting the booking
        const pausedAction = intent === 'question' ? 'answer_question'
          : intent === 'objection' ? 'objection'
          : 'rapport';
        replyText = await composeReply({
          action: pausedAction,
          state,
          missingField: null,
          tableMinimum: null,
          eligibilityResult: null,
          rawUserMessage: messageText,
        });
      }

      const updatedHistory = _addToHistory(state, 'assistant', replyText);
      state = { ...state, conversation_history: updatedHistory };
      saveSession(subscriberId, state);
      logEvent('message_while_paused', state, { intent, isBookingChange });
      return {
        reply_text: replyText,
        actions: isBookingChange ? [{ type: 'PAUSED_HOLDING_REPLY', subscriberId }] : [],
      };
    }

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
      // Log handoff to Google Sheets
      actions.push(buildSheetsLog('Handoff', state));
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
      // Log confirmed booking to Google Sheets
      actions.push(buildSheetsLog('Confirmed', state));
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
  const { subscriberId, extra = {} } = resumeBody;
  let { decision } = resumeBody;

  // Smart approve — route to guestlist, table, or other venue based on current state
  if (decision === 'approve') {
    const currentState = getSession(subscriberId);
    if (currentState.handoff_reason?.startsWith('other_venue_insists:')) {
      decision = 'approve_other_venue';
    } else if (currentState.lead_type === 'table') {
      decision = 'approve_table';
    } else {
      decision = 'approve_guestlist';
    }
  }

  const { resumedState, nextAction } = resumeAfterHandoff(subscriberId, decision, extra);
  const resumeActions = [];

  // Manual override — don't send any message, Sanad handles it
  if (decision === 'manual_override') {
    saveSession(subscriberId, resumedState);
    logEvent('manual_override_activated', resumedState, { decision });
    resumeActions.push(buildSheetsLog('Manual Override', resumedState));
    return { reply_text: null, updated_state: resumedState, actions: resumeActions };
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

  // Log the outcome to Google Sheets
  const sheetsOutcome =
    decision === 'approve_guestlist' || decision === 'approve_table' ? 'Confirmed (Approved)'
    : decision === 'reject'                                           ? 'Rejected'
    : decision === 'push_table'                                       ? 'Pushed to Table'
    : decision === 'resume_ai'                                        ? 'Resumed'
    : decision;
  resumeActions.push(buildSheetsLog(sheetsOutcome, finalState));

  return { reply_text: replyText, updated_state: finalState, actions: resumeActions };
}

module.exports = { processMessage, resumeFromHandoff };

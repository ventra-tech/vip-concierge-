/**
 * index.js
 * Main entry point. Exports processMessage() — the single function n8n calls.
 *
 * Flow:
 *   1. Parse ManyChat payload
 *   2. Load/create session state
 *   3. Detect gender
 *   4. Classify message (router)
 *   5. Decide action (bookingLogic)
 *   6. Compose reply (toneComposer)
 *   7. Handle handoff if needed
 *   8. Save updated state
 *   9. Log analytics
 *  10. Return { reply_text, updated_state, actions, analytics_event }
 */

const { parseIncomingPayload } = require('./adapters/manyChat');
const { getSession, saveSession } = require('./sessionStore');
const { detectGender, genderToTone } = require('./genderDetector');
const { classifyMessage } = require('./router');
const { decideNextAction } = require('./bookingLogic');
const { buildHandoffAlert, getHoldingMessage } = require('./handoffLogic');
const { composeReply } = require('./persona/toneComposer');
const { logEvent, logHandoff, logConfirmation, logMessageReceived } = require('./analytics/logger');
const { updateState } = require('./state');

/**
 * Process a single incoming ManyChat message end-to-end.
 *
 * @param {object} manyChatBody - Raw webhook body from ManyChat / n8n
 * @returns {Promise<{
 *   reply_text: string,
 *   updated_state: object,
 *   actions: object[],
 *   analytics_event: object
 * }>}
 */
async function processMessage(manyChatBody) {
  // ── 1. Parse payload ──
  const { subscriberId, messageText, messageType, firstName, username } =
    parseIncomingPayload(manyChatBody);

  // ── 2. Load session ──
  let state = getSession(subscriberId);

  // ── 3. Detect gender (update if not yet confident) ──
  const detectedGender = detectGender({
    messageText,
    username,
    firstName,
    existingGender: state.detected_gender,
  });
  state = updateState(state, { detected_gender: detectedGender });
  // Don't increment turn_count twice — reset the one added by updateState
  state = { ...state, turn_count: state.turn_count - 1 };

  // ── 4. If session is paused (handoff active) — hold ──
  if (state.paused) {
    saveSession(subscriberId, state);
    const analyticsEvent = logEvent('message_while_paused', state);
    return {
      reply_text: null, // n8n should NOT send a reply when paused
      updated_state: state,
      actions: [{ type: 'PAUSED_NO_REPLY', subscriberId }],
      analytics_event: analyticsEvent,
    };
  }

  // ── 5. Classify message ──
  const routerOutput = await classifyMessage(manyChatBody, messageText);

  // ── 6. Decide next action ──
  const { action, updatedState, missingField, tableMinimum, eligibilityResult } =
    decideNextAction(state, routerOutput);

  state = updatedState;

  // ── 7. Log message received ──
  logMessageReceived(state, routerOutput.intent);

  // ── 8. Handle handoff ──
  const actions = [];
  let replyText;

  if (action === 'handoff') {
    const handoffAlert = buildHandoffAlert(state);
    actions.push(handoffAlert);
    replyText = getHoldingMessage(state);
    saveSession(subscriberId, state);
    const analyticsEvent = logHandoff(state);
    return { reply_text: replyText, updated_state: state, actions, analytics_event: analyticsEvent };
  }

  // ── 9. Compose reply ──
  replyText = await composeReply({
    action,
    state,
    missingField,
    tableMinimum,
    eligibilityResult,
    rawUserMessage: messageText,
  });

  // ── 10. Log confirmation if applicable ──
  let analyticsEvent;
  if (action === 'confirm') {
    analyticsEvent = logConfirmation(state);
  } else {
    analyticsEvent = logEvent('message_processed', state, { action });
  }

  // ── 11. Save session ──
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
 * Call this from n8n when Sanad clicks a decision button.
 *
 * @param {object} resumeBody - { subscriberId, decision, extra? }
 * @returns {Promise<{ reply_text: string, updated_state: object }>}
 */
async function resumeFromHandoff(resumeBody) {
  const { resumeAfterHandoff } = require('./handoffLogic');
  const { subscriberId, decision, extra = {} } = resumeBody;

  const { resumedState, nextAction } = resumeAfterHandoff(subscriberId, decision, extra);

  const replyText = await composeReply({
    action: nextAction,
    state: resumedState,
    missingField: null,
    tableMinimum: null,
    eligibilityResult: null,
    rawUserMessage: '',
  });

  saveSession(subscriberId, resumedState);
  logEvent('handoff_resumed', resumedState, { decision });

  return { reply_text: replyText, updated_state: resumedState };
}

module.exports = { processMessage, resumeFromHandoff };

/**
 * bookingLogic.js
 * The deterministic brain of the booking system.
 * Takes the current state + classified message and decides the next action.
 *
 * Returns one of:
 *   ask_question    — need more info before deciding
 *   approve_guestlist — eligible, collect names
 *   push_table      — guestlist not available, offer table
 *   confirm         — all info collected, send confirmation
 *   handoff         — trigger Sanad alert
 *   objection       — handle a pushback
 *   rapport         — opening message, build connection first
 */

const {
  evaluateGuestlistEligibility,
  getTableMinimum,
  checkHandoffRequired,
} = require('./policy/reign');
const { updateState } = require('./state');

// ─── MISSING FIELD CHECKER ────────────────────────────────────────────────────

/**
 * Returns the next missing field to ask for, in priority order.
 * Returns null if we have everything needed.
 * @param {import('./state').ConversationState} state
 * @returns {string|null}
 */
function getNextMissingField(state) {
  if (state.lead_type === 'guestlist') {
    // Guestlist is always girls only — skip all group composition checks
    const girlsKnown = state.girls !== null || state.group_size !== null;
    if (!girlsKnown) return 'group_size';
    if (state.night_type === null) return 'night_type';
    if (state.collected_names.length === 0) return 'full_names';
    if (state.collected_instagrams.length === 0) return 'instagram_handles';
    return null;
  }

  if (state.lead_type === 'table') {
    if (state.group_size === null) return 'group_size';
    if (state.night_type === null) return 'night_type';
    if (state.collected_names.length === 0) return 'full_name_for_table';
    if (!state.phone_number) return 'phone_number';
    return null;
  }

  return 'lead_type';
}

// ─── STATE UPDATER FROM ROUTER OUTPUT ────────────────────────────────────────

/**
 * Merge router-extracted data into state.
 * @param {import('./state').ConversationState} state
 * @param {object} routerOutput
 * @param {string} intent
 * @returns {import('./state').ConversationState}
 */
function mergeRouterIntoState(state, routerOutput, intent) {
  const updates = {
    last_user_message_type: routerOutput.messageType,
    last_intent: intent,
  };

  // Update lead type if newly determined — also allow switching from guestlist to table
  // (user may start asking about guestlist then realise they want a table)
  if (intent === 'guestlist' && state.lead_type === 'unknown') updates.lead_type = 'guestlist';
  if (intent === 'table' && (state.lead_type === 'unknown' || state.lead_type === 'guestlist')) {
    updates.lead_type = 'table';
  }

  // If lead is guestlist and person is female — assume all girls group (guestlist is girls only)
  const mergedLeadType = updates.lead_type || state.lead_type;
  const currentGender = routerOutput.detectedGender || state.detected_gender;
  if (mergedLeadType === 'guestlist' && currentGender === 'female' && state.guys === null) {
    updates.guys = 0;
    updates.gender_mix = 'girls';
  }

  // Males always go straight to table — guestlist is girls only
  if (currentGender === 'male' && (state.lead_type === 'unknown' || state.lead_type === null)) {
    updates.lead_type = 'table';
  }

  // Update group numbers if extracted
  if (routerOutput.groupSize !== null) updates.group_size = routerOutput.groupSize;

  if (routerOutput.guys !== null) {
    updates.guys = routerOutput.guys;
    if (routerOutput.guys === 0) {
      updates.gender_mix = 'girls';
    } else if (routerOutput.girls > 0) {
      updates.gender_mix = 'mixed';
    } else {
      updates.gender_mix = 'guys';
    }
  }

  if (routerOutput.girls !== null) {
    updates.girls = routerOutput.girls;
    // If girls mentioned and no guys info anywhere → assume all girls
    if (routerOutput.guys === 0 || state.guys === 0) {
      updates.gender_mix = 'girls';
    } else if (routerOutput.guys === null && state.guys === null) {
      // Girls mentioned but no guys info — treat as girls only
      updates.guys = 0;
      updates.gender_mix = 'girls';
    }
  }

  if (routerOutput.nightType !== null) updates.night_type = routerOutput.nightType;

  // Collect names — append new ones, avoid duplicates
  if (routerOutput.names && routerOutput.names.length > 0) {
    const existing = state.collected_names || [];
    const merged = [...new Set([...existing, ...routerOutput.names])];
    updates.collected_names = merged;
  }

  // Collect Instagram handles — append new ones, avoid duplicates
  if (routerOutput.instagrams && routerOutput.instagrams.length > 0) {
    const existing = state.collected_instagrams || [];
    const merged = [...new Set([...existing, ...routerOutput.instagrams])];
    updates.collected_instagrams = merged;
  }

  // Capture phone number if provided
  if (routerOutput.phoneNumber && !state.phone_number) {
    updates.phone_number = routerOutput.phoneNumber;
  }

  // ── Post-processing: reconcile state ──
  const mergedGuys = updates.guys ?? state.guys;
  const mergedGirls = updates.girls ?? state.girls;
  const mergedGroupSize = updates.group_size ?? state.group_size;

  // If guys=0 and girls still null but group_size exists → girls = group_size
  if (mergedGuys === 0 && mergedGirls === null && mergedGroupSize !== null) {
    updates.girls = mergedGroupSize;
    updates.gender_mix = 'girls';
  }

  // If girls > 0 and guys=0 → confirm gender_mix = girls
  if (mergedGirls > 0 && mergedGuys === 0) {
    updates.gender_mix = 'girls';
  }

  // If we have both guys and girls, derive group_size if missing
  if (mergedGuys !== null && mergedGirls !== null && mergedGroupSize === null) {
    updates.group_size = mergedGuys + mergedGirls;
  }

  return updateState(state, updates);
}

// ─── MAIN DECISION ENGINE ─────────────────────────────────────────────────────

/**
 * Given the current state and router classification, decide the next action.
 *
 * @param {import('./state').ConversationState} state
 * @param {object} routerOutput - Output from classifyMessage()
 * @returns {{
 *   action: string,
 *   updatedState: import('./state').ConversationState,
 *   missingField: string|null,
 *   tableMinimum: object|null,
 *   eligibilityResult: object|null
 * }}
 */
function decideNextAction(state, routerOutput) {
  const intent = routerOutput.intent;

  // ── Step 1: Always check if handoff is needed first ──
  const handoffCheck = checkHandoffRequired({
    messageType: routerOutput.messageType,
    messageText: routerOutput.rawText,
    state,
  });

  if (handoffCheck.required) {
    const updatedState = updateState(state, {
      status: 'handoff',
      handoff_reason: handoffCheck.reason,
      paused: true,
      last_user_message_type: routerOutput.messageType,
    });
    return {
      action: 'handoff',
      updatedState,
      missingField: null,
      tableMinimum: null,
      eligibilityResult: null,
    };
  }

  // ── Step 2: Merge router data into state ──
  let updatedState = mergeRouterIntoState(state, routerOutput, intent);

  // ── Step 3: Handle venue FAQ questions — always answer regardless of lead type ──
  if (intent === 'question') {
    return {
      action: 'answer_question',
      updatedState,
      missingField: null,
      tableMinimum: null,
      eligibilityResult: null,
    };
  }

  // ── Step 4: Handle objections ──
  if (intent === 'objection') {
    return {
      action: 'objection',
      updatedState,
      missingField: null,
      tableMinimum: null,
      eligibilityResult: null,
    };
  }

  // ── Step 5: Handle birthday signal ──
  if (intent === 'birthday') {
    return {
      action: 'birthday_acknowledgement',
      updatedState,
      missingField: null,
      tableMinimum: null,
      eligibilityResult: null,
    };
  }

  // ── Step 6: First message / unknown — build rapport ──
  if (intent === 'unknown' && updatedState.turn_count <= 1) {
    return {
      action: 'rapport',
      updatedState,
      missingField: null,
      tableMinimum: null,
      eligibilityResult: null,
    };
  }

  // ── Step 6: Route by lead type ──

  if (updatedState.lead_type === 'guestlist') {
    return _handleGuestlistFlow(updatedState);
  }

  if (updatedState.lead_type === 'table') {
    return _handleTableFlow(updatedState);
  }

  // ── Step 7: Still don't know lead type — ask ──
  return {
    action: 'ask_question',
    updatedState,
    missingField: 'lead_type',
    tableMinimum: null,
    eligibilityResult: null,
  };
}

// ─── NIGHT TYPE ANTI-LOOP ─────────────────────────────────────────────────────
// If we've asked for night_type twice and still have no answer, default to weekend.
// Stops the bot repeating the same question forever when user isn't giving a specific day.

function _resolveNightType(state) {
  if (state.night_type !== null) return state; // already known
  if ((state.night_type_asks || 0) >= 1) {
    // Give up asking after 1 attempt — default to weekend
    return updateState(state, { night_type: 'weekend', night_type_asks: (state.night_type_asks || 0) + 1 });
  }
  return null; // still need to ask
}

// ─── GUESTLIST FLOW ───────────────────────────────────────────────────────────

function _handleGuestlistFlow(state) {
  // Guestlist is always girls only — force this in state
  let s = updateState(state, { guys: 0, gender_mix: 'girls' });

  // Anti-loop: if about to ask night_type again, default it
  if (getNextMissingField(s) === 'night_type') {
    const resolved = _resolveNightType(s);
    if (resolved) s = resolved;
    else s = updateState(s, { night_type_asks: (s.night_type_asks || 0) + 1 });
  }

  const missingField = getNextMissingField(s);
  if (missingField) {
    return { action: 'ask_question', updatedState: s, missingField, tableMinimum: null, eligibilityResult: null };
  }

  // All info collected — send confirmation
  const confirmed = updateState(s, { status: 'confirmed' });
  return { action: 'confirm', updatedState: confirmed, missingField: null, tableMinimum: null, eligibilityResult: { decision: 'approved', reason: 'girls_only' } };
}

// ─── TABLE FLOW ───────────────────────────────────────────────────────────────

function _handleTableFlow(state) {
  // Anti-loop: if about to ask night_type again, default it to weekend
  let s = state;
  if (s.night_type === null && getNextMissingField(s) === 'night_type') {
    const resolved = _resolveNightType(s);
    if (resolved) {
      s = resolved;
    } else {
      s = updateState(s, { night_type_asks: (s.night_type_asks || 0) + 1 });
    }
  }

  const missingField = getNextMissingField(s);

  if (s.group_size !== null) {
    // Large group — handoff
    if (s.group_size >= 5) {
      const updated = updateState(s, { status: 'handoff', handoff_reason: 'large_table_group', paused: true });
      return { action: 'handoff', updatedState: updated, missingField: null, tableMinimum: null, eligibilityResult: null };
    }
    const tableMin = getTableMinimum(s.group_size, s.night_type);

    if (missingField) {
      return { action: 'ask_question', updatedState: s, missingField, tableMinimum: tableMin, eligibilityResult: null };
    }

    const confirmed = updateState(s, { status: 'confirmed' });
    return { action: 'confirm', updatedState: confirmed, missingField: null, tableMinimum: tableMin, eligibilityResult: null };
  }

  return { action: 'ask_question', updatedState: s, missingField: 'group_size', tableMinimum: null, eligibilityResult: null };
}

module.exports = { decideNextAction, getNextMissingField, mergeRouterIntoState };

/**
 * templates/confirmations.js
 * Deterministic confirmation messages — no LLM involved.
 * All required venue info is always included.
 * Styled to match Sanad's exact messaging format from real conversations.
 */

const { REIGN } = require('../policy/reign');

// ─── NIGHT LABEL HELPER ───────────────────────────────────────────────────────

function _nightLabel(night_type) {
  if (night_type === 'weekend') return 'this weekend';
  if (night_type === 'weekday') return 'this weekday';
  return 'tonight';
}

// ─── GUESTLIST CONFIRMATION ───────────────────────────────────────────────────

/**
 * Full guestlist confirmation message.
 * Matches Sanad's exact plain-text format (no bullet points).
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function guestlistConfirmation(state) {
  const night = _nightLabel(state.night_type);
  return [
    `For - Reign ${night}`,
    `Address: ${REIGN.address}`,
    ``,
    `Entry: £${REIGN.entry_fee}`,
    `Please arrive by 23:00`,
    `Dress code: ${REIGN.dress_code_girls}`,
    `${REIGN.id_requirement}`,
    ``,
    `Text me when you arrive 📱`,
    ``,
    `At the door say "${REIGN.door_phrase}"`,
  ].join('\n');
}

// ─── TABLE CONFIRMATION ───────────────────────────────────────────────────────

/**
 * Table booking confirmation — sent after name + phone are collected.
 * Mirrors the guestlist confirmation format with table-specific details.
 * @param {import('../state').ConversationState} state
 * @param {{ min: number, label: string }} tableMinimum
 * @returns {string}
 */
function tableConfirmation(state, tableMinimum) {
  const night = _nightLabel(state.night_type);
  const minLabel = tableMinimum ? tableMinimum.label : 'TBC';
  return [
    `Sorted 🍾 I'll add you to the gc with the owner now`,
    ``,
    `For - Reign ${night}`,
    `Address: ${REIGN.address}`,
    ``,
    `Min spend: ${minLabel}`,
    `Please arrive by 23:00`,
    `Dress code: ${REIGN.dress_code_guys}`,
    `${REIGN.id_requirement}`,
    ``,
    `Text me when you arrive 📱`,
    ``,
    `At the door say "${REIGN.door_phrase}"`,
  ].join('\n');
}

// ─── APPROVAL AFTER HANDOFF ───────────────────────────────────────────────────

/**
 * Sent when Sanad approves via handoff email button.
 * If names already collected → send full confirmation.
 * If no names yet → ask for them first.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function guestlistApprovalAfterHandoff(state) {
  const isFemale = state.detected_gender === 'female';
  const isMale = state.detected_gender === 'male';
  const hasNames = state.collected_names && state.collected_names.length > 0;
  const night = _nightLabel(state.night_type);

  if (hasNames) {
    return [
      `All booked in all you x`,
      ``,
      `For - Reign ${night}`,
      `Address: ${REIGN.address}`,
      ``,
      `Entry: £${REIGN.entry_fee}`,
      `Please arrive by 23:00`,
      `Dress code: ${REIGN.dress_code_girls}`,
      `${REIGN.id_requirement}`,
      ``,
      `Text me when you arrive 📱`,
      ``,
      `At the door say "${REIGN.door_phrase}"`,
    ].join('\n');
  }

  if (isFemale) {
    return `You're all set ❤️‍🔥 What I will need is full names with instagrams and I'll book you girls on my guestlist for ${night} x`;
  }
  if (isMale) {
    return `Sorted bro ❤️‍🔥 Send me full names + Instagram @ and I'll lock you in`;
  }
  return `You're all set ❤️‍🔥 Send me full names + Instagram @ and I'll lock you in`;
}

// ─── PUSH TO TABLE AFTER HANDOFF ──────────────────────────────────────────────

/**
 * Sent when Sanad pushes group to table after handoff.
 * @param {{ min: number, label: string }} tableMinimum
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function pushTableAfterHandoff(tableMinimum, state) {
  const isFemale = state.detected_gender === 'female';
  const isMale = state.detected_gender === 'male';

  if (isMale) {
    return [
      `I can do a table for your group bro 🍾`,
      `Min spending ${tableMinimum.label}`,
      `Send me your full name and number and I'll get it sorted`,
    ].join('\n');
  }
  if (isFemale) {
    return [
      `I can sort you girls a table instead 🍾`,
      `Min spend ${tableMinimum.label} — your own section, bottles, full VIP`,
      `Send me your full name and number x`,
    ].join('\n');
  }
  return [
    `I can do a table — min spend ${tableMinimum.label} 🍾`,
    `Send me your full name and number and I'll get it booked`,
  ].join('\n');
}

// ─── REJECTION MESSAGE ────────────────────────────────────────────────────────

/**
 * Warm rejection — no "unfortunately", leaves door open.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function rejectionMessage(state) {
  const isFemale = state.detected_gender === 'female';
  const isMale = state.detected_gender === 'male';

  if (isFemale) {
    return `Sorry darling, can't accommodate your group this time 🙏\nHope to see you girls at Reign another night ❤️‍🔥`;
  }
  if (isMale) {
    return `No worries bro, can't do it this time 🙏\nHit me up another night`;
  }
  return `Sorry, can't accommodate your group this time 🙏\nHope to see you at Reign another night ❤️‍🔥`;
}

// ─── REVIEW REQUEST ───────────────────────────────────────────────────────────

/**
 * Post-event review ask. Emoji matches Sanad's real messages.
 * @param {'male'|'female'|'neutral'} gender
 * @returns {string}
 */
function reviewRequest(gender) {
  const isFemale = gender === 'female';
  return isFemale
    ? `Also leave a 5 star review for ${REIGN.instagram} mentioning my name and how your experience was fun 🥳`
    : `Also leave a 5 star review for ${REIGN.instagram} mentioning my name and how your experience was fun 🥳`;
}

// ─── HELPER ───────────────────────────────────────────────────────────────────

function _describeGroupNatural(state) {
  if (state.guys !== null && state.girls !== null) {
    if (state.guys === 0) return `${state.girls} girls`;
    if (state.girls === 0) return `${state.guys} guys`;
    return `${state.guys} guys + ${state.girls} girls`;
  }
  if (state.group_size) return `${state.group_size} people`;
  if (state.gender_mix === 'girls' && state.girls) return `${state.girls} girls`;
  return null;
}

module.exports = {
  guestlistConfirmation,
  tableConfirmation,
  guestlistApprovalAfterHandoff,
  pushTableAfterHandoff,
  rejectionMessage,
  reviewRequest,
};

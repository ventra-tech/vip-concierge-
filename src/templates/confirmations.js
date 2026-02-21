/**
 * templates/confirmations.js
 * Deterministic confirmation messages — no LLM involved.
 * All required venue info is always included.
 */

const { REIGN } = require('../policy/reign');

/**
 * Full guestlist confirmation message.
 * Sent after collecting name + Instagram.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function guestlistConfirmation(state) {
  const nightInfo = state.night_type ? ` for ${state.night_type === 'weekend' ? 'this weekend' : 'the weekday'}` : '';
  return [
    `You're all set${nightInfo} at Reign ❤️‍🔥`,
    `I've added you on my guestlist`,
    ``,
    `• Entry: £${REIGN.entry_fee}`,
    `• Arrival: by 11pm (ideal 11:00–11:30pm)`,
    `• Dress code: dress & heels (elegant wear) — no flats, trainers, or sportswear`,
    `• Physical ID is MANDATORY (picture of passport on phone works too)`,
    `• At the door say: "${REIGN.door_phrase}"`,
    `• Address: ${REIGN.address}`,
    ``,
    `Text me when you arrive 📲`,
    ``,
    `Also leave a 5 star review for ${REIGN.instagram} mentioning my name and how your experience was 😘`,
  ].join('\n');
}

/**
 * Table confirmation message.
 * Sent after collecting name and group details.
 * @param {import('../state').ConversationState} state
 * @param {{ min: number, label: string }} tableMinimum
 * @returns {string}
 */
function tableConfirmation(state, tableMinimum) {
  const name = state.collected_names[0] || 'your name';
  return [
    `Easy ❤️ I can do a table min spending ${tableMinimum.label}`,
    ``,
    `Send me your full name and I'll book you the table under your name`,
    `And send me your number — I'll add you to a group chat with the owner, he's a good friend of mine as well`,
  ].join('\n');
}

/**
 * Short approval message after Sanad approves a guys guestlist via handoff.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function guestlistApprovalAfterHandoff(state) {
  const isMale = state.detected_gender === 'male';
  return isMale
    ? `You're all set bro ❤️‍🔥 Send me your full names + Instagram @ and I'll lock you in`
    : `You're all set ❤️‍🔥 Send me your full names + Instagram @ and I'll lock you in`;
}

/**
 * Message when Sanad says push table after handoff.
 * @param {{ min: number, label: string }} tableMinimum
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function pushTableAfterHandoff(tableMinimum, state) {
  const isMale = state.detected_gender === 'male';
  return isMale
    ? `Actually bro, for the vibe you're going for I can sort you a proper table instead 🍾 Min ${tableMinimum.label} for ${state.guys || state.group_size} guys, you'll have your own space and bottles. What do you think?`
    : `I can sort you a proper table instead 🍾 Min ${tableMinimum.label}, you'll have your own space and bottles. What do you think?`;
}

/**
 * Message when Sanad rejects via handoff.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function rejectionMessage(state) {
  const isMale = state.detected_gender === 'male';
  return isMale
    ? `No worries bro, appreciate you reaching out 🤝 Hit me up if you change your mind`
    : `No worries, appreciate you reaching out 🤝 Hit me up if you change your mind`;
}

module.exports = {
  guestlistConfirmation,
  tableConfirmation,
  guestlistApprovalAfterHandoff,
  pushTableAfterHandoff,
  rejectionMessage,
};

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
 * Approval message after Sanad approves via handoff.
 * If names already collected → send full confirmation.
 * If names not yet collected → ask for them first.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function guestlistApprovalAfterHandoff(state) {
  const isFemale = state.detected_gender === 'female';
  const isMale = state.detected_gender === 'male';
  const hasNames = state.collected_names && state.collected_names.length > 0;
  const groupDesc = _describeGroupNatural(state);

  // Already have names — send the full confirmation straight away
  if (hasNames) {
    const names = state.collected_names.join(', ');
    const nightInfo = state.night_type === 'weekend' ? 'this weekend' : state.night_type === 'weekday' ? 'this weekday' : 'the night';
    return [
      isFemale
        ? `You girls are all set for ${nightInfo} ❤️‍🔥`
        : `You're all set for ${nightInfo} ❤️‍🔥`,
      `I've added ${names} on my guestlist`,
      ``,
      `• Entry: £${REIGN.entry_fee}`,
      `• Arrival: by 11pm (ideal 11:00–11:30pm)`,
      `• Dress code: dress & heels — no flats, trainers, or sportswear`,
      `• Physical ID is MANDATORY (passport photo on phone works)`,
      `• At the door say: "${REIGN.door_phrase}"`,
      `• Address: ${REIGN.address}`,
      ``,
      `Text me when you arrive 📲`,
    ].join('\n');
  }

  // No names yet — ask for them before sending full confirmation
  if (isFemale) {
    return `You${groupDesc ? ` (${groupDesc})` : ''} are all set ❤️‍🔥 Just send me your full names + Instagram @ and I'll get you locked in on my guestlist`;
  }
  if (isMale) {
    return `Sorted bro ❤️‍🔥 Send me full names + Instagram @ for everyone and I'll lock you in`;
  }
  return `You're all set ❤️‍🔥 Send me full names + Instagram @ and I'll lock you in`;
}

/**
 * Message when Sanad pushes to table after handoff.
 * Uses actual group data from state to make it specific.
 * @param {{ min: number, label: string }} tableMinimum
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function pushTableAfterHandoff(tableMinimum, state) {
  const isFemale = state.detected_gender === 'female';
  const isMale = state.detected_gender === 'male';
  const groupDesc = _describeGroupNatural(state);
  const groupText = groupDesc ? ` for ${groupDesc}` : '';

  if (isFemale) {
    return [
      `So for your group I can sort you a private table instead 🍾`,
      `Min spend is ${tableMinimum.label}${groupText} — you'll have your own section, bottles, and the full VIP experience`,
      `Way better for a proper night out tbh 😏 You up for it?`,
    ].join('\n');
  }
  if (isMale) {
    return [
      `Actually bro, best move for your group is a table 🍾`,
      `Min ${tableMinimum.label}${groupText} — your own section, bottles sorted, no queuing`,
      `Much better vibe. You up for it?`,
    ].join('\n');
  }
  return [
    `For your group I'd actually recommend a table 🍾`,
    `Min spend ${tableMinimum.label}${groupText} — private section, bottles, full VIP treatment`,
    `You up for it? 😏`,
  ].join('\n');
}

/**
 * Rejection message after Sanad declines via handoff.
 * Warm, brief, leaves door open.
 * @param {import('../state').ConversationState} state
 * @returns {string}
 */
function rejectionMessage(state) {
  const isFemale = state.detected_gender === 'female';
  const isMale = state.detected_gender === 'male';

  if (isFemale) {
    return `Hey sorry darling, unfortunately we can't accommodate your group this time 🙏 Hope to see you girls at Reign another time ❤️‍🔥`;
  }
  if (isMale) {
    return `Hey bro no worries, we can't accommodate your group this time unfortunately 🙏 Hit me up another time`;
  }
  return `Hey, unfortunately we can't accommodate your group this time 🙏 Hope to see you at Reign another time ❤️‍🔥`;
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
};

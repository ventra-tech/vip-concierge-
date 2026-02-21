/**
 * templates/objections.js
 * Deterministic responses to common objections.
 * Used by toneComposer as a starting point — LLM can rephrase if needed.
 */

/**
 * Get a deterministic objection response.
 * @param {string} rawText - The user's message
 * @param {'male'|'female'|'neutral'} gender
 * @returns {string|null} Response text, or null if no match (LLM handles it)
 */
function getObjectionResponse(rawText, gender) {
  const lower = rawText.toLowerCase();
  const isMale = gender === 'male';

  // "Is it free?" / "Isn't it free?" / "ain't free"
  if (lower.includes('free') || lower.includes('ain\'t free') || lower.includes('not free')) {
    return `The entry is the only thing you pay for. Once you're inside you're good — I've got you 🕺🥂`;
  }

  // "Too expensive" / "that's a lot"
  if (
    lower.includes('expensive') ||
    lower.includes('too much') ||
    lower.includes('that\'s a lot') ||
    lower.includes('thats a lot') ||
    lower.includes('pricey')
  ) {
    return isMale
      ? `Trust me bro, for Mayfair it's actually solid value 😏 What vibe you going for?`
      : `Trust me darling, for Mayfair it's actually great value 🥂 What vibe you going for?`;
  }

  // "Nah" / "never mind" / "forget it"
  if (
    lower.includes('nah') ||
    lower.includes('never mind') ||
    lower.includes('forget it') ||
    lower.includes('not interested')
  ) {
    return isMale
      ? `No worries bro 🤝 Hit me up if you change your mind`
      : `No worries 🤝 Hit me up if you change your mind`;
  }

  // Quality doubts / skepticism
  if (
    lower.includes('worth it') ||
    lower.includes('is it good') ||
    lower.includes('any good') ||
    lower.includes('trust')
  ) {
    return `Please bro i got quality 😏 Reign is proper Mayfair vibes. You'll see.`;
  }

  return null; // No match — let LLM handle
}

/**
 * Birthday acknowledgement message.
 * @param {'male'|'female'|'neutral'} gender
 * @returns {string}
 */
function getBirthdayResponse(gender) {
  const isFemale = gender === 'female';
  return isFemale
    ? `Love that 🥂 Birthday nights hit different at Reign 👀 I'll make sure it's a good one 🫠`
    : `Love that 🥂 Birthday nights hit different at Reign 👀 I'll make sure it's a good one 🫠`;
}

/**
 * Response when someone asks if tonight is good.
 * @param {'male'|'female'|'neutral'} gender
 * @returns {string}
 */
function getTonightResponse(gender) {
  const isMale = gender === 'male';
  return isMale
    ? `Yes ofc bro 😏 Tonight's perfect. How many of you and what vibe you going for? 🥂`
    : `Yes ofc 😏 Tonight's perfect. How many of you and what vibe you going for? 🥂`;
}

module.exports = { getObjectionResponse, getBirthdayResponse, getTonightResponse };

/**
 * templates/objections.js
 * Deterministic responses to common objections.
 * Matches Sanad's exact phrasing from real conversations.
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
  const isFemale = gender === 'female';

  // "Is it free?" / "Isn't it free?" / "ain't free" / "it aint free"
  // Two-message script: entry only + drinks complimentary pitch
  if (lower.includes('free') || lower.includes("ain't free") || lower.includes('aint free') || lower.includes('not free')) {
    return [
      `The entry is the only thing you pay for`,
      `Your drinks are complimentary all night and you get to see all exclusive shows on my vip table And party with the best in Mayfair x`,
    ].join('\n');
  }

  // "Too expensive" / "that's a lot" / "pricey"
  if (
    lower.includes('expensive') ||
    lower.includes('too much') ||
    lower.includes("that's a lot") ||
    lower.includes('thats a lot') ||
    lower.includes('pricey')
  ) {
    return isMale
      ? `Trust me bro for Mayfair it's actually solid value 😏 What vibe you going for?`
      : `Trust me darling for Mayfair it's actually great value 🥂 What vibe you going for?`;
  }

  // "Nah" / "never mind" / "forget it" / not interested
  if (
    lower.includes('nah') ||
    lower.includes('never mind') ||
    lower.includes('forget it') ||
    lower.includes('not interested')
  ) {
    return isMale
      ? `No worries bro 🤝 Hit me up if you change your mind`
      : `No worries gorgeous x Hit me up if you change your mind`;
  }

  // Quality doubts / skepticism / "is it good" / "worth it"
  if (
    lower.includes('worth it') ||
    lower.includes('is it good') ||
    lower.includes('any good') ||
    lower.includes('classy') ||
    lower.includes('quality')
  ) {
    return isMale
      ? `Dw bro i got you\nPlease bro i got quality 😏 Reign is proper Mayfair vibes. You'll see.`
      : `Trust me darling it's proper Mayfair 🥂 You'll love it`;
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
    ? `Amazing darling 🥂 I got a surprise for you girls! Send me a good picture of the birthday girl x`
    : `Love that bro 🥂 Birthday nights hit different at Reign 👀 I'll make sure it's a good one`;
}

/**
 * Response when someone asks if tonight is good / active.
 * @param {'male'|'female'|'neutral'} gender
 * @returns {string}
 */
function getTonightResponse(gender) {
  const isMale = gender === 'male';
  return isMale
    ? `Yes ofc bro tonight is active 🕺 How many of you?`
    : `Yes ofc darling tonight is perfect 😏 How many of you?`;
}

module.exports = { getObjectionResponse, getBirthdayResponse, getTonightResponse };

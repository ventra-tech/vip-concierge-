/**
 * genderDetector.js
 * Detects the likely gender of a user based on available signals.
 * Used to set the correct tone in responses (male / female / neutral).
 *
 * Priority order:
 *   1. Language signals (strongest in DM context)
 *   2. Username signals
 *   3. Emoji signals
 *   4. Context signals (group type, mentions)
 *   5. Fallback: neutral
 */

// ─── SIGNAL DEFINITIONS ───────────────────────────────────────────────────────

const FEMALE_LANGUAGE = [
  'babe', 'babes', 'girlie', 'girlies', 'hun', 'hiya', 'heyy', 'heyyy',
  'omg', 'yasss', 'yass', 'slay', 'iconic', 'queen', 'queens', 'girls',
  'we\'re girls', 'just girls', 'hen', 'hen do', 'birthday girl',
];

const MALE_LANGUAGE = [
  'bro', 'bruv', 'mate', 'lad', 'lads', 'boys', 'guys', 'man',
  'how much bro', 'wagwan', 'wagwan g', 'g ', ' g,', 'fam',
  'min spend', 'table for', 'bottles',
];

const FEMALE_EMOJIS = ['💕', '✨', '🎀', '💄', '👠', '💅', '🌸', '🦋', '🫶', '💖', '💗', '💓', '💞'];
const MALE_EMOJIS = ['💪', '🏋️', '⚽', '🚗', '🔥', '😤', '🤜', '🤛', '👊'];

const FEMALE_USERNAME_PATTERNS = [
  /princess/i, /queen/i, /babe/i, /girl/i, /diva/i, /angel/i,
  /bella/i, /rose/i, /lily/i, /sofia/i, /sarah/i, /emma/i, /olivia/i,
  /jessica/i, /mia/i, /chloe/i, /zoe/i, /elle/i, /bea/i,
];

const MALE_USERNAME_PATTERNS = [
  /\d{2,4}$/, // ends with numbers (common male pattern)
  /official/i, /real/i, /king/i, /boss/i,
  /\bfc\b/i, /\bff\b/i, // football club, fitness
];

const FEMALE_CONTEXT = [
  'girls night', 'girls trip', 'birthday girl', 'hen do', 'hen party',
  'just us girls', 'all girls', 'ladies', 'we\'re all girls',
];

const MALE_CONTEXT = [
  'boys night', 'lads night', 'birthday boy', 'stag do', 'stag night',
  'just the boys', 'all guys', 'all lads',
];

// ─── SCORER ──────────────────────────────────────────────────────────────────

/**
 * Internal scoring function.
 * Returns { femaleScore, maleScore }
 */
function scoreText(text = '', username = '') {
  const lower = text.toLowerCase();
  const lowerUser = username.toLowerCase();
  let femaleScore = 0;
  let maleScore = 0;

  // Language signals (weight: 3)
  FEMALE_LANGUAGE.forEach((kw) => { if (lower.includes(kw)) femaleScore += 3; });
  MALE_LANGUAGE.forEach((kw) => { if (lower.includes(kw)) maleScore += 3; });

  // Context signals (weight: 2)
  FEMALE_CONTEXT.forEach((kw) => { if (lower.includes(kw)) femaleScore += 2; });
  MALE_CONTEXT.forEach((kw) => { if (lower.includes(kw)) maleScore += 2; });

  // Emoji signals (weight: 2)
  FEMALE_EMOJIS.forEach((e) => { if (text.includes(e)) femaleScore += 2; });
  MALE_EMOJIS.forEach((e) => { if (text.includes(e)) maleScore += 2; });

  // Username signals (weight: 1)
  FEMALE_USERNAME_PATTERNS.forEach((re) => { if (re.test(lowerUser)) femaleScore += 1; });
  MALE_USERNAME_PATTERNS.forEach((re) => { if (re.test(lowerUser)) maleScore += 1; });

  return { femaleScore, maleScore };
}

// ─── MAIN DETECTION FUNCTION ──────────────────────────────────────────────────

/**
 * Detect the likely gender of the person messaging.
 *
 * @param {object} params
 * @param {string} params.messageText     - The message content
 * @param {string} [params.username]      - ManyChat / Instagram username
 * @param {string} [params.firstName]     - Subscriber first name from ManyChat
 * @param {string} [params.existingGender] - Previously detected gender (persist if confident)
 * @returns {'male'|'female'|'neutral'}
 */
function detectGender({ messageText = '', username = '', firstName = '', existingGender = null }) {
  // If we already made a confident detection, keep it
  if (existingGender && existingGender !== 'neutral') {
    return existingGender;
  }

  const { femaleScore, maleScore } = scoreText(messageText, username);

  // Need a score gap of at least 2 to make a call, else stay neutral
  const gap = Math.abs(femaleScore - maleScore);

  if (gap < 2) return 'neutral';
  if (femaleScore > maleScore) return 'female';
  if (maleScore > femaleScore) return 'male';
  return 'neutral';
}

/**
 * Map detected gender to tone label used by toneComposer.
 * @param {'male'|'female'|'neutral'} gender
 * @returns {'guys'|'girls'|'neutral'}
 */
function genderToTone(gender) {
  if (gender === 'male') return 'guys';
  if (gender === 'female') return 'girls';
  return 'neutral';
}

module.exports = { detectGender, genderToTone, scoreText };

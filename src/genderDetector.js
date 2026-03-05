/**
 * genderDetector.js
 * Detects the likely gender of a user based on available signals.
 * Used to set the correct tone in responses (male / female / neutral).
 *
 * Priority order (by weight):
 *   1. First name lookup       — weight 5  (highest confidence)
 *   2. Pronoun signals         — weight 4  (e.g. "my boyfriend" = female)
 *   3. Language / slang        — weight 3  (gendered words)
 *   4. Context signals         — weight 2  (group type e.g. "hen do")
 *   5. Emoji signals           — weight 2  (gendered emojis)
 *   6. Username patterns       — weight 1  (lowest — too noisy to trust alone)
 *   7. Fallback: neutral
 */

// ─── FIRST NAME LOOKUP ────────────────────────────────────────────────────────
// Curated for London nightlife demographic (18-35, diverse).
// Only includes names with very low gender ambiguity in UK context.

const FEMALE_NAMES = new Set([
  // British / English
  'sarah', 'emma', 'emily', 'sophie', 'charlotte', 'olivia', 'amelia', 'mia',
  'poppy', 'lily', 'ella', 'grace', 'freya', 'evie', 'hannah', 'lucy', 'zoe',
  'chloe', 'lauren', 'amy', 'holly', 'molly', 'ruby', 'ellie', 'jade', 'katie',
  'megan', 'nicole', 'gemma', 'leah', 'paige', 'amber', 'imogen', 'phoebe',
  'scarlett', 'rosie', 'daisy', 'millie', 'alice', 'georgia', 'abigail',
  'danielle', 'sienna', 'natasha', 'jessica', 'victoria', 'alexandra', 'kayla',
  'brianna', 'tara', 'ciara', 'niamh', 'sinead', 'shannon', 'aoife', 'orla',
  'isla', 'erin', 'brooke', 'madison', 'faith', 'hope', 'jasmine', 'paris',
  'rebecca', 'rachel', 'hayley', 'naomi', 'aaliyah', 'destiny', 'tiffany',
  // African / Nigerian
  'aisha', 'fatima', 'blessing', 'chioma', 'adaeze', 'funmi', 'temi', 'sade',
  'ife', 'yemi', 'kemi', 'bola', 'tolu', 'gbemi', 'amara', 'chiamaka',
  'ngozi', 'nneka', 'ogechi', 'lola', 'abimbola', 'omolola', 'bunmi',
  'tokunbo', 'adaora', 'uchechi', 'ebere', 'chidinma', 'chinyere', 'nnenna',
  // Middle Eastern / Arab
  'layla', 'nadia', 'nour', 'hana', 'rania', 'sana', 'dina', 'sara', 'lara',
  'yasmin', 'leila', 'mariam', 'maryam', 'zainab', 'amira', 'lina', 'rana',
  'reem', 'ghada', 'huda', 'aya', 'salma', 'noura', 'dana', 'dalia', 'lamia',
  'sahar', 'sumaya', 'khadijah',
  // Eastern European
  'katya', 'anastasia', 'olga', 'irina', 'svetlana', 'oksana', 'tatiana',
  'yulia', 'elena', 'natalia', 'alina', 'marina', 'veronika', 'polina',
  'kristina', 'daria', 'ksenia', 'valeria', 'viktoria', 'masha', 'sonya',
  'anya', 'katia', 'mila', 'lena', 'nika', 'alisa',
  // South Asian
  'priya', 'pooja', 'kavya', 'divya', 'ananya', 'meera', 'nisha', 'deepa',
  'sunita', 'rekha', 'geeta', 'asha', 'rita', 'anita', 'neha', 'shreya',
  'anika', 'maya', 'hira', 'ayesha', 'rabia', 'saima', 'sidra', 'amna',
  // Latin / Spanish / French
  'isabella', 'valentina', 'adriana', 'bianca', 'claudia', 'gabriella',
  'alejandra', 'carmen', 'lucia', 'carla', 'paula', 'diana', 'andrea',
  'daniela', 'camila', 'jimena', 'fernanda', 'camille', 'juliette', 'amelie',
  'manon', 'lea', 'celine', 'audrey', 'isabelle', 'mathilde', 'pauline', 'lucie',
]);

const MALE_NAMES = new Set([
  // British / English
  'james', 'oliver', 'harry', 'jack', 'george', 'noah', 'charlie', 'jacob',
  'alfie', 'freddie', 'oscar', 'archie', 'leo', 'henry', 'william', 'thomas',
  'ethan', 'joshua', 'daniel', 'samuel', 'ryan', 'luke', 'adam', 'liam',
  'nathan', 'jake', 'kyle', 'connor', 'tyler', 'lewis', 'callum', 'scott',
  'craig', 'ricky', 'dean', 'aaron', 'bradley', 'brandon', 'cameron', 'cody',
  'cole', 'corey', 'damian', 'darren', 'dylan', 'edward', 'evan', 'felix',
  'finn', 'fraser', 'harvey', 'ian', 'jason', 'joel', 'kieran', 'lachlan',
  'logan', 'lucas', 'marcus', 'matthew', 'max', 'neil', 'nick', 'owen',
  'patrick', 'paul', 'peter', 'reece', 'richard', 'robert', 'ronan', 'ross',
  'sean', 'shane', 'simon', 'stephen', 'stuart', 'tim', 'tom', 'warren',
  'wayne', 'wesley', 'zac', 'zachary', 'ben', 'joe', 'jon', 'jonathan',
  'josh', 'karl', 'kevin', 'mark', 'mike', 'rob', 'robin', 'drew',
  'callum', 'finlay', 'rory', 'angus', 'hamish',
  // African / Nigerian
  'emeka', 'chidi', 'obinna', 'tunde', 'segun', 'rotimi', 'dele', 'femi',
  'biodun', 'kunle', 'wole', 'bode', 'ade', 'olu', 'deji', 'gbenga',
  'kayode', 'yinka', 'bayo', 'sayo', 'leke', 'jide', 'ugo', 'ike',
  'dubem', 'chuma', 'chike', 'kelechi', 'nnamdi', 'odion', 'okwy',
  // Middle Eastern / Arab / Muslim
  'mohammed', 'muhammad', 'omar', 'ali', 'hassan', 'yusuf', 'ibrahim',
  'khalid', 'tariq', 'bilal', 'hamza', 'zaid', 'saad', 'faisal', 'adil',
  'raza', 'imran', 'asif', 'waseem', 'naveed', 'usman', 'amir', 'kareem',
  'jamal', 'karim', 'rashid', 'tarek', 'hani', 'khaled', 'ahmed', 'mahmoud',
  'mostafa', 'mehdi', 'rayan', 'sofiane', 'rachid', 'yassin',
  // Eastern European
  'dmitri', 'pavel', 'alexei', 'mikhail', 'ivan', 'sergei', 'andrei',
  'nikolai', 'viktor', 'boris', 'anton', 'vadim', 'kirill', 'artem',
  'ruslan', 'vlad', 'vladimir', 'denis', 'oleg', 'evgeny', 'roman', 'timur',
  'daniil', 'maxim',
  // South Asian
  'arjun', 'rahul', 'rohan', 'arun', 'sunil', 'raj', 'rajesh', 'vikram',
  'nikhil', 'aditya', 'siddharth', 'manish', 'deepak', 'anand', 'ravi',
  'suresh', 'ramesh', 'gaurav', 'abhishek', 'dhruv', 'varun', 'harsh',
  'ayaan', 'aarav', 'farhan', 'ahsan', 'fahad',
  // Latin / French
  'carlos', 'miguel', 'alejandro', 'diego', 'fernando', 'eduardo', 'mateo',
  'santiago', 'andres', 'antoine', 'pierre', 'baptiste', 'xavier', 'jerome',
]);

// ─── SIGNAL DEFINITIONS ───────────────────────────────────────────────────────

// Pronoun signals — very reliable, reveals the sender's own gender
const FEMALE_PRONOUNS = [
  'my boyfriend', 'my boyfriend\'s', 'my husband', 'my husband\'s',
  'me and my boyfriend', 'with my boyfriend', 'with my husband',
];
const MALE_PRONOUNS = [
  'my girlfriend', 'my girlfriend\'s', 'my wife', 'my wife\'s',
  'me and my girlfriend', 'with my girlfriend', 'with my wife',
  'my misus', 'my missus', 'my mrs',
];

// Language / slang — gendered vocabulary used by the sender
const FEMALE_LANGUAGE = [
  'girlie', 'girlies', 'hun', 'hiya',
  'omg', 'yasss', 'yass', 'slay', 'iconic', 'queen', 'queens',
  'we\'re girls', 'just girls', 'hen', 'hen do', 'birthday girl',
  'girlfriends', 'girl friends', 'my girls', 'the girls', 'all girls',
  'its girls', 'it\'s girls', 'yes girls', 'we are girls',
];

// Removed: 'babe', 'babes' (guys say to girls), 'guys' (everyone says it),
//          'man' (casual filler), 'min spend', 'table for', 'bottles' (booking terms anyone uses)
const MALE_LANGUAGE = [
  'bro', 'bruv', 'mate', 'lad', 'lads', 'boys',
  'wagwan', 'wagwan g', 'fam', 'g ',
];

const FEMALE_EMOJIS = ['💕', '✨', '🎀', '💄', '👠', '💅', '🌸', '🦋', '🫶', '💖', '💗', '💓', '💞'];
const MALE_EMOJIS = ['💪', '🏋️', '⚽', '🚗', '😤', '🤜', '🤛', '👊'];

const FEMALE_USERNAME_PATTERNS = [
  /princess/i, /queen/i, /babe/i, /girl/i, /diva/i, /angel/i,
  /bella/i, /rose/i, /lily/i, /sofia/i, /sarah/i, /emma/i, /olivia/i,
  /jessica/i, /mia/i, /chloe/i, /zoe/i, /elle/i,
];

// Removed: /\d{2,4}$/ — way too many false positives (sarah93, emily2001, etc.)
const MALE_USERNAME_PATTERNS = [
  /official/i, /real/i, /king/i, /boss/i,
  /\bfc\b/i,   // football club
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
 * Returns { femaleScore, maleScore } based on all available signals.
 */
function scoreText(text = '', username = '', firstName = '') {
  const lower = text.toLowerCase();
  const lowerUser = username.toLowerCase();
  const lowerName = firstName.toLowerCase().trim();
  let femaleScore = 0;
  let maleScore = 0;

  // 1. First name lookup (weight: 5) — highest confidence, checked first
  if (lowerName) {
    if (FEMALE_NAMES.has(lowerName)) femaleScore += 5;
    else if (MALE_NAMES.has(lowerName)) maleScore += 5;
  }

  // 2. Pronoun signals (weight: 4) — very reliable
  FEMALE_PRONOUNS.forEach((kw) => { if (lower.includes(kw)) femaleScore += 4; });
  MALE_PRONOUNS.forEach((kw) => { if (lower.includes(kw)) maleScore += 4; });

  // 3. Language / slang signals (weight: 3)
  FEMALE_LANGUAGE.forEach((kw) => { if (lower.includes(kw)) femaleScore += 3; });
  MALE_LANGUAGE.forEach((kw) => { if (lower.includes(kw)) maleScore += 3; });

  // 4. Context signals (weight: 2)
  FEMALE_CONTEXT.forEach((kw) => { if (lower.includes(kw)) femaleScore += 2; });
  MALE_CONTEXT.forEach((kw) => { if (lower.includes(kw)) maleScore += 2; });

  // 5. Emoji signals (weight: 2)
  FEMALE_EMOJIS.forEach((e) => { if (text.includes(e)) femaleScore += 2; });
  MALE_EMOJIS.forEach((e) => { if (text.includes(e)) maleScore += 2; });

  // 6. Username patterns (weight: 1) — lowest confidence
  FEMALE_USERNAME_PATTERNS.forEach((re) => { if (re.test(lowerUser)) femaleScore += 1; });
  MALE_USERNAME_PATTERNS.forEach((re) => { if (re.test(lowerUser)) maleScore += 1; });

  return { femaleScore, maleScore };
}

// ─── MAIN DETECTION FUNCTION ──────────────────────────────────────────────────

/**
 * Detect the likely gender of the person messaging.
 *
 * @param {object} params
 * @param {string} params.messageText      - The message content
 * @param {string} [params.username]       - ManyChat / Instagram username
 * @param {string} [params.firstName]      - Subscriber first name from ManyChat
 * @param {string} [params.existingGender] - Previously detected gender (persist if confident)
 * @returns {'male'|'female'|'neutral'}
 */
function detectGender({ messageText = '', username = '', firstName = '', existingGender = null }) {
  // Once gender is locked as male or female — never change it mid-conversation
  if (existingGender && existingGender !== 'neutral') {
    return existingGender;
  }

  const { femaleScore, maleScore } = scoreText(messageText, username, firstName);
  const gap = Math.abs(femaleScore - maleScore);

  // Require a gap of at least 3 to make a call — stays neutral until confident
  if (gap < 3) return 'neutral';
  if (femaleScore > maleScore) return 'female';
  if (maleScore > femaleScore) return 'male';
  return 'neutral';
}

module.exports = { detectGender, scoreText };

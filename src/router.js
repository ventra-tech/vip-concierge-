/**
 * router.js
 * Step 1: Classify every incoming message before any logic runs.
 *
 * Strategy:
 *   1. Detect message type (text / voice / image / video)
 *   2. Keyword-based intent matching (fast, deterministic)
 *   3. Extract numbers (group size, guys, girls)
 *   4. Extract night/date signals
 *   5. LLM fallback ONLY when keywords produce no match
 */

const { detectNightType, getNightLabel } = require('./policy/reign');

// ─── INTENT KEYWORD MAP ──────────────────────────────────────────────────────

const INTENT_KEYWORDS = {
  guestlist: [
    'guestlist', 'guest list', 'gl', 'add me', 'add us', 'put me on',
    'put us on', 'come tonight', 'coming tonight', 'can we come',
    'can i come', 'get in', 'getting in', 'entry', 'free entry',
  ],
  table: [
    'table', 'bottle', 'bottles', 'min spend', 'minimum spend',
    'booth', 'reserve', 'reservation', 'book a table', 'vip table',
    'private table', 'section',
  ],
  question: [
    'how much', 'price', 'cost', 'charge', 'fee', 'what time', 'when does',
    'dress code', 'what to wear', 'id', 'identification', 'address',
    'where is', 'location', 'tonight', 'is it good', 'worth it',
    'what\'s the vibe', 'whats the vibe', 'age', 'age limit',
  ],
  objection: [
    'free', 'too expensive', 'expensive', 'not free', 'ain\'t free',
    'that\'s a lot', 'thats a lot', 'too much', 'nah', 'never mind',
    'forget it', 'not interested',
  ],
  birthday: [
    'birthday', 'bday', 'b day', 'b-day', 'celebration', 'celebrate', 'special occasion',
    'anniversary',
  ],
  confirmation: [
    'yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'sounds good',
    'perfect', 'deal', 'let\'s do it', 'book it', 'confirm', 'done',
  ],
};

// ─── MESSAGE TYPE DETECTION ──────────────────────────────────────────────────

/**
 * Detect the type of the incoming ManyChat message.
 * @param {object} manyChatPayload - Raw payload from ManyChat webhook
 * @returns {'text'|'voice'|'image'|'video'}
 */
function detectMessageType(manyChatPayload) {
  const type = manyChatPayload?.type || manyChatPayload?.message_type || 'text';
  if (type === 'audio' || type === 'voice') return 'voice';
  if (type === 'image' || type === 'photo') return 'image';
  if (type === 'video') return 'video';
  return 'text';
}

// ─── KEYWORD INTENT MATCHING ─────────────────────────────────────────────────

/**
 * Classify intent using keyword matching.
 * Returns null if no match found (triggers LLM fallback).
 * @param {string} text
 * @returns {string|null}
 */
function keywordClassify(text) {
  const lower = text.toLowerCase();

  // Check each intent in priority order
  const priorityOrder = ['guestlist', 'table', 'birthday', 'confirmation', 'objection', 'question'];

  for (const intent of priorityOrder) {
    const keywords = INTENT_KEYWORDS[intent];
    if (keywords.some((kw) => lower.includes(kw))) {
      return intent;
    }
  }
  return null;
}

// ─── NUMBER EXTRACTION ────────────────────────────────────────────────────────

/**
 * Extract group composition numbers from text.
 * Handles patterns like "3 guys 4 girls", "me and 2 friends", "group of 6"
 * @param {string} text
 * @returns {{ groupSize: number|null, guys: number|null, girls: number|null }}
 */
function extractNumbers(text) {
  const lower = text.toLowerCase();
  let guys = null;
  let girls = null;
  let groupSize = null;

  // Pattern: "X guys" / "X lads" / "X men" / "X males" / "X boys"
  const guysMatch = lower.match(/(\d+)\s*(guy|guys|lad|lads|man|men|male|males|bro|bros|boy|boys)/);
  if (guysMatch) guys = parseInt(guysMatch[1], 10);

  // Pattern: "X girls" / "X females" / "X women" / "X of my girls" / "X of us girls"
  const girlsMatch = lower.match(/(\d+)\s*(?:of\s+(?:my|us|the)\s+)?(girl|girls|female|females|woman|women|lady|ladies)/);
  if (girlsMatch) girls = parseInt(girlsMatch[1], 10);

  // Pattern: "me and X" — total group = X + 1 (the person themselves + X others)
  // e.g. "me and 3 of my boys" = 4 people total
  const meAndMatch = lower.match(/\bme\s+and\s+(\d+)\b/);
  if (meAndMatch && groupSize === null) {
    groupSize = parseInt(meAndMatch[1], 10) + 1;
  }

  // Pattern: "X of my girls" / "X of my mates" at start or anywhere
  const ofMyMatch = lower.match(/(\d+)\s+of\s+my\s+(girl|girls|mate|mates|friend|friends|lad|lads|guy|guys)/);
  if (ofMyMatch && girls === null && guys === null) {
    const word = ofMyMatch[2];
    const num = parseInt(ofMyMatch[1], 10);
    if (['girl', 'girls', 'friend', 'friends'].includes(word)) girls = num;
    if (['mate', 'mates', 'lad', 'lads', 'guy', 'guys'].includes(word)) guys = num;
  }

  // Pattern: "all girls" / "just girls" / "only girls" — no guys
  if (!guys && /\b(all|just|only|we're all|were all)\s+girls\b/.test(lower)) {
    guys = 0;
  }

  // Pattern: "all guys" / "just guys" / "only guys" — no girls
  if (!girls && /\b(all|just|only|we're all|were all)\s+(guys|lads|boys|men)\b/.test(lower)) {
    girls = 0;
  }

  // Pattern: "group of X" / "party of X" / "X of us" / "just X of us"
  // "there's X of us" / "there are X of us" / "theres X of us"
  // "we are X" / "we're X" / "its X of us" / "it's X of us"
  const groupMatch = lower.match(
    /(?:group|party|table)\s+of\s+(\d+)|(\d+)\s+of\s+us|just\s+(\d+)\s+of\s+us|there(?:'s|s|\s+are)\s+(\d+)\s+of\s+us|we(?:'re|\s+are)\s+(\d+)|it(?:'s|\s+is)\s+(\d+)\s+of\s+us|coming\s+(\d+)|(\d+)\s+coming|(\d+)\s+of\s+us/
  );
  if (groupMatch) {
    const val = groupMatch[1] || groupMatch[2] || groupMatch[3] || groupMatch[4] || groupMatch[5] || groupMatch[6] || groupMatch[7] || groupMatch[8] || groupMatch[9] || groupMatch[10];
    if (val) groupSize = parseInt(val, 10);
  }

  // Pattern: "3 of us" at start of message e.g. "3 of us, all girls"
  const usMatch = lower.match(/^(\d+)\s+of\s+us/);
  if (usMatch && !groupSize) {
    groupSize = parseInt(usMatch[1], 10);
  }

  // Pattern: standalone number with common prefixes — "4" / "just 4" / "only 2" / "like 3"
  if (!groupSize) {
    const standaloneMatch = lower.match(/^(?:just\s+|only\s+|like\s+|about\s+|maybe\s+|probably\s+)?(\d+)(?:\s+of\s+us)?$/);
    if (standaloneMatch) groupSize = parseInt(standaloneMatch[1], 10);
  }

  // Pattern: "only X", "just X", "there's X", "its X" anywhere in message
  if (!groupSize) {
    const naturalMatch = lower.match(/(?:only|just|its|it's|theres|there's|around|like|about)\s+(\d+)(?:\s+of\s+us)?/);
    if (naturalMatch) groupSize = parseInt(naturalMatch[1], 10);
  }

  // Pattern: solo — "just me", "it's just me", "solo", "only me"
  if (!groupSize && (lower.includes('just me') || lower.includes('solo') || lower.includes('only me') || lower.match(/^(1|one)$/))) {
    groupSize = 1;
  }

  // Pattern: "me and [name] and [name]..." — names spelled out instead of numbers
  // e.g. "me and bob and mike" = 3, "me and sarah and jade and chloe" = 4
  // Count "me" (1) + one person per "and"
  if (!groupSize) {
    const meNamesChain = lower.match(/\bme\s+and\s+[a-z]+(\s+and\s+[a-z]+)+/);
    if (meNamesChain) {
      const andCount = (meNamesChain[0].match(/\band\b/g) || []).length;
      groupSize = 1 + andCount;
    }
  }

  // If all girls and we have group size, set girls = groupSize
  if (guys === 0 && girls === null && groupSize !== null) {
    girls = groupSize;
  }

  // If we have both guys and girls, derive group size
  if (guys !== null && girls !== null && groupSize === null) {
    groupSize = guys + girls;
  }

  // Sanity check: any number above 30 is almost certainly a phone number or typo, not a group size
  const MAX_GROUP = 30;
  if (groupSize !== null && groupSize > MAX_GROUP) groupSize = null;
  if (guys !== null && guys > MAX_GROUP) guys = null;
  if (girls !== null && girls > MAX_GROUP) girls = null;

  // If only group size, can't split — leave guys/girls null
  return { groupSize, guys, girls };
}

// ─── NAME AND INSTAGRAM EXTRACTION ───────────────────────────────────────────

/**
 * Extract full names and Instagram handles from a message.
 * Handles all formats seen in real Sanad conversations:
 *   - Comma-separated: "alexa lewis, bree stewart, grace roggeman, ella ward"
 *   - Multi-line block: "Hey,\nNames\nMaggie voisin\nIndianna Buckley\nLolly Britton"
 *   - Two lines: "Rachel Chilcott\nJamie-Lee Brackstone"
 *   - All caps surnames: "Nouhaila EL KADIRI\nZineb EL KADIRI"
 *   - Instagram.com URLs: "https://www.instagram.com/username?igsh=..."
 *   - @username handles
 * @param {string} text
 * @returns {{ names: string[], instagrams: string[] }}
 */
function extractNamesAndInstagram(text) {
  const names = [];
  const instagrams = [];

  // ── 0. Normalise "@ handle" (space after @) → "@handle" ──
  const normalised = text.replace(/@\s+(\w)/g, '@$1');

  // ── 0b. Handle "Full name - X" / "Name - X" / "Insta - X" / "IG - X" patterns ──
  const fullNameMatch = normalised.match(/(?:full\s*name|name)\s*[-:]\s*([A-Za-z]+([-'\s][A-Za-z]+)*)/i);
  if (fullNameMatch) {
    const n = fullNameMatch[1].trim();
    if (n.length > 1 && !names.includes(n)) names.push(n);
  }
  const instaLabelMatch = normalised.match(/(?:insta(?:gram)?|ig)\s*[-:]\s*@?([\w.]+)/i);
  if (instaLabelMatch) {
    const handle = '@' + instaLabelMatch[1].toLowerCase();
    if (!instagrams.includes(handle)) instagrams.push(handle);
  }

  // ── 1. Extract @username handles ──
  const igMatches = normalised.match(/@[\w.]+/g);
  if (igMatches) {
    igMatches.forEach(handle => {
      if (!instagrams.includes(handle.toLowerCase())) instagrams.push(handle.toLowerCase());
    });
  }

  // ── 2. Extract instagram.com profile URLs (handles igsh= share links too) ──
  const igUrlMatches = normalised.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/gi);
  if (igUrlMatches) {
    igUrlMatches.forEach(url => {
      const match = url.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
      // Exclude path segments like /p/ /reel/ /stories/
      if (match && match[1] && !['p', 'reel', 'stories', 'explore', 'tv'].includes(match[1].toLowerCase())) {
        const handle = '@' + match[1].toLowerCase();
        if (!instagrams.includes(handle)) instagrams.push(handle);
      }
    });
  }

  // ── 3. Try comma-separated names ──
  // e.g. "alexa lewis, bree stewart, grace roggeman, ella ward"
  const commaParts = normalised.split(',').map(p => p.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const nameParts = [];
    for (const part of commaParts) {
      // Strip handles, URLs, list numbers, and separators
      const cleaned = part
        .replace(/@[\w.]+/g, '')
        .replace(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/\S+/gi, '')
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^[-–—|:,]\s*/, '')
        .replace(/\s*[-–—|:,]+\s*$/, '')
        .trim();
      // Allow: "First Last", "First-Last Last", "FIRST LAST", "First Last Last"
      // Also allow single first names (min 3 letters, letters only) — e.g. "Sophie, Ella, Mia"
      const isMultiWordName = /^[A-Za-z]+([-'][A-Za-z]+)?(\s+[A-Za-z]+([-'][A-Za-z]+)?)+$/.test(cleaned);
      const isSingleFirstName = /^[A-Za-z]{3,}$/.test(cleaned);
      if (cleaned && (isMultiWordName || isSingleFirstName)) {
        nameParts.push(cleaned);
      }
      // Non-matching parts are silently skipped (don't abort entire list)
    }
    // Accept if at least 2 name-looking parts found
    if (nameParts.length >= 2) {
      nameParts.forEach(n => { if (!names.includes(n)) names.push(n); });
    }
  }

  // ── 4. Process each line — extract name, @handle, or both ──
  // Handles: "Name @handle", "Name", "@handle", instagram.com links, mixed blocks
  const SKIP_LINES = /^(hey,?|names?:?|instagrams?:?|ig:?|hi,?|hello,?|ok,?|sure,?|here,?|and,?|also,?)$/i;
  const LABEL_LINES = /^(full\s*name|insta(?:gram)?|ig)\s*[-:]/i;
  const NAME_RE = /^[A-Za-z]+([-'][A-Za-z]+)?(\s+[A-Za-z]+([-'][A-Za-z]+)?){1,2}$/;
  const URL_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/\S*/gi;

  const lines = normalised.split(/\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (SKIP_LINES.test(line)) continue;
    if (LABEL_LINES.test(line)) continue;

    // Strip URLs and @handles first, then clean up separators/list numbers
    const namePart = line
      .replace(URL_RE, '')
      .replace(/@[\w.]+/g, '')
      .replace(/^\d+[.)]\s*/, '')       // strip leading list number e.g. "1. " "2) "
      .replace(/^[-–—|:,]\s*/, '')      // strip leading separator
      .replace(/\s*[-–—|:,]+\s*$/, '')  // strip trailing separator (e.g. "Molly Smith -")
      .trim();

    // Skip if remaining text is clearly a sentence (has ! or ? or is very long)
    if (namePart.length > 60 || /[!?]/.test(namePart)) continue;

    // If what's left looks like a name — extract it
    if (namePart && NAME_RE.test(namePart) && !names.includes(namePart)) {
      names.push(namePart);
    }
  }

  // ── 5. Try "my name is X" / "i'm X" patterns ──
  if (names.length === 0) {
    const namedMatch = normalised.match(
      /(?:my name(?:'s| is)|name is|i'm|im|it's|its|i am)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i
    );
    if (namedMatch) {
      const cleaned = namedMatch[1].trim();
      if (cleaned.length > 1 && !names.includes(cleaned)) names.push(cleaned);
    }
  }

  // ── 6. Bare "FirstName LastName" (single line, no other content) ──
  if (names.length === 0 && instagrams.length === 0) {
    const bareNameMatch = normalised.trim().match(/^([A-Z][a-zA-Z]+([-'][A-Za-z]+)?(?:\s+[A-Z]?[a-zA-Z]+([-'][A-Za-z]+)?){1,2})$/);
    if (bareNameMatch) names.push(bareNameMatch[1].trim());
  }

  return { names, instagrams };
}

// ─── PHONE NUMBER EXTRACTION ──────────────────────────────────────────────────

/**
 * Extract a phone number from text.
 * Handles UK and international formats.
 * @param {string} text
 * @returns {string|null}
 */
function extractPhoneNumber(text) {
  // Match UK numbers (+44...), international (+X...), or bare 07... / 07...
  const match = text.match(/(\+?[\d\s\-().]{10,16})/);
  if (match) {
    const cleaned = match[1].replace(/[\s\-().]/g, '');
    // Must be at least 10 digits
    if (/^\+?\d{10,15}$/.test(cleaned)) return cleaned;
  }
  return null;
}

// ─── DATE / NIGHT EXTRACTION ──────────────────────────────────────────────────

// ─── MAIN ROUTER FUNCTION ─────────────────────────────────────────────────────

/**
 * Classify an incoming message and extract all useful data from it.
 * @param {object} manyChatPayload - Raw ManyChat webhook payload
 * @param {string} messageText     - The user's message text
 * @returns {Promise<{
 *   intent: string,
 *   messageType: string,
 *   groupSize: number|null,
 *   guys: number|null,
 *   girls: number|null,
 *   nightType: 'weekday'|'weekend'|null,
 *   rawText: string,
 *   classifiedBy: 'keyword'|'llm'
 * }>}
 */
function classifyMessage(manyChatPayload, messageText) {
  const messageType = detectMessageType(manyChatPayload);
  const text = messageText || '';

  // Non-text messages bypass intent classification
  if (messageType !== 'text') {
    return {
      intent: 'media_message',
      messageType,
      groupSize: null,
      guys: null,
      girls: null,
      nightType: null,
      rawText: '',
      classifiedBy: 'rule',
    };
  }

  // Keyword match — fast and free. Falls back to 'unknown' if no match.
  const intent = keywordClassify(text) || 'unknown';
  const classifiedBy = intent !== 'unknown' ? 'keyword' : 'none';

  // Step 3: extract numbers, date signals, names, Instagram handles, phone numbers
  const { groupSize, guys, girls } = extractNumbers(text);
  const nightType = detectNightType(text);
  const nightLabel = getNightLabel(text);
  const { names, instagrams } = extractNamesAndInstagram(text);
  const phoneNumber = extractPhoneNumber(text);

  return {
    intent,
    messageType,
    groupSize,
    guys,
    girls,
    nightType,
    nightLabel,
    names,
    instagrams,
    phoneNumber,
    rawText: text,
    classifiedBy,
  };
}

module.exports = {
  classifyMessage,
  detectMessageType,
  keywordClassify,
  extractNumbers,
};

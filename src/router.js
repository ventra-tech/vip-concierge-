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

const { callLLM } = require('./llm/provider');
const { detectNightType } = require('./policy/reign');

// ─── INTENT KEYWORD MAP ──────────────────────────────────────────────────────

const INTENT_KEYWORDS = {
  guestlist: [
    'guestlist', 'guest list', 'gl', 'add me', 'add us', 'put me on',
    'put us on', 'come tonight', 'coming tonight', 'can we come',
    'can i come', 'get in', 'getting in', 'entry', 'free entry',
  ],
  table: [
    'table', 'vip', 'bottle', 'bottles', 'min spend', 'minimum spend',
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
    'birthday', 'bday', 'celebration', 'celebrate', 'special occasion',
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
  const priorityOrder = ['table', 'guestlist', 'birthday', 'confirmation', 'objection', 'question'];

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

  // Pattern: "X guys" / "X lads" / "X men" / "X males"
  const guysMatch = lower.match(/(\d+)\s*(guy|guys|lad|lads|man|men|male|males|bro|bros)/);
  if (guysMatch) guys = parseInt(guysMatch[1], 10);

  // Pattern: "X girls" / "X females" / "X women" / "X of my girls" / "X of us girls"
  const girlsMatch = lower.match(/(\d+)\s*(?:of\s+(?:my|us|the)\s+)?(girl|girls|female|females|woman|women|lady|ladies)/);
  if (girlsMatch) girls = parseInt(girlsMatch[1], 10);

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

  // Pattern: standalone number when context is clear e.g. "4" / "just 4" / "4 of us"
  if (!groupSize) {
    const standaloneMatch = lower.match(/^(?:just\s+)?(\d+)(?:\s+of\s+us)?$/);
    if (standaloneMatch) groupSize = parseInt(standaloneMatch[1], 10);
  }

  // Pattern: solo — "just me", "it's just me", "solo"
  if (!groupSize && (lower.includes('just me') || lower.includes('solo') || lower.includes('only me'))) {
    groupSize = 1;
  }

  // If all girls and we have group size, set girls = groupSize
  if (guys === 0 && girls === null && groupSize !== null) {
    girls = groupSize;
  }

  // If we have both guys and girls, derive group size
  if (guys !== null && girls !== null && groupSize === null) {
    groupSize = guys + girls;
  }

  // If only group size, can't split — leave guys/girls null
  return { groupSize, guys, girls };
}

// ─── DATE / NIGHT EXTRACTION ──────────────────────────────────────────────────

/**
 * Extract night type signals from text.
 * @param {string} text
 * @returns {'weekday'|'weekend'|null}
 */
function extractNightType(text) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const lower = text.toLowerCase();
  for (const day of days) {
    if (lower.includes(day)) return detectNightType(day);
  }
  if (lower.includes('tonight') || lower.includes('today')) return detectNightType('tonight');
  return null;
}

// ─── LLM FALLBACK CLASSIFICATION ─────────────────────────────────────────────

/**
 * Ask LLM to classify intent when keywords produce no match.
 * Returns one of the valid intent strings.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function llmClassifyIntent(text) {
  const prompt = `You are classifying an Instagram DM sent to a London nightclub.
Classify this message into EXACTLY one of these intents:
- guestlist (wants to get on the guest list)
- table (wants a VIP table / bottle service)
- question (asking about venue, price, dress code, location, etc.)
- objection (pushing back on price, conditions, or declining)
- birthday (mentioning a birthday or celebration)
- confirmation (saying yes / agreeing to proceed)
- unknown (cannot determine)

Message: "${text}"

Reply with only the intent word, nothing else.`;

  try {
    const result = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 10 });
    const intent = result.trim().toLowerCase();
    const validIntents = ['guestlist', 'table', 'question', 'objection', 'birthday', 'confirmation', 'unknown'];
    return validIntents.includes(intent) ? intent : 'unknown';
  } catch {
    return 'unknown';
  }
}

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
async function classifyMessage(manyChatPayload, messageText) {
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

  // Step 1: try keyword match (fast, free, deterministic)
  const keywordIntent = keywordClassify(text);
  const classifiedBy = keywordIntent ? 'keyword' : 'llm';

  // Step 2: LLM fallback only if keywords failed
  const intent = keywordIntent || (await llmClassifyIntent(text));

  // Step 3: extract numbers and date signals
  const { groupSize, guys, girls } = extractNumbers(text);
  const nightType = extractNightType(text);

  return {
    intent,
    messageType,
    groupSize,
    guys,
    girls,
    nightType,
    rawText: text,
    classifiedBy,
  };
}

module.exports = {
  classifyMessage,
  detectMessageType,
  keywordClassify,
  extractNumbers,
  extractNightType,
};

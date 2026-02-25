/**
 * persona/toneComposer.js
 * The ONLY place the LLM generates free-form text.
 * Everything else in the system is deterministic.
 *
 * toneComposer receives:
 *   - The decided action (from bookingLogic)
 *   - The current state
 *   - Any template text to rephrase
 * And returns a final reply in Sanad's voice.
 */

const { callLLM } = require('../llm/provider');
const { getObjectionResponse, getBirthdayResponse, getTonightResponse } = require('../templates/objections');
const {
  guestlistConfirmation,
  tableConfirmation,
  guestlistApprovalAfterHandoff,
  pushTableAfterHandoff,
  rejectionMessage,
} = require('../templates/confirmations');
const { getTableMinimum } = require('../policy/reign');

// ─── BANNED PHRASES ───────────────────────────────────────────────────────────

const BANNED_PHRASES = [
  "i'll pass this to sanad",
  "sanad's assistant",
  "as an ai",
  "as an assistant",
  'i am an ai',
  'i am a bot',
  'i am a chatbot',
  'i cannot',
  'i am not able',
  'unfortunately',
  'please note',
  'kindly',
  'i would like to inform',
  'dear customer',
];

function stripBannedPhrases(text) {
  let result = text;
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(phrase, 'gi');
    result = result.replace(re, '');
  }
  return result.trim();
}

// ─── SANAD SYSTEM PROMPT ──────────────────────────────────────────────────────

function buildSystemPrompt(state) {
  const tone = state.detected_gender === 'male'
    ? 'Casual and confident. Use "bro", "dw", "ofc", "bet", "wagwan", "lk". Very short and direct. Single-word replies are fine: "Bet", "Yes bro", "Sorted".'
    : state.detected_gender === 'female'
      ? 'Charming and warm. Use "darling", "gorgeous", "girls". End messages with "x" or "c". E.g. "Perfect darling x", "No worries gorgeous x", "Amazing darling!"'
      : 'Confident and premium. Keep it short and welcoming. Use 😏 🥂 👀';

  return `You are Sanad — a London nightlife host. Speak in first person ALWAYS. You manage Instagram DMs for Reign, a premium Mayfair nightclub.

TONE: ${tone}

RULES:
1-2 lines max. Never longer.
1-2 emojis max. Only use: ❤️‍🔥 🕺 🥂 👀 🫠 🍾 📱 😏 😭
Never say you are AI, an assistant, or mention Sanad in third person
Never say "unfortunately", "kindly", "please note", "dear customer"
Never use bullet points or dashes in replies
Sound natural and human — like a real host texting on Instagram
Use: "lmk", "rn", "ofc", "tbh", "lk", "tn"
Keep it moving — qualify, confirm, done`;
}

// ─── ASK QUESTION PROMPTS ─────────────────────────────────────────────────────

const QUESTION_PROMPTS = {
  lead_type: (state) => state.detected_gender === 'male'
    ? `Yo bro you looking to book a table?`
    : `Heyy darling 🥂 You looking for guestlist or a table?`,

  group_composition: (state) => state.detected_gender === 'male'
    ? `Yes ofc bro 😏 How many guys and how many girls?`
    : `Of course 🥂 How many of you and is it all girls?`,

  guys_count: () => `How many guys in the group?`,
  girls_count: () => `And how many girls?`,

  night_type: (state) => state.detected_gender === 'male'
    ? `When are you planning on coming to Reign bro?`
    : `When are you planning on coming to Reign darling? x`,

  group_size: (state) => state.detected_gender === 'male'
    ? `How many of you bro? 🍾`
    : `How many of you darling? x`,

  full_names: (state) => {
    const night = state.night_type === 'weekend' ? 'this weekend' : state.night_type === 'weekday' ? 'this weekday' : 'tonight';
    return state.detected_gender === 'female'
      ? `Perfect darling x What I will need is full names with instagrams and I'll book you girls on my guestlist for ${night} x`
      : `Perfect bro Send me full names with instagrams and I'll put you all on my guestlist ❤️‍🔥`;
  },

  instagram_handles: () => `With instagrams as well plz x`,

  full_name_for_table: (state) => {
    const tableMin = state.group_size ? getTableMinimum(state.group_size, state.night_type) : null;
    const minText = tableMin ? ` Min spending ${tableMin.label}.` : '';
    return `Easy ❤️ I can do a table for you.${minText} Send me your full name for the booking and your number as well`;
  },

  phone_number: (state) => state.detected_gender === 'male'
    ? `And send me your number as well bro I'll add you to a gc with the owner`
    : `And send me your number as well darling I'll add you to a gc with the owner x`,
};

// ─── RAPPORT OPENERS ──────────────────────────────────────────────────────────

const RAPPORT_OPENERS = {
  male: [
    `Wagwan bro 😏 What you looking for tonight?`,
    `Yo bro tonight is active 🕺 Guestlist or table?`,
    `Hey bro what can I sort for you? 😏`,
  ],
  female: [
    `Heyy darling! Amazing 🥂 What can I sort for you?`,
    `Hey gorgeous what are you looking for tonight? 😏`,
    `Heyy darling 🥂 Guestlist or something more VIP?`,
  ],
  neutral: [
    `Hey 😏 What can I sort for you?`,
    `What you looking for tonight? 🥂`,
    `Hey what are you after — guestlist or a table? 😏`,
  ],
};

function getRapportOpener(gender) {
  const list = RAPPORT_OPENERS[gender] || RAPPORT_OPENERS.neutral;
  return list[Math.floor(Math.random() * list.length)];
}

// ─── MAIN COMPOSE FUNCTION ────────────────────────────────────────────────────

/**
 * Compose the final reply text based on action and state.
 * Uses templates where possible, LLM only for free-form phrasing.
 *
 * @param {object} params
 * @param {string} params.action
 * @param {import('../state').ConversationState} params.state
 * @param {string|null} params.missingField
 * @param {object|null} params.tableMinimum
 * @param {object|null} params.eligibilityResult
 * @param {string} params.rawUserMessage
 * @returns {Promise<string>}
 */
async function composeReply({
  action,
  state,
  missingField,
  tableMinimum,
  eligibilityResult,
  rawUserMessage,
}) {
  const gender = state.detected_gender || 'neutral';

  // ── Deterministic templates first ──

  switch (action) {
    case 'answer_question': {
      const faqReply = _answerVenueQuestion(rawUserMessage, gender);
      if (faqReply) return faqReply;
      break; // Fall through to LLM for unknown questions
    }

    case 'confirm':
      if (state.lead_type === 'guestlist') return guestlistConfirmation(state);
      if (state.lead_type === 'table') return tableConfirmation(state, tableMinimum);
      break;

    case 'approve_guestlist':
      return guestlistApprovalAfterHandoff(state);

    case 'push_table': {
      const tMin = tableMinimum || getTableMinimum(state.group_size || state.guys || 3, state.night_type);
      return pushTableAfterHandoff(tMin, state);
    }

    case 'reject':
      return rejectionMessage(state);

    case 'birthday_acknowledgement':
      return getBirthdayResponse(gender);

    case 'rapport':
      return getRapportOpener(gender);

    case 'objection': {
      const objectionReply = getObjectionResponse(rawUserMessage, gender);
      if (objectionReply) return objectionReply;
      break; // Fall through to LLM
    }

    case 'ask_question': {
      const promptFn = QUESTION_PROMPTS[missingField];
      if (promptFn) return promptFn(state);
      break; // Fall through to LLM
    }
  }

  // ── LLM fallback for unhandled cases ──
  return _llmCompose({ action, state, missingField, tableMinimum, rawUserMessage });
}

// ─── VENUE FAQ ANSWERS ────────────────────────────────────────────────────────

function _answerVenueQuestion(rawUserMessage, gender) {
  const lower = rawUserMessage.toLowerCase();
  const isMale = gender === 'male';

  if (lower.includes('dress code') || lower.includes('wear') || lower.includes('outfit') || lower.includes('attire')) {
    return isMale
      ? `Dress code is smart wear bro 👀 Keep it clean`
      : `Dress code is elegant and heels darling 👀 Keep it classy 🥂`;
  }

  if (lower.includes('entry') || lower.includes('how much') || lower.includes('price') || lower.includes('cost') || lower.includes('free')) {
    return isMale
      ? `Entry is £${require('../policy/reign').REIGN.entry_fee} bro. Once you're inside you're good 🕺`
      : `Entry is £${require('../policy/reign').REIGN.entry_fee} darling. Once you're inside I've got you 🥂`;
  }

  if (lower.includes('time') || lower.includes('when') || lower.includes('arrive') || lower.includes('arrival')) {
    return isMale
      ? `Get there by 11pm bro 👀 Don't leave it too late`
      : `Get there by 11pm darling 👀 Ideal is 11:30pm at the latest`;
  }

  if (lower.includes('address') || lower.includes('where') || lower.includes('location')) {
    return `215 Piccadilly, London 📱 Right in the heart of Mayfair`;
  }

  if (lower.includes('id') || lower.includes('identification') || lower.includes('passport')) {
    return isMale
      ? `Physical ID is required bro 👀 Picture of your passport on your phone works too`
      : `Physical ID is required darling 👀 Picture of your passport on your phone works too`;
  }

  if (lower.includes('age') || lower.includes('how old') || lower.includes('18')) {
    return isMale
      ? `18+ strictly bro 👀 Bring valid ID or you won't get in`
      : `18+ strictly darling 👀 Bring valid ID they're strict on the door`;
  }

  if (lower.includes('tonight') || lower.includes('good tonight') || lower.includes('worth') || lower.includes('active')) {
    return isMale
      ? `Yes ofc bro tonight is active 🕺 How many of you?`
      : `Yes ofc darling tonight is perfect 😏 How many of you?`;
  }

  if (lower.includes('parking') || lower.includes('uber') || lower.includes('transport') || lower.includes('tube')) {
    return `Nearest tube is Piccadilly Circus 📱 Uber drops right outside`;
  }

  // Generic question — let LLM handle it
  return null;
}

async function _llmCompose({ action, state, missingField, tableMinimum, rawUserMessage }) {
  const systemPrompt = buildSystemPrompt(state);

  const contextLines = [
    `Action needed: ${action}`,
    missingField ? `Missing info: ${missingField}` : null,
    tableMinimum ? `Table minimum: ${tableMinimum.label}` : null,
    `Lead type: ${state.lead_type}`,
    `Group: ${state.guys ?? '?'} guys, ${state.girls ?? '?'} girls`,
    `Night: ${state.night_type || 'unknown'}`,
    `Guest message: "${rawUserMessage}"`,
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contextLines },
  ];

  const raw = await callLLM(messages, { maxTokens: 150, temperature: 0.75 });
  return stripBannedPhrases(raw);
}

module.exports = { composeReply, stripBannedPhrases };

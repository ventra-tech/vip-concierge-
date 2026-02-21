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
    ? 'Casual and confident. Use "bro", "dw", "ofc". Short, direct.'
    : state.detected_gender === 'female'
      ? 'Charming and warm. Use "darling", "girls", "x". Slightly more expressive.'
      : 'Confident and premium. No "bro" or "darling". Use 😏 🥂 👀';

  return `You are Sanad. You speak in first person ALWAYS. You are a London nightlife host managing Instagram DMs for Reign, a premium Mayfair club.

TONE: ${tone}

RULES:
- 1–3 lines maximum. Never longer.
- 1–2 emojis max. Only use: ❤️‍🔥 🕺 🥂 👀 🫠 🍾 📲 😏
- Never say you are AI, an assistant, or mention Sanad in third person
- Never say "unfortunately", "kindly", "please note", "dear customer"
- Sound natural, human, premium — like a real Mayfair host texting
- You say things like: "I've got you", "I'll sort you", "Text me when you arrive"
- Move the conversation forward — qualify, approve, confirm, done`;
}

// ─── ASK QUESTION PROMPTS ─────────────────────────────────────────────────────

const QUESTION_PROMPTS = {
  lead_type: (state) => state.detected_gender === 'male'
    ? `What you looking for bro — guestlist or a table? 😏`
    : `What you looking for — guestlist or a table? 😏`,

  group_composition: (state) => state.detected_gender === 'male'
    ? `Yes ofc bro 😏 How many guys and how many girls?`
    : `Of course 🥂 How many of you and is it all girls?`,

  guys_count: () => `How many guys in the group?`,
  girls_count: () => `And how many girls?`,

  night_type: (state) => state.detected_gender === 'male'
    ? `What night are you looking at bro?`
    : `What night are you thinking darling?`,

  group_size: (state) => state.detected_gender === 'male'
    ? `Love that 🍾 What night you looking to book and how many of you?`
    : `Love that 🍾 What night you thinking and how many in your group?`,

  full_names: (state) => state.detected_gender === 'female'
    ? `Send me full names with Instagrams and I'll put you girls through on my Guestlist for @ldnreign 🥂`
    : `Send me your full names + Instagram @ and I'll lock you in ❤️‍🔥`,

  instagram_handles: () => `And your Instagram @ ?`,

  full_name_for_table: (state) => {
    const tableMin = state.group_size ? getTableMinimum(state.group_size, state.night_type) : null;
    const minText = tableMin ? ` Min spending ${tableMin.label}.` : '';
    return `Easy ❤️ I can do a table for you.${minText} Send me your full name and I'll book it under your name`;
  },
};

// ─── RAPPORT OPENERS ──────────────────────────────────────────────────────────

const RAPPORT_OPENERS = {
  male: [
    `Hey bro 😏 What you looking for tonight?`,
    `What you thinking bro — table or guestlist? 🥂`,
    `Wagwan 😏 What can I sort for you?`,
  ],
  female: [
    `Heyy darling 🥂 What can I sort for you?`,
    `Hey gorgeous, what are you looking for tonight? 😏`,
    `Heyy! What you thinking — guestlist or something more VIP? 🍾`,
  ],
  neutral: [
    `Hey 😏 What can I sort for you?`,
    `What you looking for tonight? 🥂`,
    `Hey, what are you after — guestlist or a table? 😏`,
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

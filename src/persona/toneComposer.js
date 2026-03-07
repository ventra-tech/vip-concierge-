/**
 * persona/toneComposer.js
 * LLM-first response composer. The LLM handles all natural conversation.
 * Templates are only used for booking confirmations where exact data accuracy is required.
 */

const { callLLM } = require('../llm/provider');
const {
  guestlistConfirmation,
  tableConfirmation,
  guestlistApprovalAfterHandoff,
  pushTableAfterHandoff,
  rejectionMessage,
} = require('../templates/confirmations');
const { getTableMinimum, REIGN } = require('../policy/reign');

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

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(state) {
  const gender = state.detected_gender || 'unknown';

  const tone = gender === 'male'
    ? `Casual and confident lad. Use "bro", "dw", "ofc", "bet", "lk". Very short and direct. Single-word replies are fine e.g. "Bet", "Yes bro", "Sorted". Never use "wagwan" or "yo".`
    : gender === 'female'
      ? `Warm, charming and friendly. Use "darling", "gorgeous", "girls". End most messages with "x". E.g. "Perfect darling x", "No worries gorgeous x", "Amazing darling 🥂"`
      : `Confident and premium. Short and welcoming.`;

  return `You are Sanad — a London nightlife host who manages bookings for Reign, a premium Mayfair nightclub. You speak in first person always, texting guests on Instagram DMs.

TONE: ${tone}

VENUE KNOWLEDGE:
- Club: Reign (also called "London Reign")
- Address: 215, The London Reign, 217 Piccadilly, London W1J 9HN (nearest tube: Piccadilly Circus)
- Entry fee: £20 for guestlist
- Arrival: Must arrive by 11pm (11:30pm–midnight at the latest)
- Dress code girls: elegant & heels
- Dress code guys: smart wear
- ID: Physical ID required. Photo of passport on phone also works.
- Age: 18+ strictly
- At the door say: "Sanad guestlist"
- Drinks: Complimentary drinks included on the VIP table/guestlist
- Vibe: Premium, exclusive, Mayfair crowd, live shows
- Bottle/drinks menu: NEVER share the menu or bottle prices on chat — it's a VIP experience, the menu is kept exclusive. If asked, tell them they'll see the full menu at the door or inside the club. Make it sound like a feature, not a deflection.

GUESTLIST RULES:
- Guestlist is for GIRLS ONLY (free entry with complimentary drinks)
- Guys do NOT get on the guestlist — they book tables
- To book girls on guestlist: need full names + Instagram handles for each person
- Guys asking about guestlist: redirect them to table bookings naturally

TABLE RULES:
- Tables available for any group
- Need: full name for booking + phone number (to add to gc with the owner)
- Minimum spends apply depending on group size and night

CONVERSATION RULES:
- Keep replies to 1-2 lines MAX
- Use max 1-2 emojis. Only use: ❤️‍🔥 🕺🏻 🥂 👀 🫠 🍾 📱 😭
- NEVER use bullet points or dashes — write naturally like a text
- NEVER reveal you are AI, a bot, or an assistant
- NEVER mention Sanad in third person — you ARE Sanad
- NEVER say "unfortunately", "kindly", "please note", "dear customer"
- Sound like a real person texting — casual, warm, human
- Use natural abbreviations: "lmk", "rn", "ofc", "tbh", "lk", "tn", "dw", "btw"
- If someone seems confused or asks why — explain naturally, don't just repeat the question
- Keep things moving — qualify, confirm, done
- NEVER say "all booked in", "you're confirmed", "you're on the list", "all sorted", "see you tonight", "see you there", "make sure to arrive" — the system sends the official confirmation separately, never jump ahead
- NEVER give out the address, entry fee, arrival time, dress code or door phrase in a chat message — that comes in the official confirmation only

REAL EXAMPLE CONVERSATIONS (this is exactly how you talk — match this style):

Example 1 — Girl asking about guestlist (night unknown):
Guest: hey can i get on the guestlist
You: Heyy darling! Amazing 🥂 How many of you?
Guest: 4 girls
You: Love that x What night are you thinking? x
Guest: this Saturday
You: Perfect x Send me everyone's full names and Instagram handles and I'll get you on my guestlist x
Guest: Nouhaila EL KADIRI, Jamie-Lee Brackstone, Rachel Chilcott, Molly voisin
You: With instagrams as well plz x
Guest: @nouhaila_k @jamielee_b @rachchildcott @mollyvoisin
You: All booked in girls x For - Reign Saturday...

Example 1b — Girl who mentions the night upfront:
Guest: hey can i get on the guestlist for tonight
You: Heyy darling! Amazing 🥂 How many of you?
Guest: 4 girls
You: Perfect darling x Send me everyone's full names and Instagram handles and I'll get you on my guestlist for tonight x
Guest: Nouhaila EL KADIRI, Jamie-Lee Brackstone, Rachel Chilcott, Molly voisin
You: With instagrams as well plz x
Guest: @nouhaila_k @jamielee_b @rachchildcott @mollyvoisin
You: All booked in girls x For - Reign tonight...

Example 2 — Girl asking about entry fee:
Guest: is entry free?
You: The entry is the only thing you pay for
You: Your drinks are complimentary all night and you get to see all exclusive shows on my vip table And party with the best in Mayfair x

Example 3 — Girl not ready to book:
Guest: maybe another time
You: No worries gorgeous x Hit me up if you change your mind

Example 4 — Birthday group:
Guest: it's my birthday this weekend!
You: Amazing darling 🥂 I got a surprise for you girls!

Example 5 — Guy asking about table:
Guest: yo can i book a table
You: Yes bro ofc 🕺🏻 How many of you?
Guest: 5 of us
You: Easy ❤️‍🔥 Send me your full name for the booking and your number as well
Guest: Josh Williams 07712345678
You: Sorted bro I'll add you to the gc with the owner now 🍾

Example 6 — Guy with quality doubts:
Guest: is it even worth it
You: Dw bro i got you
You: Please bro i got quality 😏

Example 7 — Girl confused mid-booking:
Guest: wdym instagrams
You: Just your Instagram handles darling so I can verify you on the door x

Example 8 — Mixed group:
Guest: there's 3 guys and 2 girls
You: So for the guys it'll be a table booking bro. How many in total?

Example 9 — Guy asking about bottle prices:
Guest: how much are the bottles?
You: That's something you'll see on the night bro 🕺🏻 It's a VIP setup — you won't be disappointed trust

Example 10 — Girl asking about the drinks menu:
Guest: can you send me the menu?
You: We keep the menu exclusive darling x You'll see everything when you're inside — it's all VIP 🥂`;

}

// ─── INSTRUCTION BUILDER ──────────────────────────────────────────────────────
// Tells the LLM exactly what it needs to do next, in plain English.
// Includes a context summary of what's already been collected so the LLM
// can handle mid-flow curveballs naturally.

function buildInstruction(action, missingField, state, tableMinimum) {
  const night = state.night_type === 'weekend' ? 'this weekend'
    : state.night_type === 'weekday' ? 'this weekday'
    : state.night_type || 'tonight';

  const isMale = state.detected_gender === 'male';
  const isFemale = state.detected_gender === 'female';

  // ── Build a plain-English summary of what's already known ──
  const knownParts = [];
  if (state.lead_type) knownParts.push(`they want a ${state.lead_type}`);
  if (state.group_size) knownParts.push(`group of ${state.group_size}`);
  if (state.guys != null) knownParts.push(`${state.guys} guy(s)`);
  if (state.girls != null) knownParts.push(`${state.girls} girl(s)`);
  if (state.night_type) knownParts.push(`coming ${night}`);
  if (state.full_name) knownParts.push(`name: ${state.full_name}`);
  if (state.phone_number) knownParts.push(`phone: ${state.phone_number}`);
  if (state.collected_names && state.collected_names.length > 0) {
    knownParts.push(`names collected: ${state.collected_names.join(', ')}`);
  }
  if (state.collected_handles && state.collected_handles.length > 0) {
    knownParts.push(`handles collected: ${state.collected_handles.join(', ')}`);
  }
  const context = knownParts.length > 0
    ? `What you already know: ${knownParts.join(', ')}. `
    : '';

  switch (action) {
    case 'rapport':
      // Only reaches LLM when status === 'confirmed' (post-booking chat).
      // The opening turn is handled by the hardcoded block in composeReply.
      return `The booking is already confirmed and complete. The guest is just saying thanks or chatting. Respond with a short, warm closing — like "Amazing see you there! x" or "Can't wait 🥂". Do NOT repeat booking details or send any confirmation info.`;

    case 'ask_question':
      switch (missingField) {
        case 'lead_type':
          if (isMale) return `${context}The guest hasn't said what they want yet. For guys, guestlist is girls-only — naturally steer them towards a table. Ask if they're looking to book a table. Keep it casual, one line.`;
          return `${context}Ask if they want guestlist or a table. Keep it short.`;

        case 'group_size': {
          if (state.male_guestlist_redirect) {
            return isMale
              ? `${context}The guest asked about guestlist but guestlist is girls only. Explain this naturally and let them know you can sort them a table no problem. Ask how many are coming in total.`
              : `${context}The guest asked about guestlist but this is a mixed group. Explain guestlist is girls only and you can sort a table for the group instead. Ask how many are coming in total.`;
          }
          return `${context}Ask how many people are coming. One short question only.`;
        }

        case 'night_type': {
          const isSecondAsk = (state.night_type_asks || 0) >= 2;
          if (isSecondAsk && state.lead_type === 'table' && state.group_size) {
            const weekendMin = getTableMinimum(state.group_size, 'weekend');
            const weekdayMin = getTableMinimum(state.group_size, 'weekday');
            if (weekdayMin.min !== weekendMin.min) {
              return `${context}They haven't confirmed the night yet. Let them know the min spend is ${weekdayMin.label} on a weekday or ${weekendMin.label} on a weekend, and ask which they're leaning towards. Casual and short.`;
            }
          }
          return `${context}Ask what night they're planning to come. Short and casual — something like "What night are you thinking?" Do NOT ask for names or phone number yet.`;
        }

        case 'full_names':
          return `${context}They're interested in guestlist for ${night}. Ask for everyone's full names and Instagram handles so you can get them on the guestlist.`;

        case 'instagram_handles':
          return `${context}You have their names but still need their Instagram handles. Ask for those — it's needed to verify them on the door.`;

        case 'full_name_for_table': {
          const tMin = tableMinimum || (state.group_size ? getTableMinimum(state.group_size, state.night_type) : null);
          const minText = tMin
            ? `You MUST tell them the minimum spend is ${tMin.label} — this is critical info they need before committing. Then ask for their full name and UK phone number (+44 or 07xxx) in the same message.`
            : `Ask for their full name for the booking and their UK phone number (+44 or 07xxx). Ask for both in one message.`;
          return `${context}They're ready to book a table. ${minText}`;
        }

        case 'phone_number': {
          const nameStr = state.full_name ? `You already have their name (${state.full_name}). ` : '';
          return `${context}${nameStr}Still need their UK phone number to add them to the group chat with the owner. Ask for it — mention UK numbers only (+44 or 07xxx).`;
        }

        default:
          return `${context}Continue naturally and gather the missing info: ${missingField}.`;
      }

    case 'answer_question':
      return `The guest has a question about the venue. Answer it accurately based on your venue knowledge. Keep it short and natural.`;

    case 'objection':
      return `The guest has an objection or concern. Address it naturally in your own voice — be reassuring, keep it real, keep it short.`;

    case 'birthday_acknowledgement':
      return `The guest mentioned a birthday or special occasion. Respond with genuine excitement — make them feel special.`;

    default:
      return `Continue the conversation naturally based on the context.`;
  }
}

// ─── MAIN COMPOSE FUNCTION ────────────────────────────────────────────────────

async function composeReply({
  action,
  state,
  missingField,
  tableMinimum,
  eligibilityResult,
  rawUserMessage,
}) {
  // ── Templates ONLY for booking confirmations — exact data accuracy required ──
  switch (action) {
    case 'confirm':
      if (state.lead_type === 'guestlist') return guestlistConfirmation(state);
      if (state.lead_type === 'table') return tableConfirmation(state, tableMinimum);
      break;

    // ── Hardcoded rapport opener — LLM has zero context on turn 1 ──
    case 'rapport': {
      if (state.status !== 'confirmed') {
        const gender = state.detected_gender;
        const maleOpeners = [
          `Alright bro 🕺🏻 you came to the right place trust. What's the occasion?`,
          `Hey bro 🔥 good timing. What's the occasion?`,
        ];
        const femaleOpeners = [
          `Heyy gorgeous 🥂 you came to the right place trust me. What's the occasion? x`,
          `Heyyy darling 🥂 so glad you reached out. What's the occasion? x`,
        ];
        const neutralOpeners = [
          `Alright 🕺🏻 you came to the right place trust. What's the occasion?`,
          `Hey 🔥 good timing. What's the occasion?`,
        ];
        const pool = gender === 'male' ? maleOpeners : gender === 'female' ? femaleOpeners : neutralOpeners;
        return pool[Math.floor(Math.random() * pool.length)];
      }
      break;
    }

    // ── Post-handoff Sanad actions — these need to be precise ──
    case 'approve_guestlist':
      return guestlistApprovalAfterHandoff(state);

    case 'push_table': {
      const tMin = tableMinimum || getTableMinimum(state.group_size || state.guys || 3, state.night_type);
      return pushTableAfterHandoff(tMin, state);
    }

    case 'reject':
      return rejectionMessage(state);
  }

  // ── Everything else — LLM with full conversation history and rich instruction ──
  return _llmCompose({ action, state, missingField, tableMinimum, rawUserMessage });
}

// ─── LLM COMPOSER ────────────────────────────────────────────────────────────

async function _llmCompose({ action, state, missingField, tableMinimum, rawUserMessage }) {
  const systemPrompt = buildSystemPrompt(state);
  const instruction = buildInstruction(action, missingField, state, tableMinimum);

  const fullSystem = `${systemPrompt}

YOUR NEXT TASK: ${instruction}`;

  // Build message thread with conversation history
  const messages = [{ role: 'system', content: fullSystem }];

  const history = state.conversation_history || [];
  if (history.length > 0) {
    // Last 12 turns for context (6 back-and-forths)
    history.slice(-12).forEach(msg => messages.push({ role: msg.role, content: msg.content }));
  } else {
    messages.push({ role: 'user', content: rawUserMessage });
  }

  const raw = await callLLM(messages, { maxTokens: 150, temperature: 0.6 });
  return stripBannedPhrases(raw);
}

module.exports = { composeReply, stripBannedPhrases };

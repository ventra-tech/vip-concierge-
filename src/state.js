/**
 * state.js
 * Defines the conversation state shape and factory function.
 * State is created fresh per subscriber and updated every turn.
 */

/**
 * @typedef {Object} ConversationState
 * @property {string} subscriberId        - ManyChat subscriber ID (key for session store)
 * @property {'guestlist'|'table'|'unknown'} lead_type
 * @property {'girls'|'guys'|'mixed'|'unknown'} gender_mix
 * @property {number|null} group_size
 * @property {number|null} girls
 * @property {number|null} guys
 * @property {'weekday'|'weekend'|null} night_type
 * @property {'reign'} venue
 * @property {number|null} budget
 * @property {string|null} arrival_time
 * @property {'qualifying'|'approved'|'confirmed'|'handoff'|'closed'} status
 * @property {string|null} handoff_reason
 * @property {'text'|'image'|'voice'|'video'} last_user_message_type
 * @property {boolean} paused             - True when handoff is active, AI stops responding
 * @property {string[]} collected_names   - Full names collected so far
 * @property {string[]} collected_instagrams - Instagram handles collected
 * @property {string|null} phone_number   - Phone number for table bookings
 * @property {number} turn_count          - How many messages exchanged
 * @property {string|null} detected_gender - 'male'|'female'|'neutral'
 * @property {string|null} last_intent    - Last classified intent
 */

/**
 * Creates a fresh conversation state for a new subscriber.
 * @param {string} subscriberId
 * @returns {ConversationState}
 */
function createState(subscriberId) {
  return {
    subscriberId,
    lead_type: 'unknown',
    gender_mix: 'unknown',
    group_size: null,
    girls: null,
    guys: null,
    night_type: null,
    night_label: null,       // Human-readable night label e.g. "Friday", "Tonight (Saturday)"
    venue: 'reign',
    budget: null,
    arrival_time: null,
    status: 'qualifying',
    handoff_reason: null,
    last_user_message_type: 'text',
    paused: false,
    collected_names: [],
    collected_instagrams: [],
    phone_number: null,
    turn_count: 0,
    detected_gender: null,
    last_intent: null,
    conversation_history: [], // Array of { role: 'user'|'assistant', content: string }
    username: null,
    first_name: null,
    night_type_asks: 0, // How many times we've asked for night_type — anti-loop counter
    estimated_value: null,
    last_holding_index: -1, // Tracks holding message rotation when paused
    male_guestlist_redirect: false, // Male asked about guestlist — collect table info then handoff to Sanad
    last_message_text: null,        // Dedup guard: text of last processed message
    last_message_at: null,          // Dedup guard: epoch ms of last processed message
  };
}

/**
 * Merges partial updates into an existing state immutably.
 * @param {ConversationState} currentState
 * @param {Partial<ConversationState>} updates
 * @returns {ConversationState}
 */
function updateState(currentState, updates) {
  return { ...currentState, ...updates, turn_count: currentState.turn_count + 1 };
}

module.exports = { createState, updateState };

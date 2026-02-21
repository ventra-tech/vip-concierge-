/**
 * sessionStore.js
 * In-memory session store keyed by ManyChat subscriber ID.
 * Each subscriber gets their own isolated conversation state.
 *
 * For production at scale, swap the Map for Redis or a DB.
 * The interface (get/set/delete/has) stays the same.
 */

const { createState } = require('./state');

// In-memory store: subscriberId -> ConversationState
const store = new Map();

// Session TTL: 2 hours of inactivity clears the session
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ttlTimers = new Map();

/**
 * Get or create a session for a subscriber.
 * @param {string} subscriberId
 * @returns {import('./state').ConversationState}
 */
function getSession(subscriberId) {
  if (!store.has(subscriberId)) {
    store.set(subscriberId, createState(subscriberId));
  }
  _refreshTTL(subscriberId);
  return store.get(subscriberId);
}

/**
 * Save updated state back to the store.
 * @param {string} subscriberId
 * @param {import('./state').ConversationState} state
 */
function saveSession(subscriberId, state) {
  store.set(subscriberId, state);
  _refreshTTL(subscriberId);
}

/**
 * Delete a session (e.g. after booking confirmed or conversation closed).
 * @param {string} subscriberId
 */
function deleteSession(subscriberId) {
  store.delete(subscriberId);
  if (ttlTimers.has(subscriberId)) {
    clearTimeout(ttlTimers.get(subscriberId));
    ttlTimers.delete(subscriberId);
  }
}

/**
 * Check if a session exists.
 * @param {string} subscriberId
 * @returns {boolean}
 */
function hasSession(subscriberId) {
  return store.has(subscriberId);
}

/**
 * Resume a paused session (after Sanad completes handoff).
 * @param {string} subscriberId
 * @param {Partial<import('./state').ConversationState>} resumeData
 * @returns {import('./state').ConversationState}
 */
function resumeSession(subscriberId, resumeData = {}) {
  const state = getSession(subscriberId);
  const resumed = {
    ...state,
    paused: false,
    status: resumeData.status || 'qualifying',
    handoff_reason: null,
    ...resumeData,
  };
  saveSession(subscriberId, resumed);
  return resumed;
}

/**
 * Get total active session count (useful for monitoring).
 * @returns {number}
 */
function activeSessionCount() {
  return store.size;
}

// Internal: reset TTL timer for a subscriber
function _refreshTTL(subscriberId) {
  if (ttlTimers.has(subscriberId)) {
    clearTimeout(ttlTimers.get(subscriberId));
  }
  const timer = setTimeout(() => {
    store.delete(subscriberId);
    ttlTimers.delete(subscriberId);
    console.log(`[sessionStore] Session expired for subscriber: ${subscriberId}`);
  }, SESSION_TTL_MS);
  // Allow Node to exit even if timers are pending
  if (timer.unref) timer.unref();
  ttlTimers.set(subscriberId, timer);
}

module.exports = {
  getSession,
  saveSession,
  deleteSession,
  hasSession,
  resumeSession,
  activeSessionCount,
};

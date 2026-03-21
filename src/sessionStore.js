/**
 * sessionStore.js
 * Redis-backed session store using Upstash.
 * Sessions persist across Railway restarts and deployments.
 *
 * TTL: 90 days of inactivity — returning customers are remembered long-term.
 */

const { Redis } = require('@upstash/redis');
const { createState } = require('./state');

// ── Redis client ──────────────────────────────────────────────────────────────
// Falls back to in-memory Map if Upstash env vars are not set (local dev)
let redis = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('[sessionStore] ✅ Using Upstash Redis for session persistence');
} else {
  console.warn('[sessionStore] ⚠️  No Upstash credentials found — falling back to in-memory store');
}

// Fallback in-memory store for local dev
const _memoryStore = new Map();

// Session TTL: 90 days in seconds
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;

// Key prefix — keeps session keys namespaced
const KEY = (subscriberId) => `session:${subscriberId}`;

// ── Core helpers ──────────────────────────────────────────────────────────────

async function _get(subscriberId) {
  if (redis) {
    const data = await redis.get(KEY(subscriberId));
    return data || null;
  }
  return _memoryStore.get(subscriberId) || null;
}

async function _set(subscriberId, state) {
  if (redis) {
    await redis.set(KEY(subscriberId), state, { ex: SESSION_TTL_SECONDS });
  } else {
    _memoryStore.set(subscriberId, state);
  }
}

async function _del(subscriberId) {
  if (redis) {
    await redis.del(KEY(subscriberId));
  } else {
    _memoryStore.delete(subscriberId);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get or create a session for a subscriber.
 * @param {string} subscriberId
 * @returns {Promise<import('./state').ConversationState>}
 */
async function getSession(subscriberId) {
  const existing = await _get(subscriberId);
  if (existing) return existing;
  const fresh = createState(subscriberId);
  await _set(subscriberId, fresh);
  return fresh;
}

/**
 * Save updated state back to the store.
 * @param {string} subscriberId
 * @param {import('./state').ConversationState} state
 */
async function saveSession(subscriberId, state) {
  await _set(subscriberId, state);
}

/**
 * Delete a session.
 * @param {string} subscriberId
 */
async function deleteSession(subscriberId) {
  await _del(subscriberId);
}

/**
 * Check if a session exists.
 * @param {string} subscriberId
 * @returns {Promise<boolean>}
 */
async function hasSession(subscriberId) {
  if (redis) {
    const data = await redis.get(KEY(subscriberId));
    return data !== null;
  }
  return _memoryStore.has(subscriberId);
}

/**
 * Resume a paused session after Sanad completes a handoff.
 * @param {string} subscriberId
 * @param {Partial<import('./state').ConversationState>} resumeData
 * @returns {Promise<import('./state').ConversationState>}
 */
async function resumeSession(subscriberId, resumeData = {}) {
  const state = await getSession(subscriberId);
  const resumed = {
    ...state,
    paused: false,
    status: resumeData.status || 'qualifying',
    handoff_reason: null,
    ...resumeData,
  };
  await saveSession(subscriberId, resumed);
  return resumed;
}

/**
 * Get total active session count (Redis version returns 0 — use Upstash dashboard).
 * @returns {Promise<number>}
 */
async function activeSessionCount() {
  if (!redis) return _memoryStore.size;
  return 0; // Use Upstash dashboard for monitoring
}

module.exports = {
  getSession,
  saveSession,
  deleteSession,
  hasSession,
  activeSessionCount,
  resumeSession,
};

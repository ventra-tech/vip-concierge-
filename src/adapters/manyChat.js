/**
 * adapters/manyChat.js
 * Parses incoming ManyChat webhook payloads and formats outgoing responses.
 * All ManyChat-specific field names live here — nowhere else in the codebase.
 */

const config = require('../config');

// ─── INBOUND: Parse ManyChat Webhook Payload ─────────────────────────────────

/**
 * Extract the standardised input object from a raw ManyChat webhook body.
 * ManyChat sends different field names depending on version — we handle both.
 *
 * @param {object} body - req.body from the webhook
 * @returns {{
 *   subscriberId: string,
 *   messageText: string,
 *   messageType: string,
 *   firstName: string,
 *   lastName: string,
 *   username: string,
 *   rawPayload: object
 * }}
 */
function parseIncomingPayload(body) {
  // Support both flat and nested ManyChat payload formats
  // Also handles ManyChat's actual field names: contactId, userinput
  const subscriber = body.subscriber || body.contact || body;

  // ManyChat sends contactId as the subscriber ID
  const subscriberId =
    String(body.contactId || body.subscriber_id || body.id || subscriber?.id || 'unknown');

  // ManyChat sends the message text as userinput
  const message = body.userinput || body.message || body.last_input_text || body.text || '';
  const messageText =
    typeof message === 'string'
      ? message
      : message?.text || message?.last_input_text || '';

  // Detect message type
  let messageType = body.message_type || body.type || message?.type || 'text';
  if (messageType === 'audio') messageType = 'voice';
  if (messageText === '__voice_note__') messageType = 'voice';

  // Best-effort voice note heuristic detection
  // ManyChat transcribes voice notes — we look for patterns almost never typed
  if (messageType === 'text' && messageText) {
    messageType = _guessIfVoiceNote(messageText) ? 'voice' : messageType;
  }

  const firstName =
    body.first_name || subscriber?.first_name || '';

  const lastName =
    body.last_name || subscriber?.last_name || '';

  const username =
    body.username || subscriber?.username || subscriber?.instagram_username || '';

  return {
    subscriberId,
    messageText,
    messageType,
    firstName,
    lastName,
    username,
    rawPayload: body,
  };
}

// ─── OUTBOUND: Format Reply for ManyChat API ──────────────────────────────────

/**
 * Send a text message reply via ManyChat's Send Message API.
 * @param {string} subscriberId
 * @param {string} text
 * @returns {Promise<object>} ManyChat API response
 */
async function sendTextMessage(subscriberId, text) {
  // Instagram DMs use /instagram/sending/sendContent (not /fb/)
  // No message_tag — that's Facebook Messenger only
  const url = `${config.manyChat.apiBase}/instagram/sending/sendContent`;

  const body = {
    subscriber_id: subscriberId,
    data: {
      version: 'v2',
      content: {
        messages: [
          {
            type: 'text',
            text,
          },
        ],
      },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.manyChat.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ManyChat API error ${response.status}: ${err}`);
  }

  return response.json();
}

/**
 * Set a custom field value on a ManyChat subscriber.
 * Useful for storing state flags like "paused" or "handoff_active".
 * @param {string} subscriberId
 * @param {string} fieldId - ManyChat custom field ID
 * @param {string|number|boolean} value
 * @returns {Promise<object>}
 */
async function setCustomField(subscriberId, fieldId, value) {
  const url = `${config.manyChat.apiBase}/fb/subscriber/setCustomField`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.manyChat.apiKey}`,
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      field_id: fieldId,
      field_value: value,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ManyChat setCustomField error ${response.status}: ${err}`);
  }

  return response.json();
}

/**
 * Format a webhook response object that n8n's "Respond to Webhook" node can use.
 * This is the JSON n8n sends back to ManyChat if using the inline response approach.
 * @param {string} replyText
 * @returns {object}
 */
function formatWebhookResponse(replyText) {
  return {
    version: 'v2',
    content: {
      messages: [
        {
          type: 'text',
          text: replyText,
        },
      ],
    },
  };
}

// ─── VOICE NOTE HEURISTIC ─────────────────────────────────────────────────────

/**
 * Best-effort guess at whether a transcribed message was a voice note.
 * Uses patterns that are almost never typed but common in voice transcriptions.
 * Will have some false positives — acceptable tradeoff.
 *
 * @param {string} text
 * @returns {boolean}
 */
function _guessIfVoiceNote(text) {
  const lower = text.trim().toLowerCase();
  const words = lower.split(/\s+/);

  // Rule 1: Contains filler sounds with 3+ repeated letters
  // e.g. "urrrm", "errr", "ummmm", "hmmm", "ahhhh"
  if (/\b(u+r+m+|e+r+r+|u+m+|h+m+|a+h+|e+h+|o+h+)\b/.test(lower) && words.length <= 4) {
    return true;
  }

  // Rule 2: Single word that is pure filler sound (3+ chars of repeated pattern)
  if (words.length === 1 && /^([a-z])\1{2,}$/.test(lower)) {
    return true;
  }

  // Rule 3: Very short message containing ONLY filler words
  const FILLER_ONLY = ['um', 'uh', 'er', 'hmm', 'hm', 'ah', 'oh', 'erm'];
  if (words.length <= 2 && words.every(w => FILLER_ONLY.includes(w))) {
    return true;
  }

  return false;
}

module.exports = {
  parseIncomingPayload,
  sendTextMessage,
  setCustomField,
  formatWebhookResponse,
};

/**
 * adapters/instagram.js
 * Parses incoming Instagram webhook payloads and sends replies via the Graph API.
 * All Instagram-specific field names live here — nowhere else in the codebase.
 *
 * Replaces adapters/manyChat.js when running on the instagram-api branch.
 */

const config = require('../config');

// ─── INBOUND: Parse Instagram Webhook Messaging Event ────────────────────────

/**
 * Extract the standardised input object from a single Instagram messaging event.
 * Instagram sends one event per message inside entry[].messaging[].
 *
 * @param {object} event - A single entry from entry[].messaging[]
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
function parseIncomingPayload(event) {
  const subscriberId = String(event?.sender?.id || 'unknown');

  // Detect message type from attachments
  let messageType = 'text';
  const attachments = event?.message?.attachments || [];
  if (attachments.length > 0) {
    const attachType = attachments[0]?.type || '';
    if (attachType === 'audio') messageType = 'voice';
    else if (attachType === 'image') messageType = 'image';
    else if (attachType === 'video') messageType = 'video';
    else messageType = attachType || 'unknown';
  }

  const messageText = event?.message?.text || '';

  // Instagram doesn't include name/username in the webhook event.
  // These would require a separate Graph API call — left empty for now.
  // The bot handles missing names gracefully through the conversation flow.
  const firstName = '';
  const lastName = '';
  const username = '';

  // Normalise rawPayload so the router's detectMessageType() works correctly.
  // It reads payload.message_type or payload.type — we set both here.
  const rawPayload = {
    ...event,
    message_type: messageType,
    type: messageType,
  };

  return {
    subscriberId,
    messageText,
    messageType,
    firstName,
    lastName,
    username,
    rawPayload,
  };
}

// ─── OUTBOUND: Send Message via Instagram Graph API ───────────────────────────

/**
 * Send a text message to an Instagram user via the Graph API.
 *
 * Requires:
 *   INSTAGRAM_PAGE_ACCESS_TOKEN — Page Access Token from Meta App
 *   INSTAGRAM_GRAPH_API_VERSION — e.g. v21.0 (defaults to v21.0)
 *
 * @param {string} igsid - Instagram-scoped user ID (from event.sender.id)
 * @param {string} text  - Message text to send
 * @returns {Promise<object>}
 */
async function sendTextMessage(igsid, text) {
  const token = config.instagram.pageAccessToken;
  const version = config.instagram.graphApiVersion;
  const url = `https://graph.facebook.com/${version}/me/messages?access_token=${token}`;

  const body = {
    recipient: { id: igsid },
    message: { text },
    messaging_type: 'RESPONSE',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Instagram Graph API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  console.log(`[instagram] sendTextMessage OK — igsid: ${igsid}, mid: ${result.message_id}`);
  return result;
}

// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────

/**
 * Verify the Instagram webhook during the Meta App setup.
 * Meta sends a GET request with hub.mode, hub.verify_token, hub.challenge.
 * We must respond with hub.challenge if the token matches.
 *
 * @param {string} mode      - hub.mode (should be 'subscribe')
 * @param {string} token     - hub.verify_token (must match INSTAGRAM_VERIFY_TOKEN)
 * @param {string} challenge - hub.challenge (echo this back to verify)
 * @returns {{ valid: boolean, challenge: string|null }}
 */
function verifyWebhook(mode, token, challenge) {
  const expectedToken = config.instagram.verifyToken;
  if (mode === 'subscribe' && token === expectedToken) {
    return { valid: true, challenge };
  }
  return { valid: false, challenge: null };
}

module.exports = {
  parseIncomingPayload,
  sendTextMessage,
  verifyWebhook,
};

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

  const firstName =
    body.first_name || subscriber?.first_name || '';

  const lastName =
    body.last_name || subscriber?.last_name || '';

  // Combine into full name — falls back gracefully if last name is empty
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  const username =
    body.username || subscriber?.username || subscriber?.instagram_username || '';

  return {
    subscriberId,
    messageText,
    messageType,
    firstName: fullName || firstName,  // use full name if available, else just first
    lastName,
    username,
    rawPayload: body,
  };
}

// ─── OUTBOUND: Format Reply for ManyChat API ──────────────────────────────────

/**
 * Send a text message to a subscriber.
 *
 * PRIMARY route: n8n webhook (process.env.N8N_SEND_URL)
 *   n8n already has ManyChat credentials configured — it handles auth correctly.
 *   n8n webhook should accept { subscriber_id, text } and use its ManyChat node to send.
 *
 * FALLBACK: Direct ManyChat API (only if N8N_SEND_URL is not set)
 *
 * @param {string} subscriberId
 * @param {string} text
 * @returns {Promise<object>}
 */
async function sendTextMessage(subscriberId, text) {
  // ── Primary: route through n8n (avoids ManyChat API endpoint issues) ──
  const n8nSendUrl = process.env.N8N_SEND_URL;
  if (n8nSendUrl) {
    const response = await fetch(n8nSendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriber_id: subscriberId, text }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`n8n send webhook error ${response.status}: ${err}`);
    }
    console.log(`[manyChat] sendTextMessage via n8n OK — subscriber: ${subscriberId}`);
    return { status: 'sent_via_n8n' };
  }

  // ── Fallback: direct ManyChat API ──
  // NOTE: This returns 404 on some Instagram accounts — use N8N_SEND_URL instead
  const url = `${config.manyChat.apiBase}/instagram/sending/sendContent`;

  const body = {
    subscriber_id: subscriberId,
    ...(config.manyChat.pageId ? { page_id: parseInt(config.manyChat.pageId, 10) } : {}),
    data: {
      version: 'v2',
      content: {
        messages: [{ type: 'text', text }],
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

module.exports = {
  parseIncomingPayload,
  sendTextMessage,
};

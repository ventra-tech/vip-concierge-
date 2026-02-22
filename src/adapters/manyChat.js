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

  const messageType =
    body.message_type || body.type || message?.type || 'text';

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
  const url = `${config.manyChat.apiBase}/fb/sending/sendContent`;

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
    message_tag: 'NON_PROMOTIONAL_SUBSCRIPTION',
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

module.exports = {
  parseIncomingPayload,
  sendTextMessage,
  setCustomField,
  formatWebhookResponse,
};

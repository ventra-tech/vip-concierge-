/**
 * server.js
 * Express web server — wraps processMessage() so n8n can call it via HTTP.
 *
 * Endpoints:
 *   POST /message        — main endpoint, receives ManyChat payload from n8n
 *   POST /resume         — called when Sanad makes a handoff decision
 *   GET  /health         — Railway uses this to check the server is alive
 */

require('dotenv').config();
const express = require('express');
const { processMessage, resumeFromHandoff } = require('./src/index');
const { sendTextMessage } = require('./src/adapters/manyChat');
const config = require('./src/config');

const app = express();

// Parse incoming JSON bodies
app.use(express.json());

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
// Railway pings this to confirm the server is running
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── MAIN MESSAGE ENDPOINT ────────────────────────────────────────────────────
// n8n sends the ManyChat payload here, gets back the reply
app.post('/message', async (req, res) => {
  try {
    const body = req.body;

    // Log incoming payload for debugging
    console.log('[server] /message received:', JSON.stringify(body));

    // Basic validation — support all ManyChat field names
    const subscriberId = body.contactId || body.subscriber_id || body.id;
    if (!subscriberId) {
      console.error('[server] Missing subscriber ID. Body:', JSON.stringify(body));
      return res.status(400).json({ error: 'Missing subscriber_id in payload' });
    }

    const result = await processMessage(body);

    // Return the full result to n8n
    res.json(result);

  } catch (err) {
    console.error('[server] /message error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── RESUME ENDPOINT (POST) ───────────────────────────────────────────────────
// Called programmatically with JSON body
app.post('/resume', async (req, res) => {
  try {
    const { subscriberId, decision, extra } = req.body;
    if (!subscriberId || !decision) {
      return res.status(400).json({ error: 'Missing subscriberId or decision' });
    }
    const result = await resumeFromHandoff({ subscriberId, decision, extra });
    res.json(result);
  } catch (err) {
    console.error('[server] /resume error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── RESUME ENDPOINT (GET) ────────────────────────────────────────────────────
// Called when Sanad clicks a button link in the handoff email
// URL format: /resume?subscriberId=123&decision=approve_guestlist
app.get('/resume', async (req, res) => {
  try {
    const { subscriberId, decision } = req.query;

    if (!subscriberId || !decision) {
      return res.send(_renderPage('❌ Error', 'Missing subscriberId or decision in the URL.', '#FF4444'));
    }

    const result = await resumeFromHandoff({ subscriberId, decision });

    // Actually send the reply to the customer on Instagram via ManyChat
    if (result.reply_text) {
      try {
        await sendTextMessage(subscriberId, result.reply_text);
        console.log(`[server] /resume sent message to ${subscriberId}: ${result.reply_text}`);
      } catch (sendErr) {
        console.error(`[server] /resume failed to send ManyChat message:`, sendErr.message);
      }
    }

    const decisionLabels = {
      approve_guestlist: '✅ Guestlist Approved',
      push_table: '🍾 Pushed to Table',
      reject: '❌ Rejected',
      manual_override: '👤 Manual Override — AI Paused',
      resume_ai: '🤖 AI Resumed',
    };

    const label = decisionLabels[decision] || decision;
    const replyPreview = result.reply_text
      ? `<p style="background:#f5f5f5;padding:12px;border-radius:8px;font-style:italic;">"${result.reply_text}"</p>`
      : '<p style="color:#888;">No reply sent (manual override active)</p>';

    res.send(_renderPage(
      label,
      `Decision recorded for subscriber <strong>${subscriberId}</strong>.<br><br>Message sent to customer:${replyPreview}`,
      decision === 'reject' ? '#FF4444' : '#25D366'
    ));

  } catch (err) {
    console.error('[server] /resume GET error:', err.message);
    res.send(_renderPage('❌ Error', err.message, '#FF4444'));
  }
});

// ─── MANUAL OVERRIDE ENDPOINT ─────────────────────────────────────────────────
// Sanad takes over — AI stops responding completely
app.get('/override', async (req, res) => {
  try {
    const { subscriberId } = req.query;
    if (!subscriberId) {
      return res.send(_renderPage('❌ Error', 'Missing subscriberId', '#FF4444'));
    }
    await resumeFromHandoff({ subscriberId, decision: 'manual_override' });
    res.send(_renderPage(
      '👤 Manual Override Active',
      `AI has been paused for subscriber <strong>${subscriberId}</strong>.<br>You are now in control. Reply directly on Instagram.`,
      '#FF9500'
    ));
  } catch (err) {
    res.send(_renderPage('❌ Error', err.message, '#FF4444'));
  }
});

// ─── HELPER: Render a simple confirmation page ────────────────────────────────
function _renderPage(title, message, color = '#25D366') {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${title}</title>
    </head>
    <body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center;">
      <div style="background:${color};color:white;padding:20px;border-radius:12px;margin-bottom:20px;">
        <h2 style="margin:0;">${title}</h2>
      </div>
      <p style="color:#333;font-size:16px;">${message}</p>
      <p style="color:#888;font-size:12px;margin-top:40px;">Sanad Concierge Brain</p>
    </body>
    </html>
  `;
}

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = config.server.port || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sanad Concierge Brain running on port ${PORT}`);
  console.log(`   POST /message  — main endpoint`);
  console.log(`   POST /resume   — handoff resume`);
  console.log(`   GET  /health   — health check`);
});

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

    console.log(`[server] /resume clicked — subscriberId: ${subscriberId}, decision: ${decision}`);

    const result = await resumeFromHandoff({ subscriberId, decision });

    // Send the reply to the customer on Instagram via ManyChat
    let sendStatus = 'no_message'; // manual_override case
    let sendError = null;

    if (result.reply_text && decision !== 'manual_override') {
      try {
        const mcResult = await sendTextMessage(subscriberId, result.reply_text);
        console.log(`[server] /resume ✅ ManyChat send OK for ${subscriberId}:`, JSON.stringify(mcResult));
        sendStatus = 'sent';
      } catch (sendErr) {
        sendError = sendErr.message;
        console.error(`[server] /resume ❌ ManyChat send FAILED for ${subscriberId}:`, sendErr.message);
        sendStatus = 'failed';
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

    let statusBlock;
    if (sendStatus === 'sent') {
      statusBlock = `
        <div style="background:#e6ffed;border:1px solid #25D366;border-radius:8px;padding:12px;margin:12px 0;">
          <strong>✅ Message delivered to customer</strong><br>
          <em style="color:#555;">"${result.reply_text}"</em>
        </div>`;
    } else if (sendStatus === 'failed') {
      statusBlock = `
        <div style="background:#fff0f0;border:1px solid #FF4444;border-radius:8px;padding:12px;margin:12px 0;">
          <strong>❌ Message failed to send</strong><br>
          <span style="color:#c00;font-size:13px;">${sendError}</span><br><br>
          <span style="font-size:12px;color:#888;">Reply text was: <em>"${result.reply_text}"</em></span>
        </div>`;
    } else {
      statusBlock = `<p style="color:#888;">No message sent — manual override active. Reply directly on Instagram.</p>`;
    }

    res.send(_renderPage(
      label,
      `Decision recorded for <strong>${subscriberId}</strong>.${statusBlock}`,
      sendStatus === 'failed' ? '#FF4444' : decision === 'reject' ? '#FF4444' : '#25D366'
    ));

  } catch (err) {
    console.error('[server] /resume GET error:', err.message, err.stack);
    res.send(_renderPage('❌ Error', `${err.message}<br><small style="color:#888;">Check Railway logs for details.</small>`, '#FF4444'));
  }
});

// ─── TEST SEND ENDPOINT ───────────────────────────────────────────────────────
// Test if ManyChat outbound messaging works: /test-send?subscriberId=123
app.get('/test-send', async (req, res) => {
  try {
    const { subscriberId } = req.query;
    if (!subscriberId) {
      return res.send(_renderPage('❌ Error', 'Add ?subscriberId=YOUR_ID to the URL', '#FF4444'));
    }
    await sendTextMessage(subscriberId, 'Test message from Sanad bot ✅ — ManyChat API is working!');
    res.send(_renderPage('✅ Test Sent', `Message sent to subscriber <strong>${subscriberId}</strong>. Check Instagram to confirm it arrived.`, '#25D366'));
  } catch (err) {
    res.send(_renderPage('❌ Test Failed', `Error: <strong>${err.message}</strong><br><br>This means the ManyChat API call is failing. Check the API key has "Send Content" permission in ManyChat.`, '#FF4444'));
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

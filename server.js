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

    // Basic validation — must have a subscriber ID
    const subscriberId = body.subscriber_id || body.id;
    if (!subscriberId) {
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

// ─── RESUME ENDPOINT ──────────────────────────────────────────────────────────
// Called when Sanad clicks a decision button after a handoff
// Body: { subscriberId, decision: 'approve_guestlist' | 'push_table' | 'reject' }
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

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = config.server.port || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sanad Concierge Brain running on port ${PORT}`);
  console.log(`   POST /message  — main endpoint`);
  console.log(`   POST /resume   — handoff resume`);
  console.log(`   GET  /health   — health check`);
});

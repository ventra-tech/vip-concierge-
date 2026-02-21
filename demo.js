/**
 * demo.js
 * Simulates 5 real conversation scenarios without needing ManyChat or a live server.
 * Run with: node demo.js
 *
 * Uses mocked LLM responses so you don't need an OpenAI key to run this.
 */

// ─── Mock the LLM so we don't need a real API key ─────────────────────────────
// Replace callLLM with a simple mock for demo purposes
const provider = require('./src/llm/provider');
const originalCallLLM = provider.callLLM;
provider.callLLM = async (messages) => {
  const lastMsg = messages[messages.length - 1]?.content || '';
  if (lastMsg.includes('guestlist')) return 'guestlist';
  if (lastMsg.includes('table')) return 'table';
  if (lastMsg.includes('question')) return 'question';
  return 'unknown';
};

const { processMessage } = require('./src/index');

// ─── Helper to simulate a ManyChat payload ────────────────────────────────────

function makePayload(subscriberId, text, type = 'text', username = '') {
  return {
    subscriber_id: subscriberId,
    last_input_text: text,
    text,
    type,
    username,
    first_name: 'Test',
  };
}

async function runDemo() {
  console.log('\n' + '='.repeat(60));
  console.log('  SANAD CONCIERGE BRAIN — DEMO');
  console.log('='.repeat(60) + '\n');

  // ─── Scenario 1: Girls guestlist ──────────────────────────────────────────
  await runScenario('Scenario 1: Girls guestlist', [
    { id: 'sub_001', text: 'heyy can you add us to the guestlist x', username: 'bella_rose' },
    { id: 'sub_001', text: '3 of us, all girls' },
    { id: 'sub_001', text: 'we\'re thinking saturday night' },
    { id: 'sub_001', text: 'Sarah Johnson, Mia Clarke, Emma Davis — @sarahjohnson @miaclarke @emmadavis' },
  ]);

  // ─── Scenario 2: 3 guys → push table ─────────────────────────────────────
  await runScenario('Scenario 2: 3 guys → push table', [
    { id: 'sub_002', text: 'aye bro can we get on the guestlist tonight', username: 'jake_123' },
    { id: 'sub_002', text: '3 guys, no girls' },
  ]);

  // ─── Scenario 3: 2 guys wrong ratio → handoff ────────────────────────────
  await runScenario('Scenario 3: 2 guys wrong ratio → handoff', [
    { id: 'sub_003', text: 'me and my mate want to get in bro', username: 'dan_lad' },
    { id: 'sub_003', text: '2 guys and 2 girls, saturday night' },
  ]);

  // ─── Scenario 4: Voice note → instant handoff ────────────────────────────
  await runScenario('Scenario 4: Voice note → handoff', [
    { id: 'sub_004', text: '', type: 'voice', username: 'mike_b' },
  ]);

  // ─── Scenario 5: Table booking ───────────────────────────────────────────
  await runScenario('Scenario 5: VIP table booking', [
    { id: 'sub_005', text: 'we want a VIP table this friday', username: 'james_vip' },
    { id: 'sub_005', text: 'group of 4, all guys' },
    { id: 'sub_005', text: 'James Anderson' },
  ]);

  // Restore real LLM
  provider.callLLM = originalCallLLM;
  console.log('\n' + '='.repeat(60));
  console.log('  DEMO COMPLETE');
  console.log('='.repeat(60) + '\n');
}

async function runScenario(title, messages) {
  console.log('\n' + '-'.repeat(60));
  console.log(`  ${title}`);
  console.log('-'.repeat(60));

  for (const msg of messages) {
    const payload = makePayload(msg.id, msg.text, msg.type || 'text', msg.username || '');
    console.log(`\n  USER: "${msg.text || '[voice/media]'}" ${msg.type ? `[${msg.type}]` : ''}`);

    try {
      const result = await processMessage(payload);
      console.log(`  BOT:  ${result.reply_text || '[no reply — paused/handoff]'}`);

      if (result.actions.length > 0) {
        result.actions.forEach((a) => {
          console.log(`  ACTION: ${a.type}`);
          if (a.summary) console.log(`  SUMMARY:\n${a.summary}`);
        });
      }

      console.log(`  STATE: status=${result.updated_state.status} | lead=${result.updated_state.lead_type} | gender=${result.updated_state.detected_gender}`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }
}

runDemo().catch(console.error);

/**
 * tests/bookingLogic.test.js
 * Unit tests for the deterministic booking logic.
 * Run with: npm test
 */

const { evaluateGuestlistEligibility, getTableMinimum, checkHandoffRequired } = require('../src/policy/reign');
const { decideNextAction } = require('../src/bookingLogic');
const { createState } = require('../src/state');

// ─── Policy: evaluateGuestlistEligibility ─────────────────────────────────────

describe('evaluateGuestlistEligibility', () => {
  test('3 guys → push_table', () => {
    const result = evaluateGuestlistEligibility({ guys: 3, girls: 0, nightType: 'weekend' });
    expect(result.decision).toBe('push_table');
  });

  test('4 guys → push_table', () => {
    const result = evaluateGuestlistEligibility({ guys: 4, girls: 4, nightType: 'weekend' });
    expect(result.decision).toBe('push_table');
  });

  test('2 guys wrong ratio (weekend, only 4 girls) → handoff', () => {
    const result = evaluateGuestlistEligibility({ guys: 2, girls: 4, nightType: 'weekend' });
    expect(result.decision).toBe('handoff');
    expect(result.reason).toContain('weekend');
  });

  test('2 guys correct ratio (weekend, 6 girls) → approved', () => {
    const result = evaluateGuestlistEligibility({ guys: 2, girls: 6, nightType: 'weekend' });
    expect(result.decision).toBe('approved');
  });

  test('2 guys correct ratio (weekday, 4 girls) → approved', () => {
    const result = evaluateGuestlistEligibility({ guys: 2, girls: 4, nightType: 'weekday' });
    expect(result.decision).toBe('approved');
  });

  test('2 guys no night type → handoff (unknown night)', () => {
    const result = evaluateGuestlistEligibility({ guys: 2, girls: 6, nightType: null });
    expect(result.decision).toBe('handoff');
    expect(result.reason).toBe('night_type_unknown');
  });

  test('girls only → approved', () => {
    const result = evaluateGuestlistEligibility({ guys: 0, girls: 4, nightType: 'weekend' });
    expect(result.decision).toBe('approved');
    expect(result.reason).toBe('girls_only');
  });

  test('1 guy solo with 5 girls → approved', () => {
    const result = evaluateGuestlistEligibility({ guys: 1, girls: 5, nightType: 'weekend' });
    expect(result.decision).toBe('approved');
  });

  test('1 guy solo with 2 girls → push_table', () => {
    const result = evaluateGuestlistEligibility({ guys: 1, girls: 2, nightType: 'weekend' });
    expect(result.decision).toBe('push_table');
  });
});

// ─── Policy: getTableMinimum ──────────────────────────────────────────────────

describe('getTableMinimum', () => {
  test('3 people → £750', () => {
    const result = getTableMinimum(3, 'weekend');
    expect(result.min).toBe(750);
  });

  test('4 people weekend → £1200', () => {
    const result = getTableMinimum(4, 'weekend');
    expect(result.min).toBe(1200);
  });

  test('4 people weekday → £1000', () => {
    const result = getTableMinimum(4, 'weekday');
    expect(result.min).toBe(1000);
  });

  test('8 people → £1500 min', () => {
    const result = getTableMinimum(8, 'weekend');
    expect(result.min).toBe(1500);
  });

  test('12 people → £2000 min', () => {
    const result = getTableMinimum(12, 'weekend');
    expect(result.min).toBe(2000);
  });
});

// ─── Policy: checkHandoffRequired ────────────────────────────────────────────

describe('checkHandoffRequired', () => {
  test('voice note → handoff required', () => {
    const state = createState('sub_test');
    const result = checkHandoffRequired({ messageType: 'voice', messageText: '', state });
    expect(result.required).toBe(true);
    expect(result.reason).toContain('voice');
  });

  test('image → handoff required', () => {
    const state = createState('sub_test');
    const result = checkHandoffRequired({ messageType: 'image', messageText: '', state });
    expect(result.required).toBe(true);
  });

  test('mention of Maddox → handoff required', () => {
    const state = createState('sub_test');
    const result = checkHandoffRequired({ messageType: 'text', messageText: 'can we go to Maddox instead?', state });
    expect(result.required).toBe(true);
    expect(result.reason).toContain('maddox');
  });

  test('pre-dinner mention → handoff required', () => {
    const state = createState('sub_test');
    const result = checkHandoffRequired({ messageType: 'text', messageText: 'we want pre dinner drinks', state });
    expect(result.required).toBe(true);
    expect(result.reason).toBe('pre_dinner_mentioned');
  });

  test('large table group (5+) → handoff required', () => {
    const state = { ...createState('sub_test'), lead_type: 'table', group_size: 6 };
    const result = checkHandoffRequired({ messageType: 'text', messageText: 'we want a table', state });
    expect(result.required).toBe(true);
  });

  test('normal text message → no handoff', () => {
    const state = createState('sub_test');
    const result = checkHandoffRequired({ messageType: 'text', messageText: 'can i get on the guestlist', state });
    expect(result.required).toBe(false);
  });
});

// ─── bookingLogic: decideNextAction ──────────────────────────────────────────

describe('decideNextAction', () => {
  function makeRouterOutput(overrides = {}) {
    return {
      intent: 'guestlist',
      messageType: 'text',
      groupSize: null,
      guys: null,
      girls: null,
      nightType: null,
      rawText: 'can i get on the guestlist',
      classifiedBy: 'keyword',
      ...overrides,
    };
  }

  test('voice note → handoff action', () => {
    const state = createState('sub_test');
    const result = decideNextAction(state, makeRouterOutput({ messageType: 'voice', rawText: '' }));
    expect(result.action).toBe('handoff');
    expect(result.updatedState.paused).toBe(true);
  });

  test('3 guys → push_table action', () => {
    const state = { ...createState('sub_test'), lead_type: 'guestlist', guys: 3, girls: 0, gender_mix: 'guys', night_type: 'weekend' };
    const result = decideNextAction(state, makeRouterOutput({ guys: 3, girls: 0 }));
    expect(result.action).toBe('push_table');
  });

  test('girls only → ask for names after night type known', () => {
    const state = { ...createState('sub_test'), lead_type: 'guestlist', gender_mix: 'girls', girls: 3, guys: 0, night_type: 'saturday' };
    const result = decideNextAction(state, makeRouterOutput({ girls: 3, guys: 0 }));
    // Should ask for names
    expect(['ask_question', 'approve_guestlist', 'confirm']).toContain(result.action);
  });

  test('confirmation template includes all required fields', () => {
    const { guestlistConfirmation } = require('../src/templates/confirmations');
    const state = {
      ...createState('sub_test'),
      lead_type: 'guestlist',
      gender_mix: 'girls',
      collected_names: ['Sarah Johnson'],
      collected_instagrams: ['@sarahjohnson'],
      night_type: 'weekend',
    };
    const text = guestlistConfirmation(state);
    expect(text).toContain('£20');               // entry fee
    expect(text).toContain('11pm');              // arrival
    expect(text).toContain('dress & heels');     // dress code
    expect(text).toContain('MANDATORY');         // ID requirement
    expect(text).toContain('Sanad guestlist');   // door phrase
    expect(text).toContain('Piccadilly');        // address
  });
});

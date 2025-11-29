process.env.ADMIN_API_KEY = 'admin-key';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

describe('Multi-resource scheduling & instrumentation', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
  });

  test('allows same slot/time across different resources, blocks same resource overlap', async () => {
    const startAt = Date.now() + 60*60*1000; // +1h
    // Booking on piano
    const r1 = await request(app).post('/api/booking/create').send({ booking_id:'b_piano_1', user_id:'u1', slot_id:'slot_A', resource_id:'piano', start_at:startAt, duration_min:30 });
    expect(r1.status).toBe(200);
    // Parallel booking on violin (same slot/time) succeeds
    const r2 = await request(app).post('/api/booking/create').send({ booking_id:'b_violin_1', user_id:'u2', slot_id:'slot_A', resource_id:'violin', start_at:startAt, duration_min:30 });
    expect(r2.status).toBe(200);
    // Second overlap on piano should fail
    const r3 = await request(app).post('/api/booking/create').send({ booking_id:'b_piano_2', user_id:'u3', slot_id:'slot_A', resource_id:'piano', start_at:startAt, duration_min:30 });
    expect(r3.status).toBe(409);
    expect(r3.body.error).toBe('slot_unavailable');
  });

  test('instrumentation events include resource_id for all funnel actions', async () => {
    const startAt = Date.now() + 2*60*60*1000; // +2h
    // Create booking with resource piano
    const createRes = await request(app).post('/api/booking/create').send({ booking_id:'b_instr_1', user_id:'userX', slot_id:'slot_B', resource_id:'piano', start_at:startAt, duration_min:45 });
    expect(createRes.status).toBe(200);
    const actions = [
      { action:'start' },
      { action:'view_availability' },
      { action:'open_slot', slot_id:'slot_B' },
      { action:'select_slot', slot_id:'slot_B' },
      { action:'confirm', amount_cents:5000, currency:'usd' }
    ];
    for(const a of actions){
      const res = await request(app).post('/api/booking/instrument').send({ booking_id:'b_instr_1', user_id:'userX', slot_id:a.slot_id, action:a.action, amount_cents:a.amount_cents, currency:a.currency, resource_id:'piano' });
      expect(res.status).toBe(200);
      expect(res.body.event).toBeDefined();
    }
    const events = persistence.listAnalyticsEvents(50);
    // Filter only funnel events
    const funnel = events.filter(e=> e.name.startsWith('booking_'));
    expect(funnel.length).toBeGreaterThanOrEqual(5);
    for(const ev of funnel){
      expect(ev.payload.resource_id).toBe('piano');
    }
  });
});

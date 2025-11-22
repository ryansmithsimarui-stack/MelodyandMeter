// Allowlist enforcement tests
process.env.ADMIN_API_KEY = 'admin-key';
process.env.ALLOWED_RESOURCE_IDS = 'primary,piano,violin';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

describe('Resource allowlist enforcement', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
  });

  test('rejects booking creation with disallowed resource_id', async () => {
    const startAt = Date.now() + 3600000;
    const res = await request(app).post('/api/booking/create').send({ booking_id:'b_disallowed', user_id:'u1', slot_id:'slot_X', resource_id:'drums', start_at:startAt, duration_min:30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resource_id_invalid');
    expect(Array.isArray(res.body.allowed)).toBe(true);
    expect(res.body.allowed).toContain('piano');
  });

  test('accepts booking creation with allowed resource_id', async () => {
    const startAt = Date.now() + 3600000;
    const res = await request(app).post('/api/booking/create').send({ booking_id:'b_piano', user_id:'u2', slot_id:'slot_X', resource_id:'piano', start_at:startAt, duration_min:30 });
    expect(res.status).toBe(200);
    expect(res.body.booking.resource_id).toBe('piano');
  });

  test('instrumentation rejects disallowed resource_id when no booking exists', async () => {
    const res = await request(app).post('/api/booking/instrument').send({ action:'start', booking_id:'b_new', user_id:'u3', resource_id:'drums' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resource_id_invalid');
  });

  test('instrumentation overrides provided resource_id with booking stored value (even if conflicting)', async () => {
    // Create booking with violin (allowed)
    const startAt = Date.now() + 7200000;
    const create = await request(app).post('/api/booking/create').send({ booking_id:'b_violin', user_id:'u4', slot_id:'slot_Y', resource_id:'violin', start_at:startAt, duration_min:30 });
    expect(create.status).toBe(200);
    // Instrument start with different allowed resource (piano); expect event uses violin
    const instr = await request(app).post('/api/booking/instrument').send({ action:'start', booking_id:'b_violin', user_id:'u4', resource_id:'piano' });
    expect(instr.status).toBe(200);
    // Check analytics persistence
    const events = persistence.listAnalyticsEvents(10);
    const startEvent = events.find(e=> e.name==='booking_started' && e.payload.booking_id==='b_violin');
    expect(startEvent).toBeTruthy();
    expect(startEvent.payload.resource_id).toBe('violin');
  });
});

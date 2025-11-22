const request = require('supertest');

// Configure admin keys before app load (must be set prior to require('../server'))
process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_API_KEY_SECONDARY = 'secondary-key';

const app = require('../server');
const persistence = require('../persistence');

describe('Reschedule Logic & Instrumentation', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
    await request(app).post('/__test/reset-rate-limits');
    await request(app).post('/__test/reset-admin-rate-limit');
  });

  test('creates booking and emits booking_confirmed event', async () => {
    const startAt = Date.now() + 48 * 60 * 60 * 1000; // 48h future
    const res = await request(app).post('/api/booking/create').send({ booking_id:'r1', user_id:'uR1', slot_id:'slotA', start_at: startAt });
    expect(res.status).toBe(200);
    const booking = persistence.getBooking('r1');
    expect(booking).toBeTruthy();
    expect(booking.slot_id).toBe('slotA');
    expect(booking.pending_new_slot_id).toBeNull();
    // Analytics listing should include booking_confirmed
    const list = await request(app).get('/api/admin/analytics-events?limit=5').set('x-admin-key','primary-key');
    expect(list.status).toBe(200);
    const names = list.body.events.map(e=>e.name);
    expect(names).toContain('booking_confirmed');
  });

  test('initiates reschedule and emits reschedule_initiated', async () => {
    const startAt = Date.now() + 72 * 60 * 60 * 1000; // 72h future
    await request(app).post('/api/booking/create').send({ booking_id:'r2', user_id:'uR2', slot_id:'slotA', start_at: startAt }).expect(200);
    const initRes = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'r2', user_id:'uR2', new_slot_id:'slotB' });
    expect(initRes.status).toBe(200);
    const booking = persistence.getBooking('r2');
    expect(booking.pending_new_slot_id).toBe('slotB');
    expect(booking.status).toBe('reschedule_pending');
    const list = await request(app).get('/api/admin/analytics-events?limit=10').set('x-admin-key','primary-key');
    const names = list.body.events.map(e=>e.name);
    expect(names).toContain('reschedule_initiated');
  });

  test('completes reschedule and emits reschedule_completed', async () => {
    const startAt = Date.now() + 72 * 60 * 60 * 1000;
    await request(app).post('/api/booking/create').send({ booking_id:'r3', user_id:'uR3', slot_id:'slotA', start_at: startAt }).expect(200);
    await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'r3', user_id:'uR3', new_slot_id:'slotB' }).expect(200);
    const compRes = await request(app).post('/api/booking/reschedule/complete').send({ booking_id:'r3', user_id:'uR3' });
    expect(compRes.status).toBe(200);
    const booking = persistence.getBooking('r3');
    expect(booking.slot_id).toBe('slotB');
    expect(booking.pending_new_slot_id).toBeNull();
    expect(booking.status).toBe('confirmed');
    const list = await request(app).get('/api/admin/analytics-events?limit=15').set('x-admin-key','primary-key');
    const names = list.body.events.map(e=>e.name);
    expect(names).toEqual(expect.arrayContaining(['reschedule_initiated','reschedule_completed']));
  });

  test('rejects reschedule when new slot same as current', async () => {
    const startAt = Date.now() + 30 * 60 * 60 * 1000;
    await request(app).post('/api/booking/create').send({ booking_id:'r4', user_id:'uR4', slot_id:'slotZ', start_at: startAt }).expect(200);
    const bad = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'r4', user_id:'uR4', new_slot_id:'slotZ' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('slot_same_as_current');
  });

  test('enforces cutoff window and returns reschedule_cutoff_violation', async () => {
    // Default cutoff is 24h (process.env.RESCHEDULE_CUTOFF_HOURS not set in test env here)
    const startAt = Date.now() + 23 * 60 * 60 * 1000; // inside 24h window
    await request(app).post('/api/booking/create').send({ booking_id:'r5', user_id:'uR5', slot_id:'slotY', start_at: startAt }).expect(200);
    const viol = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'r5', user_id:'uR5', new_slot_id:'slotX' });
    expect(viol.status).toBe(400);
    expect(viol.body.error).toBe('reschedule_cutoff_violation');
    expect(typeof viol.body.hours_until).toBe('number');
  });

  test('rejects second reschedule initiation when one is pending', async () => {
    const startAt = Date.now() + 50 * 60 * 60 * 1000;
    await request(app).post('/api/booking/create').send({ booking_id:'r7', user_id:'uR7', slot_id:'slotA', start_at: startAt }).expect(200);
    await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'r7', user_id:'uR7', new_slot_id:'slotB' }).expect(200);
    const second = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'r7', user_id:'uR7', new_slot_id:'slotC' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('reschedule_already_pending');
  });

  test('complete endpoint rejects when no pending reschedule', async () => {
    await request(app).post('/api/booking/create').send({ booking_id:'r6', user_id:'uR6', slot_id:'slotQ' }).expect(200);
    const noPending = await request(app).post('/api/booking/reschedule/complete').send({ booking_id:'r6', user_id:'uR6' });
    expect(noPending.status).toBe(400);
    expect(noPending.body.error).toBe('no_pending_reschedule');
  });
});
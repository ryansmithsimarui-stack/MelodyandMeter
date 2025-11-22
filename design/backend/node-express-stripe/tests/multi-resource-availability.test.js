const request = require('supertest');
process.env.ADMIN_API_KEY = 'primary-key';
const app = require('../server');
const persistence = require('../persistence');

function futureMinutes(m){ return Date.now() + m*60*1000; }

describe('Multi-Resource Scheduling', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
    await request(app).post('/__test/reset-rate-limits');
    await request(app).post('/__test/reset-admin-rate-limit');
  });

  test('rejects overlapping booking on same resource', async () => {
    const startAt = futureMinutes(60*48); // 48h
    await request(app).post('/api/booking/create').send({ booking_id:'mr1', user_id:'u1', slot_id:'slotR', start_at:startAt, duration_min:60, resource_id:'teacher_alex' }).expect(200);
    const conflict = await request(app).post('/api/booking/create').send({ booking_id:'mr2', user_id:'u2', slot_id:'slotR', start_at:startAt, duration_min:60, resource_id:'teacher_alex' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('slot_unavailable');
  });

  test('allows overlapping bookings on different resources', async () => {
    const startAt = futureMinutes(60*72); // 72h
    const a = await request(app).post('/api/booking/create').send({ booking_id:'mr3', user_id:'u3', slot_id:'slotR', start_at:startAt, duration_min:45, resource_id:'teacher_alex' });
    expect(a.status).toBe(200);
    const b = await request(app).post('/api/booking/create').send({ booking_id:'mr4', user_id:'u4', slot_id:'slotR', start_at:startAt, duration_min:45, resource_id:'teacher_beth' });
    expect(b.status).toBe(200);
  });

  test('allows adjacent bookings on same resource', async () => {
    const startA = futureMinutes(60*96); // 96h
    const startB = startA + 60*60*1000; // +60 min adjacency
    await request(app).post('/api/booking/create').send({ booking_id:'mr5', user_id:'u5', slot_id:'slotAdj', start_at:startA, duration_min:60, resource_id:'teacher_alex' }).expect(200);
    const second = await request(app).post('/api/booking/create').send({ booking_id:'mr6', user_id:'u6', slot_id:'slotAdj', start_at:startB, duration_min:30, resource_id:'teacher_alex' });
    expect(second.status).toBe(200);
  });

  test('reschedule blocked when target slot occupied for same resource', async () => {
    const startAt = futureMinutes(60*120); // 120h
    // Occupied booking on resource teacher_alex
    await request(app).post('/api/booking/create').send({ booking_id:'mr7', user_id:'u7', slot_id:'slotRes', start_at:startAt, duration_min:30, resource_id:'teacher_alex' }).expect(200);
    // Another booking on different slot same resource
    await request(app).post('/api/booking/create').send({ booking_id:'mr8', user_id:'u8', slot_id:'slotOther', start_at:startAt, duration_min:30, resource_id:'teacher_alex' }).expect(200);
    const resInit = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'mr8', user_id:'u8', new_slot_id:'slotRes' });
    expect(resInit.status).toBe(409);
    expect(resInit.body.error).toBe('slot_unavailable');
  });

  test('reschedule allowed when target slot occupied by different resource', async () => {
    const startAt = futureMinutes(60*140); // 140h
    // Occupied booking for teacher_alex
    await request(app).post('/api/booking/create').send({ booking_id:'mr9', user_id:'u9', slot_id:'slotShare', start_at:startAt, duration_min:30, resource_id:'teacher_alex' }).expect(200);
    // Booking for teacher_beth on other slot
    await request(app).post('/api/booking/create').send({ booking_id:'mr10', user_id:'u10', slot_id:'slotOther2', start_at:startAt, duration_min:30, resource_id:'teacher_beth' }).expect(200);
    // Attempt to reschedule teacher_beth booking into slotShare should succeed because resource differs
    const resInit = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'mr10', user_id:'u10', new_slot_id:'slotShare' });
    expect(resInit.status).toBe(200);
    const b = persistence.getBooking('mr10');
    expect(b.pending_new_slot_id).toBe('slotShare');
  });
});
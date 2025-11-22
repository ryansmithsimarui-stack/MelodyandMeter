const request = require('supertest');
process.env.ADMIN_API_KEY = 'primary-key';
const app = require('../server');
const persistence = require('../persistence');

function futureHours(h){ return Date.now() + h*60*60*1000; }

describe('Slot Availability Validation', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
    await request(app).post('/__test/reset-rate-limits');
    await request(app).post('/__test/reset-admin-rate-limit');
  });

  test('prevents creating second booking on same slot & start_at', async () => {
    const startAt = futureHours(48);
    await request(app).post('/api/booking/create').send({ booking_id:'sa1', user_id:'u1', slot_id:'slotX', start_at:startAt }).expect(200);
    const conflict = await request(app).post('/api/booking/create').send({ booking_id:'sa2', user_id:'u2', slot_id:'slotX', start_at:startAt });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('slot_unavailable');
  });

  test('allows different start times for same slot', async () => {
    const startA = futureHours(72);
    const startB = futureHours(96); // different time
    await request(app).post('/api/booking/create').send({ booking_id:'sa3', user_id:'u3', slot_id:'slotY', start_at:startA }).expect(200);
    const second = await request(app).post('/api/booking/create').send({ booking_id:'sa4', user_id:'u4', slot_id:'slotY', start_at:startB });
    expect(second.status).toBe(200);
  });

  test('blocks reschedule initiation to occupied slot at same time', async () => {
    const startAt = futureHours(60);
    // Existing booking occupying slotZ
    await request(app).post('/api/booking/create').send({ booking_id:'sa5', user_id:'u5', slot_id:'slotZ', start_at:startAt }).expect(200);
    // Booking to reschedule from slotA to slotZ
    await request(app).post('/api/booking/create').send({ booking_id:'sa6', user_id:'u6', slot_id:'slotA', start_at:startAt }).expect(200);
    const resInit = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'sa6', user_id:'u6', new_slot_id:'slotZ' });
    expect(resInit.status).toBe(409);
    expect(resInit.body.error).toBe('slot_unavailable');
  });

  test('allows reschedule to free slot', async () => {
    const startAt = futureHours(60);
    await request(app).post('/api/booking/create').send({ booking_id:'sa7', user_id:'u7', slot_id:'slotA', start_at:startAt }).expect(200);
    const resInit = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'sa7', user_id:'u7', new_slot_id:'slotB' });
    expect(resInit.status).toBe(200);
    const booking = persistence.getBooking('sa7');
    expect(booking.pending_new_slot_id).toBe('slotB');
  });
});

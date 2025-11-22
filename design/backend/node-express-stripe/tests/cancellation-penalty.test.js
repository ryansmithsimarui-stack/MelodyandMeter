const request = require('supertest');
const app = require('../server');

// Helper to future timestamp by hours
function hoursFromNow(h){ return Date.now() + h*60*60*1000; }

describe('Cancellation Penalty Logic', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
  });

  test('Cancellation outside free window applies no penalty', async () => {
    const startAt = hoursFromNow(48); // > default free window 24h
    // Create booking
    const createRes = await request(app).post('/api/booking/create').send({ booking_id:'b_free', user_id:'parent@example.com', slot_id:'slotA', start_at: startAt });
    expect(createRes.status).toBe(200);
    // Cancel
    const cancelRes = await request(app).post('/api/booking/cancel').send({ booking_id:'b_free', user_id:'parent@example.com', reason_code:'user_change' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.cancelled).toBe(true);
    expect(cancelRes.body.booking.status).toBe('cancelled');
    expect(cancelRes.body.booking.penalty_applied).toBe(false);
    expect(cancelRes.body.booking.penalty_reason).toBe('none');
  });

  test('Late cancellation inside free window but outside hard cutoff applies penalty', async () => {
    const startAt = hoursFromNow(5); // < 24h free window, > 1h hard cutoff
    const createRes = await request(app).post('/api/booking/create').send({ booking_id:'b_late', user_id:'parent@example.com', slot_id:'slotB', start_at: startAt });
    expect(createRes.status).toBe(200);
    const cancelRes = await request(app).post('/api/booking/cancel').send({ booking_id:'b_late', user_id:'parent@example.com', reason_code:'user_change' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.penalty_applied).toBe(true);
    expect(cancelRes.body.booking.penalty_reason).toBe('late_cancel');
  });

  test('Cancellation inside hard cutoff rejected', async () => {
    const startAt = hoursFromNow(0.5); // < 1h hard cutoff
    const createRes = await request(app).post('/api/booking/create').send({ booking_id:'b_cutoff', user_id:'parent@example.com', slot_id:'slotC', start_at: startAt });
    expect(createRes.status).toBe(200);
    const cancelRes = await request(app).post('/api/booking/cancel').send({ booking_id:'b_cutoff', user_id:'parent@example.com', reason_code:'user_change' });
    expect(cancelRes.status).toBe(400);
    expect(cancelRes.body.error).toBe('cancellation_cutoff_violation');
  });

  test('Cannot cancel after start time', async () => {
    const startAt = Date.now() - 60*60*1000; // already in past
    const createRes = await request(app).post('/api/booking/create').send({ booking_id:'b_past', user_id:'parent@example.com', slot_id:'slotD', start_at: startAt });
    expect(createRes.status).toBe(200);
    const cancelRes = await request(app).post('/api/booking/cancel').send({ booking_id:'b_past', user_id:'parent@example.com', reason_code:'user_change' });
    expect(cancelRes.status).toBe(400);
    expect(cancelRes.body.error).toBe('booking_already_started');
  });
});

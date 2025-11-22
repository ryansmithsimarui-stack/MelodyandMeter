const request = require('supertest');
const app = require('../server');

function hoursFromNow(h){ return Date.now() + h*60*60*1000; }

describe('Duration Overlap Availability', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
  });

  test('Rejects partial overlap within existing booking duration', async () => {
    const startAt = hoursFromNow(48);
    // Booking A: 60 min
    await request(app).post('/api/booking/create').send({ booking_id:'bA', user_id:'u1', slot_id:'slotZ', start_at:startAt, duration_min:60 }).expect(200);
    // Booking B: starts 30 min into Booking A (overlap)
    const overlapStart = startAt + 30*60000;
    const res = await request(app).post('/api/booking/create').send({ booking_id:'bB', user_id:'u2', slot_id:'slotZ', start_at:overlapStart, duration_min:30 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_unavailable');
  });

  test('Allows adjacent booking starting exactly when previous ends', async () => {
    const startAt = hoursFromNow(24);
    await request(app).post('/api/booking/create').send({ booking_id:'bLong', user_id:'u1', slot_id:'slotAdj', start_at:startAt, duration_min:45 }).expect(200);
    const adjacentStart = startAt + 45*60000; // end boundary
    const res = await request(app).post('/api/booking/create').send({ booking_id:'bNext', user_id:'u2', slot_id:'slotAdj', start_at:adjacentStart, duration_min:30 });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
  });

  test('Legacy point booking (duration 0) blocks interval covering its start', async () => {
    const startAt = hoursFromNow(30);
    await request(app).post('/api/booking/create').send({ booking_id:'bPoint', user_id:'u1', slot_id:'slotP', start_at:startAt }).expect(200);
    const coveringStart = startAt - 15*60000;
    const res = await request(app).post('/api/booking/create').send({ booking_id:'bCover', user_id:'u2', slot_id:'slotP', start_at:coveringStart, duration_min:30 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_unavailable');
  });

  test('Reschedule initiation validates duration overlap with new slot', async () => {
    const startAt = hoursFromNow(50);
    // Original booking with duration 40
    await request(app).post('/api/booking/create').send({ booking_id:'bRes', user_id:'u3', slot_id:'slotOrig', start_at:startAt, duration_min:40 }).expect(200);
    // Another booking occupying new_slot with overlapping time
    await request(app).post('/api/booking/create').send({ booking_id:'bBlock', user_id:'u4', slot_id:'slotNew', start_at:startAt + 20*60000, duration_min:30 }).expect(200);
    // Attempt reschedule to slotNew should fail (overlap 20-40 inside bRes duration window)
    const res = await request(app).post('/api/booking/reschedule/initiate').send({ booking_id:'bRes', user_id:'u3', new_slot_id:'slotNew' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_unavailable');
  });
});

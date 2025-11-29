process.env.ADMIN_API_KEY = 'admin-key';
process.env.ALLOWED_RESOURCE_IDS = 'primary,piano,violin';
// Configure capacity: piano 180 min, violin 120 min, primary 240 min
process.env.RESOURCE_CAPACITY_MINUTES = 'primary:240,piano:180,violin:120';

const request = require('supertest');
const app = require('../server');

describe('Capacity utilization metrics', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
  });

  test('metrics include utilization percent per resource with correct ratios', async () => {
    const baseStart = Date.now() + 3600_000; // +1h
    // Create two piano bookings: 30 + 60 = 90 booked minutes (half of 180) confirmed
    await request(app).post('/api/booking/create').send({ booking_id:'b_piano_1', user_id:'u1', slot_id:'slot_A', resource_id:'piano', start_at: baseStart, duration_min:30 });
    await request(app).post('/api/booking/create').send({ booking_id:'b_piano_2', user_id:'u2', slot_id:'slot_B', resource_id:'piano', start_at: baseStart + 31*60*1000, duration_min:60 });
    // Create one primary booking: 120 of 240 = 0.5
    await request(app).post('/api/booking/create').send({ booking_id:'b_primary_1', user_id:'u3', slot_id:'slot_C', resource_id:'primary', start_at: baseStart, duration_min:120 });
    // No violin bookings -> 0 utilization

    const metricsRes = await request(app).get('/api/admin/metrics').set('x-admin-key','admin-key');
    expect(metricsRes.status).toBe(200);
    const text = metricsRes.text;
    const pianoLine = text.split('\n').find(l=> l.startsWith('melody_bookings_utilization_percent{resource_id="piano"'));   
    const primaryLine = text.split('\n').find(l=> l.startsWith('melody_bookings_utilization_percent{resource_id="primary"'));
    const violinLine = text.split('\n').find(l=> l.startsWith('melody_bookings_utilization_percent{resource_id="violin"'));
    expect(pianoLine).toMatch(/ 0\.5$/);
    expect(primaryLine).toMatch(/ 0\.5$/);
    expect(violinLine).toMatch(/ 0$/);
  });

  test('resources endpoint exposes capacity map', async () => {
    const res = await request(app).get('/api/admin/resources').set('x-admin-key','admin-key');
    expect(res.status).toBe(200);
    expect(res.body.capacityConfigured).toBe(true);
    expect(res.body.capacityMinutes.piano).toBe(180);
    expect(res.body.capacityMinutes.violin).toBe(120);
    expect(res.body.capacityMinutes.primary).toBe(240);
  });
});

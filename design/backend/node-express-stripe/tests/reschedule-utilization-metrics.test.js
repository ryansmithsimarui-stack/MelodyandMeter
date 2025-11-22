const request = require('supertest');

process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_RATE_LIMIT_MAX = '10';
process.env.ALLOWED_RESOURCE_IDS = 'primary,piano';
process.env.RESOURCE_CAPACITY_MINUTES = 'primary:480,piano:600';

const app = require('../server');

async function resetAdminLimiter(){
  await request(app).post('/__test/reset-admin-rate-limit');
}
async function resetPersistence(){
  await request(app).post('/__test/reset-persistence');
}

describe('Utilization, histogram, and reschedule metrics', () => {
  beforeEach(async ()=>{
    await resetAdminLimiter();
    await resetPersistence();
  });

  test('emits utilization percent with capacity and histogram buckets', async () => {
    // Create confirmed bookings with durations to populate minutes and histogram
    const baseStart = Date.now() + 72*60*60*1000; // far in future
    const bookings = [
      { id:'u1', dur:30, res:'primary' },
      { id:'u2', dur:45, res:'primary' },
      { id:'u3', dur:60, res:'piano' }
    ];
    for(const b of bookings){
      const resCreate = await request(app)
        .post('/api/booking/create')
        .send({ booking_id: b.id, user_id: 'util@example.com', slot_id: 'slot_'+b.id, resource_id: b.res, start_at: baseStart + Math.random()*1000, duration_min: b.dur });
      expect(resCreate.status).toBe(200);
    }
    const metricsRes = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key');
    expect(metricsRes.status).toBe(200);
    const body = metricsRes.text;
    // Utilization: primary minutes = 75 / 480, piano = 60 / 600
    expect(body).toMatch(/melody_bookings_utilization_percent{resource_id="primary"} 0\.15625/);
    expect(body).toMatch(/melody_bookings_utilization_percent{resource_id="piano"} 0\.1/);
    // Histogram buckets present (check a few key ones)
    expect(body).toMatch(/melody_booking_duration_minutes_bucket{le="30"}/);
    expect(body).toMatch(/melody_booking_duration_minutes_bucket{le="45"}/);
    expect(body).toMatch(/melody_booking_duration_minutes_sum/);
    expect(body).toMatch(/melody_booking_duration_minutes_count/);
  });

  test('reschedule lead time metrics populated on initiation and completion', async () => {
    const startAt = Date.now() + 100*60*60*1000; // 100h ahead
    const createRes = await request(app)
      .post('/api/booking/create')
      .send({ booking_id: 'r1', user_id: 'lead@example.com', slot_id: 'slotR1', start_at: startAt, duration_min: 30 });
    expect(createRes.status).toBe(200);
    // Initiate reschedule (lead time ~100h)
    const initRes = await request(app)
      .post('/api/booking/reschedule/initiate')
      .send({ booking_id: 'r1', user_id: 'lead@example.com', new_slot_id: 'slotR2' });
    expect(initRes.status).toBe(200);
    // Complete reschedule
    const completeRes = await request(app)
      .post('/api/booking/reschedule/complete')
      .send({ booking_id: 'r1', user_id: 'lead@example.com' });
    expect(completeRes.status).toBe(200);
    const metricsRes = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key');
    expect(metricsRes.status).toBe(200);
    const body = metricsRes.text;
    expect(body).toMatch(/melody_reschedule_lead_time_hours_avg/);
    expect(body).toMatch(/melody_reschedule_lead_time_hours_median/);
    expect(body).toMatch(/melody_reschedule_completed_total 1/);
  });
});

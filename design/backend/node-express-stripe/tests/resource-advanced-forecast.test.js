process.env.ADMIN_API_KEY='fc-admin-key';
const persistence = require('../persistence');
const request = require('supertest');
process.env.ENABLE_WS_TESTS='false'; // ensure we don't start WS here
const app = require('../server');

describe('advanced capacity forecast', ()=>{
  test('exponential smoothing produces projected utilization', async ()=>{
    // Create resource and synthetic bookings to drive utilization snapshots
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','fc-admin-key')
      .send({ id:'forecast_room', capacityMinutes:200, version:1 }) // version ignored on create
      .expect(201);
    // Generate snapshots: we simulate bookings directly by creating bookings with durations
    const baseStart = Date.now() + 3600*1000;
    for(let i=0;i<5;i++){
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'fcb_'+i, user_id:'u'+i, slot_id:'slotF', resource_id:'forecast_room', start_at: baseStart + i*3600*1000, duration_min: 20 + i*10 })
        .expect(200);
      // Trigger metrics scrape to force snapshot capture
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','fc-admin-key')
        .expect(200);
    }
    // Call forecast endpoint
    const forecastRes = await request(app)
      .get('/api/admin/resources/capacity-forecast')
      .set('x-admin-key','fc-admin-key')
      .expect(200);
    expect(forecastRes.body.heuristic).toBeTruthy();
    expect(forecastRes.body.advanced).toBeTruthy();
    const advEntry = forecastRes.body.advanced.forecast.find(f=>f.id==='forecast_room');
    expect(advEntry).toBeTruthy();
    expect(typeof advEntry.smoothedUtilizationPercent).toBe('number');
    expect(typeof advEntry.projectedUtilizationPercent).toBe('number');
  });
});

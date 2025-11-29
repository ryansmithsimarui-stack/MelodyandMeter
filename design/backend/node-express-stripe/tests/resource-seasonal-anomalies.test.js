// Seasonal residual anomaly detection test
process.env.ADMIN_API_KEY='seasonal-admin-key';
const request = require('supertest');
const app = require('../server');

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

describe('seasonal residual utilization anomalies', ()=>{
  test('detects spike via seasonal residual z-score', async ()=>{
    // Create resource with capacity enabling utilization percent calculations
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','seasonal-admin-key')
      .send({ id:'season_room', capacityMinutes:100 })
      .expect(201);

    // Build baseline: incremental small bookings then metrics snapshots
    // We rely on booking creation + metrics scrape each producing a snapshot (booking origin + metrics origin)
    let bookedMinutes = 0;
    for(let i=0;i<12;i++){ // >= 2*seasonLength (seasonLength default 6)
      const dur = 5; // small steady growth
      bookedMinutes += dur;
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'b_'+i, user_id:'u_'+i, slot_id:'s_'+i, resource_id:'season_room', duration_min: dur })
        .expect(res => { if(res.status!==200 && res.status!==201) throw new Error('Booking create failed'); });
      // Metrics scrape snapshot
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','seasonal-admin-key')
        .expect(200);
    }

    // Spike booking (large jump)
    await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'spike', user_id:'u_spike', slot_id:'s_spike', resource_id:'season_room', duration_min:30 })
      .expect(200);
    await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','seasonal-admin-key')
      .expect(200);

    // Query seasonal residual anomalies
    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','seasonal-admin-key')
      .query({ window: 60, threshold: 1.0, seasonLength: 6 })
      .expect(200);

    expect(res.body).toBeTruthy();
    expect(Array.isArray(res.body.anomalies)).toBe(true);
    const target = res.body.anomalies.find(a=>a.id==='season_room');
    expect(target).toBeTruthy();
    // Should use seasonal_residual method (enough samples) and flag anomaly
    expect(target.method).toBe('seasonal_residual');
    expect(typeof target.zScore).toBe('number');
    expect(target.anomaly).toBe(true);
    expect(Math.abs(target.zScore)).toBeGreaterThanOrEqual(0.8);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

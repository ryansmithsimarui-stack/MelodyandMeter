// Seasonal residual anomaly delta-only criterion test
process.env.ADMIN_API_KEY='seasonal-admin-key';
const request = require('supertest');
const app = require('../server');

describe('seasonal residual utilization anomalies delta-only', ()=>{
  test('flags anomaly via residual delta when zScore below threshold', async ()=>{
    await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','seasonal-admin-key')
      .send({ id:'season_delta_room', capacityMinutes:100 })
      .expect(201);

    // Build baseline (steady small bookings + metrics snapshots)
    for(let i=0;i<12;i++){ // >= 2*seasonLength for method seasonal_residual
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'bd_'+i, user_id:'u_'+i, slot_id:'sd_'+i, resource_id:'season_delta_room', duration_min:5 })
        .expect(res => { if(res.status!==200 && res.status!==201) throw new Error('Baseline booking failed'); });
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','seasonal-admin-key')
        .expect(200);
    }

    // Spike booking large enough to raise residualDelta but keep zScore < high threshold
    await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'delta_spike', user_id:'u_spike', slot_id:'sd_spike', resource_id:'season_delta_room', duration_min:30 })
      .expect(200);
    await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','seasonal-admin-key')
      .expect(200);

    // Query with high z threshold (e.g. 2) and default deltaThreshold (0.08) to rely on residualDelta path
    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','seasonal-admin-key')
      .query({ window: 60, threshold: 2, seasonLength: 6, deltaThreshold: 0.08 })
      .expect(200);

    const target = res.body.anomalies.find(a=>a.id==='season_delta_room');
    expect(target).toBeTruthy();
    expect(target.method).toBe('seasonal_residual');
    // Expect zScore below 2 but anomaly true due to residualDelta >= deltaThreshold
    expect(Math.abs(target.zScore)).toBeLessThan(2);
    expect(target.residualDelta).toBeGreaterThanOrEqual(target.residualDeltaThreshold);
    expect(target.anomaly).toBe(true);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

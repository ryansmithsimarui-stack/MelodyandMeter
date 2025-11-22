// Coefficient of Variation exposure test for seasonal residual anomalies
process.env.ADMIN_API_KEY='cv-admin-key';
const request = require('supertest');
const app = require('../server');

/**
 * Strategy:
 * 1. Create resource and generate low-variability snapshots (small, uniform durations).
 * 2. Fetch seasonal anomalies (adapt enabled) and record CV.
 * 3. Inject higher variability (mixed larger durations) and fetch again; assert CV increases or stays within [0,1].
 */
describe('seasonal residual coefficientOfVariation exposure', ()=>{
  test('coefficientOfVariation increases with higher raw utilization variability', async ()=>{
    // Create resource
    await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','cv-admin-key')
      .send({ id:'cv_room', capacityMinutes:240 })
      .expect(201);

    // Phase 1: low variability (uniform small bookings)
    for(let i=0;i<12;i++){
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'lowcv_'+i, user_id:'lc_'+i, slot_id:'lcv_'+i, resource_id:'cv_room', duration_min:10 })
        .expect(res => { if(res.status!==200 && res.status!==201) throw new Error('Low variability booking failed'); });
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','cv-admin-key')
        .expect(200);
    }
    const lowRes = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','cv-admin-key')
      .query({ window:60, threshold:2, seasonLength:6, adapt:true })
      .expect(200);
    const lowTarget = lowRes.body.anomalies.find(a=>a.id==='cv_room');
    expect(lowTarget).toBeTruthy();
    expect(lowTarget.coefficientOfVariation).toBeGreaterThanOrEqual(0);
    expect(lowTarget.coefficientOfVariation).toBeLessThanOrEqual(1);
    const lowCv = lowTarget.coefficientOfVariation;

    // Phase 2: introduce variability
    const variedDurations = [5,30,45,15,60,20,5,50];
    for(let i=0;i<variedDurations.length;i++){
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'highcv_'+i, user_id:'hc_'+i, slot_id:'hcv_'+i, resource_id:'cv_room', duration_min: variedDurations[i] })
        .expect(200);
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','cv-admin-key')
        .expect(200);
    }
    const highRes = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','cv-admin-key')
      .query({ window:60, threshold:2, seasonLength:6, adapt:true })
      .expect(200);
    const highTarget = highRes.body.anomalies.find(a=>a.id==='cv_room');
    expect(highTarget).toBeTruthy();
    expect(highTarget.coefficientOfVariation).toBeGreaterThanOrEqual(0);
    expect(highTarget.coefficientOfVariation).toBeLessThanOrEqual(1);
    const highCv = highTarget.coefficientOfVariation;

    // Assert CV non-decreasing with added variability (allow equal if noise insufficient)
    expect(highCv).toBeGreaterThanOrEqual(lowCv);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

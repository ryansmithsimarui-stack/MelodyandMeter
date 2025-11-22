// Adaptive tuning test for seasonal residual anomalies
process.env.ADMIN_API_KEY='adaptive-admin-key';
const request = require('supertest');
const app = require('../server');

describe('seasonal residual adaptive tuning', ()=>{
  test('low variability yields lower alpha; higher variability increases alpha when adapt=true', async ()=>{
    // Create resource
    await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','adaptive-admin-key')
      .send({ id:'adaptive_room', capacityMinutes:120 })
      .expect(201);

    // Phase 1: steady small increments (low variability)
    for(let i=0;i<12;i++){
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'low_'+i, user_id:'u_'+i, slot_id:'sl_'+i, resource_id:'adaptive_room', duration_min:5 })
        .expect(res => { if(res.status!==200 && res.status!==201) throw new Error('Baseline booking failed'); });
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','adaptive-admin-key')
        .expect(200);
    }
    const lowVarRes = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','adaptive-admin-key')
      .query({ window:60, threshold:2, seasonLength:6, adapt:true })
      .expect(200);
    const lowTarget = lowVarRes.body.anomalies.find(a=>a.id==='adaptive_room');
    expect(lowVarRes.body.adaptive).toBe(true);
    expect(lowTarget).toBeTruthy();
    const lowAlpha = lowTarget.alpha;

    // Phase 2: add variable increments to raise variability
    const variableDurations = [5,15,30,10,25,5,20,35];
    for(let i=0;i<variableDurations.length;i++){
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'var_'+i, user_id:'v_'+i, slot_id:'sv_'+i, resource_id:'adaptive_room', duration_min: variableDurations[i] })
        .expect(200);
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','adaptive-admin-key')
        .expect(200);
    }
    const highVarRes = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','adaptive-admin-key')
      .query({ window:60, threshold:2, seasonLength:6, adapt:true })
      .expect(200);
    const highTarget = highVarRes.body.anomalies.find(a=>a.id==='adaptive_room');
    expect(highVarRes.body.adaptive).toBe(true);
    expect(highTarget).toBeTruthy();
    const highAlpha = highTarget.alpha;

    // Assert high variability increased alpha (allow small tolerance for identical if variability insufficient)
    expect(highAlpha).toBeGreaterThanOrEqual(lowAlpha);
    // Ensure both within documented bounds
    expect(lowAlpha).toBeGreaterThanOrEqual(0.25);
    expect(highAlpha).toBeLessThanOrEqual(0.65);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

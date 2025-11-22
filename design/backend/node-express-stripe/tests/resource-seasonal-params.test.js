// Test smoothing parameter overrides for seasonal residual anomalies
process.env.ADMIN_API_KEY='seasonal-admin-key';
const request = require('supertest');
const app = require('../server');

describe('seasonal residual anomalies smoothing overrides', ()=>{
  test('returns supplied alpha,beta,gamma in response', async ()=>{
    await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','seasonal-admin-key')
      .send({ id:'season_params_room', capacityMinutes:100 })
      .expect(201);

    // Build baseline >= 12 samples (>=2*seasonLength)
    for(let i=0;i<12;i++){
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:'p_'+i, user_id:'u_'+i, slot_id:'sp_'+i, resource_id:'season_params_room', duration_min:5 })
        .expect(res => { if(res.status!==200 && res.status!==201) throw new Error('Baseline booking failed'); });
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key','seasonal-admin-key')
        .expect(200);
    }

    // Query with overrides
    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','seasonal-admin-key')
      .query({ window:60, threshold:2, seasonLength:6, alpha:0.55, beta:0.25, gamma:0.2 })
      .expect(200);

    expect(res.body).toBeTruthy();
    expect(res.body.alpha).toBeCloseTo(0.55);
    expect(res.body.beta).toBeCloseTo(0.25);
    expect(res.body.gamma).toBeCloseTo(0.2);
    const target = res.body.anomalies.find(a=>a.id==='season_params_room');
    expect(target).toBeTruthy();
    expect(target.alpha).toBeCloseTo(0.55);
    expect(target.beta).toBeCloseTo(0.25);
    expect(target.gamma).toBeCloseTo(0.2);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

process.env.ADMIN_API_KEY='ci-admin-key-seasonal';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

function inject(seq){
  persistence._testInjectUtilizationSequences({ violin: seq });
}

describe('seasonal residual anomalies confidence interval', ()=>{
  test('expectedUpper below last utilization when spike', async ()=>{
    // Need >= 2*seasonLength samples (default L=6). Provide gentle pattern then spike.
    const base = [0.30,0.31,0.30,0.32,0.31,0.30,0.29,0.31,0.30,0.32,0.31,0.30]; // 12 baseline
    const spike = 0.42; // large jump
    inject([...base, spike]); // 13 samples
    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','ci-admin-key-seasonal')
      .query({ window: 13, threshold: 1.0, seasonLength: 6 })
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='violin');
    expect(anom).toBeDefined();
    if(anom.expectedUpper !== undefined){
      expect(anom.lastUtilizationPercent).toBeGreaterThan(anom.expectedUpper);
    }
    expect(anom.expectedLower).toBeLessThan(anom.expectedUpper);
  });

  test('inside expected CI for mild change (higher threshold)', async ()=>{
    const seq = [0.30,0.31,0.30,0.32,0.31,0.30,0.29,0.31,0.30,0.32,0.31,0.30,0.305];
    inject(seq);
    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','ci-admin-key-seasonal')
      .query({ window: 13, threshold: 2.5, seasonLength: 6 })
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='violin');
    expect(anom).toBeDefined();
    if(anom.expectedLower !== undefined && anom.expectedUpper !== undefined){
      expect(anom.lastUtilizationPercent).toBeGreaterThanOrEqual(anom.expectedLower);
      expect(anom.lastUtilizationPercent).toBeLessThanOrEqual(anom.expectedUpper);
    }
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

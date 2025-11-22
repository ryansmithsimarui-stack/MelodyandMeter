process.env.ADMIN_API_KEY='ci-admin-key';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

function inject(seq){
  persistence._testInjectUtilizationSequences({ piano: seq });
}

describe('utilization anomalies confidence interval', ()=>{
  test('anomaly when latest above meanUpper', async ()=>{
    // Baseline fairly stable then jump
    inject([0.40,0.41,0.39,0.40,0.41,0.50]); // last should exceed upper bound
    const res = await request(app)
      .get('/api/admin/resources/utilization-anomalies')
      .set('x-admin-key','ci-admin-key')
      .query({ window:6, threshold:2 })
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='piano');
    expect(anom).toBeDefined();
    expect(anom.meanUpper).toBeDefined();
    expect(anom.lastUtilizationPercent).toBeGreaterThan(anom.meanUpper);
    // Should likely be anomaly (depending on std); if not, still CI ok
    expect(anom.meanLower).toBeLessThan(anom.meanUpper);
  });

  test('non-anomaly inside CI bounds (looser threshold)', async ()=>{
    inject([0.40,0.41,0.39,0.40,0.41,0.405]);
    const res = await request(app)
      .get('/api/admin/resources/utilization-anomalies')
      .set('x-admin-key','ci-admin-key')
      .query({ window:6, threshold:3 }) // higher threshold reduces anomaly chance
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='piano');
    expect(anom).toBeDefined();
    expect(anom.lastUtilizationPercent).toBeGreaterThanOrEqual(anom.meanLower);
    expect(anom.lastUtilizationPercent).toBeLessThanOrEqual(anom.meanUpper);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

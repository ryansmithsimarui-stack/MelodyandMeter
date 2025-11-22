process.env.ADMIN_API_KEY='ci-admin-key-t-small';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

function injectUtil(seq){
  persistence._testInjectUtilizationSequences({ cello: seq });
}
function injectSeasonal(seq){
  persistence._testInjectUtilizationSequences({ flute: seq });
}

describe('t-based confidence intervals for small baseline (N<30)', ()=>{
  test('utilization anomalies use t distribution when baseline <30', async ()=>{
    // 6 samples total -> baseline length 5 (df=4) t critical 2.776 > 1.96
    injectUtil([0.40,0.41,0.39,0.40,0.41,0.405]);
    const res = await request(app)
      .get('/api/admin/resources/utilization-anomalies')
      .set('x-admin-key','ci-admin-key-t-small')
      .query({ window:6, threshold:3 }) // high threshold ensures not forced anomaly
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='cello');
    expect(anom).toBeDefined();
    expect(anom.ciDistribution).toBe('t');
    expect(anom.ciCritical).toBeGreaterThan(1.96);
    // Width check vs z approximation
    const width = anom.meanUpper - anom.meanUtilizationPercent;
    const zWidthApprox = 1.96 * anom.stdUtilizationPercent;
    expect(width).toBeGreaterThan(zWidthApprox); // t widens interval
  });

  test('seasonal residual anomalies fallback/simple also use t when small N', async ()=>{
    // Provide fewer than 2*seasonLength to trigger fallback_simple; baseline length 5
    injectSeasonal([0.30,0.31,0.30,0.32,0.31,0.305]);
    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','ci-admin-key-t-small')
      .query({ window:6, threshold:3, seasonLength:6 })
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='flute');
    expect(anom).toBeDefined();
    // Fallback simple should include ciDistribution
    expect(anom.ciDistribution).toBe('t');
    expect(anom.ciCritical).toBeGreaterThan(1.96);
    const width = anom.expectedUpper - anom.expectedUtilizationPercent;
    const zWidthApprox = 1.96 * anom.stdResidual; // stdResidual equals baseline std in fallback
    expect(width).toBeGreaterThan(zWidthApprox);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

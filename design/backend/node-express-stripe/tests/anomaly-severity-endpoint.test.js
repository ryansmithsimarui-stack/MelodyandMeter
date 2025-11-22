process.env.ADMIN_API_KEY='severity-admin-key';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

function inject(seqMap){
  persistence._testInjectUtilizationSequences(seqMap);
}

describe('anomaly severity endpoint', ()=>{
  test('utilization spike classified as action or critical', async ()=>{
    inject({ piano: [0.40,0.41,0.39,0.40,0.41,0.55] }); // large jump
    const res = await request(app)
      .get('/api/admin/resources/anomaly-severity')
      .set('x-admin-key','severity-admin-key')
      .query({ window:6, threshold:2 })
      .expect(200);
    const piano = res.body.utilizationSeverity.find(s=>s.id==='piano');
    expect(piano).toBeDefined();
    expect(piano.severityLevel).toBeGreaterThanOrEqual(3); // action or critical
    expect(['action','critical']).toContain(piano.severityLabel);
    expect(typeof piano.recommendedAction).toBe('string');
  });

  test('seasonal residual spike classified using residualDelta', async ()=>{
    // Provide seasonal sequence with spike; length 13 ensures seasonal algorithm
    inject({ violin: [0.30,0.31,0.30,0.32,0.31,0.30,0.29,0.31,0.30,0.32,0.31,0.30,0.45] });
    const res = await request(app)
      .get('/api/admin/resources/anomaly-severity')
      .set('x-admin-key','severity-admin-key')
      .query({ window:13, threshold:2, seasonLength:6 })
      .expect(200);
    const violin = res.body.seasonalSeverity.find(s=>s.id==='violin');
    expect(violin).toBeDefined();
    expect(violin.severityLevel).toBeGreaterThanOrEqual(3); // action/critical
    expect(['action','critical']).toContain(violin.severityLabel);
    expect(typeof violin.residualDelta).toBe('number');
  });

  test('stable utilization classified as normal', async ()=>{
    inject({ flute: [0.40,0.41,0.39,0.40,0.41,0.405] });
    const res = await request(app)
      .get('/api/admin/resources/anomaly-severity')
      .set('x-admin-key','severity-admin-key')
      .query({ window:6, threshold:2 })
      .expect(200);
    const flute = res.body.utilizationSeverity.find(s=>s.id==='flute');
    expect(flute).toBeDefined();
    expect(flute.severityLabel).toBe('normal');
    expect(flute.severityLevel).toBe(0);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

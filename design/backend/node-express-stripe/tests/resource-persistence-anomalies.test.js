process.env.ADMIN_API_KEY='persistence-admin-key';
const request = require('supertest');
const app = require('../server');
const persistence = require('../persistence');

function inject(seq){ persistence._testInjectUtilizationSequences({ piano: seq }); }

// Sequence with gradual sustained increase (not a single spike) should trigger persistence anomaly.
// Baseline steady ~0.30 then incremental rise across multiple samples.
const sustainedRamp = [0.30,0.31,0.29,0.30,0.31,0.32,0.33,0.34,0.35,0.36,0.37,0.38];
// Sequence with noise but no sustained shift (should remain normal)
const noisyStable = [0.30,0.31,0.29,0.30,0.31,0.30,0.31,0.29,0.30,0.30,0.31,0.29];

describe('persistence utilization anomalies (CUSUM)', ()=>{
  test('detects sustained upward shift', async ()=>{
    inject(sustainedRamp);
    const res = await request(app)
      .get('/api/admin/resources/utilization-persistence-anomalies')
      .set('x-admin-key','persistence-admin-key')
      .query({ window: 50, k: 0.25, h: 4.5 }) // slightly lower h to ensure detection
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='piano');
    expect(anom).toBeDefined();
    expect(anom.samples).toBe(sustainedRamp.length);
    expect(anom.persistenceAnomaly).toBe(true);
    expect(anom.alarmType).toBe('positive');
    expect(anom.windowShift).toBeGreaterThan(0.02); // last window average shift
  });

  test('no anomaly for noisy stable sequence', async ()=>{
    inject(noisyStable);
    const res = await request(app)
      .get('/api/admin/resources/utilization-persistence-anomalies')
      .set('x-admin-key','persistence-admin-key')
      .query({ window: 50, k: 0.25, h: 5 })
      .expect(200);
    const anom = res.body.anomalies.find(a=>a.id==='piano');
    expect(anom).toBeDefined();
    expect(anom.persistenceAnomaly).toBe(false);
  });

  afterAll(()=>{ if(app && app._shutdown){ app._shutdown(); } });
});

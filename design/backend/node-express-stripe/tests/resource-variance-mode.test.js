process.env.ADMIN_API_KEY='variance-admin-key';
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const serverPath = path.join(__dirname, '..', 'server');
let app;

// Helper wrapper calling test-only injection in persistence
function injectSnapshots(persistence, perResourceSequences) {
  persistence._testInjectUtilizationSequences(perResourceSequences);
}

describe('variance mode anomaly differences', () => {
  beforeAll(() => {
    app = require(serverPath);
  });

  test('sample variance produces smaller |zScore| than population for tiny baseline', async () => {
    const persistence = require(path.join(__dirname, '..', 'persistence'));
    // Sequence with small baseline volatility; latest mild jump
    injectSnapshots(persistence, { piano: [0.50,0.50,0.52,0.51,0.50,0.58] }); // 6 samples -> baseline 5

    const popRes = await request(app)
      .get('/api/admin/resources/utilization-anomalies')
      .set('x-admin-key','variance-admin-key')
      .query({ window: 6, threshold: 0.5, variance: 'population' })
      .expect(200);
    const sampleRes = await request(app)
      .get('/api/admin/resources/utilization-anomalies')
      .set('x-admin-key','variance-admin-key')
      .query({ window: 6, threshold: 0.5, variance: 'sample' })
      .expect(200);

    const popAnom = popRes.body.anomalies.find(a => a.id === 'piano');
    const sampleAnom = sampleRes.body.anomalies.find(a => a.id === 'piano');
    expect(popAnom).toBeDefined();
    expect(sampleAnom).toBeDefined();
    // Sample std dev should be slightly larger, making |zScore| smaller or equal
    const absPop = Math.abs(popAnom.zScore);
    const absSample = Math.abs(sampleAnom.zScore);
    expect(absSample).toBeLessThanOrEqual(absPop);
    expect(popRes.body.varianceMode).toBe('population');
    expect(sampleRes.body.varianceMode).toBe('sample');
  });

  test('seasonal residual endpoint returns varianceMode and respects query', async () => {
    const persistence = require(path.join(__dirname, '..', 'persistence'));
    // Provide enough samples for seasonality (seasonLength=4 -> need >=8)
    injectSnapshots(persistence, { violin: [0.30,0.32,0.31,0.33,0.29,0.30,0.35,0.34] });

    const res = await request(app)
      .get('/api/admin/resources/utilization-seasonal-anomalies')
      .set('x-admin-key','variance-admin-key')
      .query({ window: 8, seasonLength: 4, threshold: 0.5, variance: 'sample' })
      .expect(200);

    expect(res.body.varianceMode).toBe('sample');
    expect(res.body.anomalies.length).toBeGreaterThan(0);
    // Each anomaly should include method field
    const anom = res.body.anomalies[0];
    expect(anom.method).toBeDefined();
  });
});

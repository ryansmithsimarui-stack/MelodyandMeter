process.env.ADMIN_API_KEY = 'hist-admin-key';
const request = require('supertest');
const app = require('../server');

// Tests optimistic concurrency (version field), audit listing, utilization history snapshots, and forecast endpoint.

describe('resource concurrency & history/forecast', () => {
  const adminKey = 'hist-admin-key';
  test('version conflicts, audit, history snapshots, forecast', async () => {
    // Create resource cello
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key', adminKey)
      .send({ id:'cello', name:'Cello', capacityMinutes:100 })
      .expect(201);
    expect(createRes.body.resource.version).toBe(1);

    // Valid update with matching version -> version increments
    const updateOk = await request(app)
      .patch('/api/admin/resources/cello')
      .set('x-admin-key', adminKey)
      .send({ capacityMinutes:120, version: createRes.body.resource.version })
      .expect(200);
    expect(updateOk.body.resource.version).toBe(2);

    // Stale update (using old version 1) -> 409 conflict
    const updateConflict = await request(app)
      .patch('/api/admin/resources/cello')
      .set('x-admin-key', adminKey)
      .send({ capacityMinutes:140, version: 1 })
      .expect(409);
    expect(updateConflict.body.error).toBe('version_conflict');

    // Create booking to generate snapshot (booking snapshot)
    const startAt = Date.now() + 2*60*60*1000;
    await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'b_cello_1', user_id:'u_cello', slot_id:'slotC', resource_id:'cello', start_at:startAt, duration_min:60 })
      .expect(200);

    // Metrics scrape to generate another snapshot
    await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key', adminKey)
      .expect(200);

    // History endpoint should have at least 2 snapshots
    const historyRes = await request(app)
      .get('/api/admin/resources/utilization-history')
      .set('x-admin-key', adminKey)
      .expect(200);
    expect(historyRes.body.snapshots.length).toBeGreaterThanOrEqual(2);
    const lastSnap = historyRes.body.snapshots[historyRes.body.snapshots.length - 1];
    expect(lastSnap.perResource.cello).toBeTruthy();
    expect(lastSnap.perResource.cello.bookedMinutes).toBeGreaterThanOrEqual(60);

    // Forecast endpoint returns entry for cello
    const forecastRes = await request(app)
      .get('/api/admin/resources/capacity-forecast')
      .set('x-admin-key', adminKey)
      .expect(200);
    // New dual forecast shape: { heuristic: { forecast: [...] }, advanced: { forecast: [...] } }
    expect(forecastRes.body.heuristic).toBeTruthy();
    expect(Array.isArray(forecastRes.body.heuristic.forecast)).toBe(true);
    const celloForecastHeuristic = forecastRes.body.heuristic.forecast.find(f=>f.id==='cello');
    expect(celloForecastHeuristic).toBeTruthy();
    expect(typeof celloForecastHeuristic.projectedUtilizationPercent).toBe('number');
    expect(forecastRes.body.advanced).toBeTruthy();
    expect(Array.isArray(forecastRes.body.advanced.forecast)).toBe(true);
    const celloForecastAdvanced = forecastRes.body.advanced.forecast.find(f=>f.id==='cello');
    expect(celloForecastAdvanced).toBeTruthy();
    expect(typeof celloForecastAdvanced.projectedUtilizationPercent).toBe('number');

    // Delete with stale version -> conflict
    const delConflict = await request(app)
      .delete('/api/admin/resources/cello')
      .set('x-admin-key', adminKey)
      .send({ version: 1 })
      .expect(409);
    expect(delConflict.body.error).toBe('version_conflict');

    // Delete with current version -> success
    const delOk = await request(app)
      .delete('/api/admin/resources/cello')
      .set('x-admin-key', adminKey)
      .send({ version: updateOk.body.resource.version })
      .expect(200);
    expect(delOk.body.resource.version).toBeGreaterThan(updateOk.body.resource.version);

    // Audit endpoint lists cello (inactive)
    const auditRes = await request(app)
      .get('/api/admin/resources/audit')
      .set('x-admin-key', adminKey)
      .expect(200);
    const celloAudit = auditRes.body.resources.find(r=>r.id==='cello');
    expect(celloAudit).toBeTruthy();
    expect(celloAudit.active).toBe(false);
    expect(typeof celloAudit.deletedAt).toBe('number');
  });
});

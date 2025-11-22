process.env.ADMIN_API_KEY='anom-admin-key';
const request = require('supertest');
const app = require('../server');

// Verifies anomaly detection via sudden utilization spike.

describe('utilization anomalies detection', () => {
  const adminKey = 'anom-admin-key';
  test('flags spike as anomaly', async () => {
    // Create resource flute with capacity 100
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key', adminKey)
      .send({ id:'flute', name:'Flute', capacityMinutes:100 })
      .expect(201);
    expect(createRes.body.resource.version).toBe(1);

    const now = Date.now();
    // Baseline: 5 snapshots at ~0.05 utilization (5 booked minutes)
    for(let i=0;i<5;i++){
      const startAt = now + (i+1)*60*60*1000;
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:`b_f_base_${i}`, user_id:`u_f_${i}`, slot_id:`slotFB${i}`, resource_id:'flute', start_at:startAt, duration_min:5 })
        .expect(200);
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key', adminKey)
        .expect(200);
    }

    // Spike: add booking of 60 minutes then metrics snapshot
    const spikeStart = now + 10*60*60*1000;
    await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'b_f_spike', user_id:'u_f_spike', slot_id:'slotFSpike', resource_id:'flute', start_at:spikeStart, duration_min:60 })
      .expect(200);
    await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key', adminKey)
      .expect(200);

    // Anomalies endpoint
    const anomaliesRes = await request(app)
      .get('/api/admin/resources/utilization-anomalies?window=50&threshold=2')
      .set('x-admin-key', adminKey)
      .expect(200);
    expect(Array.isArray(anomaliesRes.body.anomalies)).toBe(true);
    const fluteEntry = anomaliesRes.body.anomalies.find(a=>a.id==='flute');
    expect(fluteEntry).toBeTruthy();
    expect(fluteEntry.samples).toBeGreaterThanOrEqual(6);
    expect(typeof fluteEntry.zScore).toBe('number');
    expect(fluteEntry.anomaly).toBe(true);
    expect(Math.abs(fluteEntry.zScore)).toBeGreaterThanOrEqual(2);
  });
});

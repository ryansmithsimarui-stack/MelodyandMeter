process.env.ADMIN_API_KEY='holt-admin-key';
const request = require('supertest');
const app = require('../server');

// Verifies Holt-Winters forecast presence and structure

describe('holt-winters capacity forecast', () => {
  const adminKey = 'holt-admin-key';
  test('returns holtWinters forecast with resource entry', async () => {
    // Create resource
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key', adminKey)
      .send({ id:'violin', name:'Violin', capacityMinutes:200 })
      .expect(201);
    expect(createRes.body.resource.version).toBe(1);

    // Generate multiple snapshots by creating bookings & scraping metrics
    const now = Date.now();
    for(let i=0;i<8;i++){
      const startAt = now + (i+1)*60*60*1000; // stagger future starts
      await request(app)
        .post('/api/booking/create')
        .send({ booking_id:`b_v_${i}`, user_id:`u_v_${i}`, slot_id:`slotV${i}`, resource_id:'violin', start_at:startAt, duration_min:30 })
        .expect(200);
      // Metrics scrape (records snapshot & broadcasts)
      await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-key', adminKey)
        .expect(200);
    }

    // Hit forecast endpoint
    const forecastRes = await request(app)
      .get('/api/admin/resources/capacity-forecast')
      .set('x-admin-key', adminKey)
      .expect(200);
    expect(forecastRes.body.holtWinters).toBeTruthy();
    expect(Array.isArray(forecastRes.body.holtWinters.forecast)).toBe(true);
    const violinEntry = forecastRes.body.holtWinters.forecast.find(f=>f.id==='violin');
    expect(violinEntry).toBeTruthy();
    expect(typeof violinEntry.projectedUtilizationPercent).toBe('number');
    expect(violinEntry.method).toBeTruthy();
  });
});

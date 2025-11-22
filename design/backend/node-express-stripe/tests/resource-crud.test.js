process.env.ADMIN_API_KEY = 'primary-key';
const request = require('supertest');
const app = require('../server');

// Resource CRUD integration tests
// Validates dynamic catalog creation, update, deactivation and capacity override in metrics.

describe('resource catalog CRUD', () => {
  test('create, update capacity, deactivate lifecycle', async () => {
    // Create resource harp
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','primary-key')
      .send({ id:'harp', name:'Harp', capacityMinutes:90 })
      .expect(201);
    expect(createRes.body.created).toBe(true);
    expect(createRes.body.resource.id).toBe('harp');
    expect(createRes.body.resource.capacityMinutes).toBe(90);

    // GET resources returns catalog with harp and merged capacities
    const listRes = await request(app)
      .get('/api/admin/resources')
      .set('x-admin-key','primary-key')
      .expect(200);
    expect(Array.isArray(listRes.body.resources)).toBe(true);
    expect(listRes.body.resources.find(r=>r.id==='harp')).toBeTruthy();

    // Create booking on harp (60 minutes)
    const startAt = Date.now() + 60*60*1000; // future start
    const b1 = await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'b_harp_1', user_id:'u1', slot_id:'slotA', resource_id:'harp', start_at:startAt, duration_min:60 })
      .expect(200);
    expect(b1.body.booking.resource_id).toBe('harp');

    // Metrics reflect utilization ratio 60/90 = 0.666...
    const metrics1 = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key')
      .expect(200);
    const body1 = metrics1.text;
    expect(body1).toMatch(/melody_bookings_confirmed{resource_id="harp"} 1/);
    expect(body1).toMatch(/melody_bookings_confirmed_minutes{resource_id="harp"} 60/);
    // Allow small floating variance; just ensure starts with 0.66
    const utilLine = body1.split('\n').find(l=>l.includes('melody_bookings_utilization_percent{resource_id="harp"}'));
    expect(utilLine).toBeTruthy();
    expect(utilLine).toMatch(/0\.66/);

    // Update capacity to 120
    const patchRes = await request(app)
      .patch('/api/admin/resources/harp')
      .set('x-admin-key','primary-key')
      .send({ capacityMinutes:120, version: createRes.body.resource.version })
      .expect(200);
    expect(patchRes.body.resource.capacityMinutes).toBe(120);

    // Second booking 60 minutes -> total 120/120 => utilization 1
    const b2 = await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'b_harp_2', user_id:'u2', slot_id:'slotA', resource_id:'harp', start_at:startAt + 2*60*60*1000, duration_min:60 })
      .expect(200);
    expect(b2.body.booking.resource_id).toBe('harp');

    const metrics2 = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key')
      .expect(200);
    const body2 = metrics2.text;
    const utilLine2 = body2.split('\n').find(l=>l.includes('melody_bookings_utilization_percent{resource_id="harp"}'));
    expect(utilLine2).toMatch(/ 1(\.0+)?$/);

    // Deactivate resource
    const delRes = await request(app)
      .delete('/api/admin/resources/harp')
      .set('x-admin-key','primary-key')
      .send({ version: patchRes.body.resource.version })
      .expect(200);
    expect(delRes.body.resource.active).toBe(false);

    // Attempt booking create after deactivation -> should fail validation
    const b3 = await request(app)
      .post('/api/booking/create')
      .send({ booking_id:'b_harp_3', user_id:'u3', slot_id:'slotA', resource_id:'harp', start_at:startAt + 3*60*60*1000, duration_min:30 })
      .expect(400);
    expect(b3.body.error).toBe('resource_id_invalid');
  });
});

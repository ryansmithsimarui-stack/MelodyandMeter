const request = require('supertest');
const app = require('../server');

// Helper to create booking with provided resource_id
function create(body){
  return request(app).post('/api/booking/create').send(body);
}

describe('resource_id validation', () => {
  test('rejects invalid resource_id when ALLOWED_RESOURCE_IDS set', async () => {
    process.env.ALLOWED_RESOURCE_IDS = 'primary,roomA';
    const res = await create({ booking_id:'rid1', user_id:'u1', slot_id:'s1', resource_id:'roomB', start_at: Date.now()+3600000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resource_id_invalid');
    expect(Array.isArray(res.body.allowed)).toBe(true);
  });
  test('accepts allowed resource_id', async () => {
    process.env.ALLOWED_RESOURCE_IDS = 'primary,roomA';
    const res = await create({ booking_id:'rid2', user_id:'u1', slot_id:'s2', resource_id:'roomA', start_at: Date.now()+7200000 });
    expect(res.status).toBe(200);
    expect(res.body.booking.resource_id).toBe('roomA');
  });
  test('defaults to primary when resource_id omitted', async () => {
    process.env.ALLOWED_RESOURCE_IDS = 'primary,roomA';
    const res = await create({ booking_id:'rid3', user_id:'u1', slot_id:'s3', start_at: Date.now()+10800000 });
    expect(res.status).toBe(200);
    expect(res.body.booking.resource_id).toBe('primary');
  });
  test('accepts any resource_id when allowlist unset', async () => {
    const original = process.env.ALLOWED_RESOURCE_IDS;
    delete process.env.ALLOWED_RESOURCE_IDS;
    const res = await create({ booking_id:'rid4', user_id:'u1', slot_id:'s4', resource_id:'unlistedXYZ', start_at: Date.now()+14400000 });
    expect(res.status).toBe(200);
    expect(res.body.booking.resource_id).toBe('unlistedXYZ');
    if(original) process.env.ALLOWED_RESOURCE_IDS = original; else delete process.env.ALLOWED_RESOURCE_IDS;
  });
});

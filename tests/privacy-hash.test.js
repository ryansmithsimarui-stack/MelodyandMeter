const request = require('supertest');

// We need to set the env flag before requiring the app so analytics.js picks it up.
process.env.ENFORCE_USER_ID_HASH = 'true';
process.env.ADMIN_API_KEY = 'hash-admin-key';

const app = require('../server');

function sha256Hex(str){
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(str).digest('hex');
}

describe('Privacy Hash Enforcement', () => {
  beforeAll(async () => {
    await request(app).post('/__test/reset-persistence');
  });

  test('rejects raw email user_id in booking_started when enforcement enabled', async () => {
    const res = await request(app)
      .post('/api/booking/instrument')
      .send({ action: 'start', booking_id: 'bhash1', user_id: 'parent@example.com', channel: 'web' });
    // Endpoint itself does not know about hashing; trackEvent returns stored:false -> no persistence
    // We expect 200 response (current endpoint pattern) but event should not be stored; verify via listing later
    expect(res.status).toBe(200);
  });

  test('accepts hashed user_id', async () => {
    const hashed = sha256Hex('parent@example.com:demo');
    const res = await request(app)
      .post('/api/booking/instrument')
      .send({ action: 'start', booking_id: 'bhash2', user_id: hashed });
    expect(res.status).toBe(200);
  });

  test('only hashed event appears in admin listing', async () => {
    const list = await request(app)
      .get('/api/admin/analytics-events')
      .set('x-admin-key','hash-admin-key');
    expect(list.status).toBe(200);
    const events = list.body.events.map(e=>e.name);
    expect(events).toContain('booking_started');
    // There should be exactly one booking_started (hashed one) since the raw email version was rejected.
    const count = list.body.events.filter(e=>e.name==='booking_started').length;
    expect(count).toBe(1);
  });
});

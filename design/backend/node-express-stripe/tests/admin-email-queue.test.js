const request = require('supertest');

// Set admin key before requiring app
process.env.ADMIN_API_KEY = 'test-admin-key';
const app = require('../server');

describe('Admin email queue endpoint', () => {
  test('rejects without key', async () => {
    const res = await request(app).get('/api/admin/email-queue');
    expect(res.status).toBe(401); // unauthorized
    expect(res.body.error).toBe('unauthorized');
  });

  test('403 when key not configured (simulate)', async () => {
    delete process.env.ADMIN_API_KEY;
    const res = await request(app).get('/api/admin/email-queue').set('x-admin-key','anything');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('admin_key_not_configured');
    process.env.ADMIN_API_KEY = 'test-admin-key';
  });

  test('returns metrics with valid key', async () => {
    const res = await request(app).get('/api/admin/email-queue').set('x-admin-key','test-admin-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('metrics');
    expect(res.body.metrics).toHaveProperty('emailSuccess');
    expect(res.body.metrics).toHaveProperty('emailPermanentFailure');
    expect(res.body).toHaveProperty('depth');
    expect(Array.isArray(res.body.pending)).toBe(true);
  });
});

const request = require('supertest');

// Configure environment before requiring app
process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_API_KEY_SECONDARY = 'secondary-key';
process.env.ADMIN_RATE_LIMIT_MAX = '2';

const app = require('../server');

async function resetAdminLimiter(){
  await request(app).post('/__test/reset-admin-rate-limit');
}

function getAudit(limit){
  return request(app)
    .get('/api/admin/audit')
    .set('x-admin-key','primary-key')
    .query(limit ? { limit } : {});
}

describe('Admin audit & key rotation', () => {
  test('secondary key works and returns header', async () => {
    await resetAdminLimiter();
    const res = await request(app)
      .get('/api/admin/email-queue')
      .set('x-admin-key','secondary-key');
    expect(res.status).toBe(200);
    expect(res.headers['x-admin-key-id']).toBe('secondary');
  });

  test('rate limiter enforced for admin endpoints', async () => {
    await resetAdminLimiter();
    // First two should pass
    const r1 = await request(app).get('/api/admin/email-queue').set('x-admin-key','primary-key');
    expect(r1.status).toBe(200);
    const r2 = await request(app).get('/api/admin/email-queue').set('x-admin-key','primary-key');
    expect(r2.status).toBe(200);
    // Third should 429
    const r3 = await request(app).get('/api/admin/email-queue').set('x-admin-key','primary-key');
    expect(r3.status).toBe(429);
    expect(r3.body.error).toBe('admin_rate_limited');
  });

  test('webhook events create audit entries', async () => {
    await resetAdminLimiter();
    // good -> invoice.paid
    const body = JSON.stringify({ any:'thing' });
    const w1 = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature','good')
      .set('Content-Type','application/json')
      .send(body);
    expect(w1.status).toBe(200);
    // subscription created
    const w2 = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature','sub_created')
      .set('Content-Type','application/json')
      .send(body);
    expect(w2.status).toBe(200);

    await resetAdminLimiter();
    const auditRes = await getAudit(100);
    expect(auditRes.status).toBe(200);
    const actions = auditRes.body.entries.map(e=>e.action);
    expect(actions).toContain('invoice.paid');
    expect(actions).toContain('subscription.created');
  });

  test('audit limit parameter reduces returned entries', async () => {
    await resetAdminLimiter();
    const full = await getAudit(100);
    expect(full.body.entries.length).toBeGreaterThan(1);
    await resetAdminLimiter();
    const limited = await getAudit(1);
    expect(limited.body.entries.length).toBe(1);
    expect(limited.body.total).toBeGreaterThanOrEqual(full.body.entries.length); // total is overall size
  });
});

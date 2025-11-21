const request = require('supertest');
const app = require('../server');

describe('Validation & Health endpoints', () => {
  test('registration rejects invalid email', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'bad', firstName: 'Alex' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });

  test('registration duplicate email', async () => {
    const first = await request(app).post('/api/auth/register').send({ email: 'parent@example.com', firstName: 'Alex' });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/auth/register').send({ email: 'parent@example.com', firstName: 'Alex' });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('already registered');
  });

  test('subscription invalid priceId', async () => {
    const res = await request(app).post('/api/billing/subscriptions').send({ email: 'parent@example.com', priceId: 'bad', payment_method_id: 'pm_123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_price_id');
  });

  test('subscription invalid payment_method_id', async () => {
    const res = await request(app).post('/api/billing/subscriptions').send({ email: 'parent@example.com', priceId: 'price_ABC', payment_method_id: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payment_method_id');
  });

  test('health endpoint ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  test('central error handler returns internal_error', async () => {
    const res = await request(app).get('/api/test/error');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
    expect(res.body.request_id).toBeTruthy();
  });
});

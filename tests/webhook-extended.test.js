const request = require('supertest');
const app = require('../server');

describe('Extended Stripe webhook events', () => {
  test('handles invoice.payment_failed event, sends email, increments metrics', async () => {
    const originalLog = console.log; const logs = []; console.log = (...a)=>{ logs.push(a.join(' ')); };
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'invoice_failed')
      .send({ test: true });
    console.log = originalLog;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const failureEmailLog = logs.find(l=>l.includes('[DEV EMAIL]') && l.includes('Payment Issue - Action Required') && l.includes('failed@example.com'));
    expect(failureEmailLog).toBeTruthy();
    // Check metrics include payment_failed counter
    process.env.ADMIN_API_KEY = 'metrics-key';
    const metricsRes = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','metrics-key');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.text).toMatch(/melody_webhook_invoice_payment_failed_total/);
  });

  test('handles customer.subscription.created event', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sub_created')
      .send({ test: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  test('handles customer.subscription.updated event', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sub_updated')
      .send({ test: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  test('still rejects invalid signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'totally_invalid')
      .send({ test: true });
    expect(res.status).toBe(400);
  });
});

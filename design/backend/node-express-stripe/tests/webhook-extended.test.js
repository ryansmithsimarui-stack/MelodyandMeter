const request = require('supertest');
const { generateStripeSignature } = require('./helpers/stripeTestSignature');
const app = require('../server');

describe('Extended Stripe webhook events', () => {
  test('handles invoice.payment_failed event, sends email, increments metrics', async () => {
    const originalLog = console.log; const logs = []; console.log = (...a)=>{ logs.push(a.join(' ')); };
    const event = { id:'evt_failed_1', type:'invoice.payment_failed', data:{ object:{ id:'in_fail_123', number:'001', amount_paid:0, amount_due:25000, currency:'usd', customer_email:'failed@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(payload);
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
    const event = { id:'evt_sub_create_1', type:'customer.subscription.created', data:{ object:{ id:'sub_test_create' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  test('handles customer.subscription.updated event', async () => {
    const event = { id:'evt_sub_update_1', type:'customer.subscription.updated', data:{ object:{ id:'sub_test_update' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  test('still rejects invalid signature', async () => {
    const event = { id:'evt_bad_sig', type:'invoice.paid', data:{ object:{ id:'in_bad_1', amount_paid:1000, currency:'usd', customer_email:'x@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    // Corrupt signature by changing last char
    const badSig = sig.replace(/.$/, sig.slice(-1) === 'a' ? 'b' : 'a');
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', badSig)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error','signature_invalid');
  });
});

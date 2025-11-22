const request = require('supertest');
const crypto = require('crypto');

// Set env BEFORE requiring app
process.env.NODE_ENV = 'test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.ADMIN_API_KEY = 'adminkey';
// Force queue mode off for this test (email sending inline ok)
process.env.ALWAYS_QUEUE_EMAIL = 'false';

const app = require('../server');
const persistence = require('../persistence');

function generateHeader(payload){
  const timestamp = Math.floor(Date.now()/1000);
  const signedPayload = `${timestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('Stripe webhook invoice.paid integration', () => {
  test('valid signature: processes invoice.paid and records webhook + analytics', async () => {
    const event = {
      id: 'evt_test_paid_1',
      type: 'invoice.paid',
      data: { object: { id: 'in_test_1', number: '001', amount_paid: 12345, currency: 'USD', customer_email: 'parent@example.com' } }
    };
    const payload = JSON.stringify(event);
    const sig = generateHeader(payload);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .set('Content-Type','application/json')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('received', true);
    expect(persistence.getWebhookEventTotal()).toBeGreaterThanOrEqual(1);
    expect(persistence.getAnalyticsEventTotal()).toBeGreaterThanOrEqual(1);
  });

  test('invalid signature: rejected with 400', async () => {
    const event = {
      id: 'evt_test_paid_2',
      type: 'invoice.paid',
      data: { object: { id: 'in_test_2', number: '002', amount_paid: 5000, currency: 'USD', customer_email: 'parent@example.com' } }
    };
    const payload = JSON.stringify(event);
    const validSig = generateHeader(payload);
    // Tamper payload after generating header to force invalid signature
    const tampered = JSON.stringify({ ...event, extra:'x' });
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', validSig)
      .set('Content-Type','application/json')
      .send(tampered);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error','signature_invalid');
  });
});

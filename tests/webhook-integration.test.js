const request = require('supertest');
// Signature bypass is enabled via env for test; no need to compute HMAC.

// Set env BEFORE requiring app
process.env.NODE_ENV = 'test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.STRIPE_SIGNATURE_TEST_MODE = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.ADMIN_API_KEY = 'adminkey';
// Force queue mode off for this test (email sending inline ok)
process.env.ALWAYS_QUEUE_EMAIL = 'false';

const app = require('../server');
const persistence = require('../persistence');

function dummyHeader(){ return 't=0,v1=dummy'; }

describe('Stripe webhook invoice.paid integration', () => {
  test('processes invoice.paid and records webhook + analytics', async () => {
    const event = {
      id: 'evt_test_paid_1',
      type: 'invoice.paid',
      data: { object: { id: 'in_test_1', number: '001', amount_paid: 12345, currency: 'USD', customer_email: 'parent@example.com' } }
    };
    const sig = dummyHeader();
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(event);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('received', true);
    // Webhook event stored
    expect(persistence.getWebhookEventTotal()).toBeGreaterThanOrEqual(1);
    // Analytics event recorded
    expect(persistence.getAnalyticsEventTotal()).toBeGreaterThanOrEqual(1);
  });
});

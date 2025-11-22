const request = require('supertest');
const { generateStripeSignature } = require('./helpers/stripeTestSignature');

// Configure multiple secrets before server is loaded
process.env.STRIPE_WEBHOOK_SECRETS = 'whsec_primary_a,whsec_rotated_b';
process.env.STRIPE_SIG_TOLERANCE_SEC = '120';

const app = require('../server');

describe('Stripe webhook signature hardening', () => {
  test('accepts valid signature with primary secret', async () => {
    const event = { id:'evt_harden_primary', type:'customer.subscription.created', data:{ object:{ id:'sub_primary_1' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload, Math.floor(Date.now()/1000), 'whsec_primary_a');
    const res = await request(app).post('/api/webhooks/stripe').set('stripe-signature', sig).send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received:true });
  });
  test('accepts valid signature with rotated secret', async () => {
    const event = { id:'evt_harden_rotated', type:'customer.subscription.updated', data:{ object:{ id:'sub_rotated_1' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload, Math.floor(Date.now()/1000), 'whsec_rotated_b');
    const res = await request(app).post('/api/webhooks/stripe').set('stripe-signature', sig).send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received:true });
  });
  test('rejects stale timestamp outside tolerance', async () => {
    const pastTs = Math.floor(Date.now()/1000) - 1000; // older than 120s tolerance
    const event = { id:'evt_harden_stale', type:'invoice.paid', data:{ object:{ id:'in_harden_stale', number:'stale', amount_paid:1000, currency:'usd', customer_email:'stale@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload, pastTs, 'whsec_primary_a');
    const res = await request(app).post('/api/webhooks/stripe').set('stripe-signature', sig).send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error','signature_stale');
  });
  test('rejects invalid signature when payload altered', async () => {
    const event = { id:'evt_harden_invalid', type:'invoice.payment_failed', data:{ object:{ id:'in_harden_invalid', number:'inv', amount_due:5000, currency:'usd', customer_email:'inv@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload, Math.floor(Date.now()/1000), 'whsec_primary_a');
    // Alter payload after signature
    const tampered = payload.replace('inv@example.com', 'other@example.com');
    const res = await request(app).post('/api/webhooks/stripe').set('stripe-signature', sig).send(tampered);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error','signature_invalid');
  });
});

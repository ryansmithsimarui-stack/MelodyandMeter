const request = require('supertest');
const { generateStripeSignature } = require('./helpers/stripeTestSignature');
const app = require('../server');

describe('Stripe webhook success handling', () => {
  test('returns 200 and received:true on valid invoice.paid event and logs email send', async () => {
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => { logs.push(args.join(' ')); }; // capture
    const event = { id:'evt_success_1', type:'invoice.paid', data:{ object:{ id:'in_success_123', number:'001', amount_paid:2500, currency:'usd', customer_email:'webhook@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(payload);
    console.log = originalLog; // restore
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const emailLog = logs.find(l => l.includes('[DEV EMAIL]') && l.includes('Payment Receipt'));
    expect(emailLog).toBeTruthy();
    expect(emailLog).toContain('webhook@example.com');
  });

  test('returns 400 on invalid signature', async () => {
    const event = { id:'evt_bad_success', type:'invoice.paid', data:{ object:{ id:'in_bad_success', number:'001', amount_paid:2500, currency:'usd', customer_email:'webhook@example.com' } } };
    const payload = JSON.stringify(event);
    const goodSig = generateStripeSignature(payload);
    const badSig = goodSig.replace(/.$/, goodSig.slice(-1)==='a' ? 'b':'a');
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', badSig)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error','signature_invalid');
  });
});

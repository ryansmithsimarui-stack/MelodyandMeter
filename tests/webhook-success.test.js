const request = require('supertest');
const app = require('../server');

describe('Stripe webhook success handling', () => {
  test('returns 200 and received:true on valid invoice.paid event and logs email send', async () => {
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => { logs.push(args.join(' ')); }; // capture
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'good')
      .send({ test: true });
    console.log = originalLog; // restore
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const emailLog = logs.find(l => l.includes('[DEV EMAIL]') && l.includes('Payment Receipt'));
    expect(emailLog).toBeTruthy();
    expect(emailLog).toContain('webhook@example.com');
  });

  test('returns 400 on invalid signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'bad')
      .send({ test: true });
    expect(res.status).toBe(400);
  });
});

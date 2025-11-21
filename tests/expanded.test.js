jest.mock('stripe');
const request = require('supertest');
const app = require('../server');

function genEmail(prefix, i){ return `${prefix}${i}@example.com`; }

describe('Expanded coverage', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
    await request(app).post('/__test/reset-rate-limits');
  });
  // Run verification before exhausting registration rate limit
  test('verification flow success and not_found', async () => {
    const email = 'verifyflow@example.com';
    const nf = await request(app).post('/api/auth/verify').send({ email });
    expect(nf.status).toBe(404);
    await request(app).post('/api/auth/register').send({ email, firstName: 'Parent' });
    const v = await request(app).post('/api/auth/verify').send({ email });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('verified');
  });

  test('registration rate limit after 5 attempts', async () => {
    await request(app).post('/__test/reset-rate-limits');
    let lastStatus;
    for(let i=1;i<=6;i++){
      const res = await request(app).post('/api/auth/register').send({ email: genEmail('rate', i), firstName: 'Parent' });
      lastStatus = res.status;
      if(i<6){ expect(res.status).not.toBe(429); }
    }
    expect(lastStatus).toBe(429);
  });

  test('setup-intent returns client_secret and customerId', async () => {
    const email = 'setupintent@example.com';
    const res = await request(app).post('/api/payments/setup-intent').send({ email });
    expect(res.status).toBe(200);
    expect(res.body.client_secret).toMatch(/^seti_secret_/);
    expect(res.body.customerId).toMatch(/^cus_test_/);
  });

  test('subscription success with valid ids', async () => {
    const email = 'subsuccess@example.com';
    const res = await request(app).post('/api/billing/subscriptions').send({ email, priceId: 'price_ABC123', payment_method_id: 'pm_DEF456' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('sub_test');
    expect(res.body.items[0].price).toBe('price_ABC123');
  });

  test('trial follow-up rate limit after 10 attempts', async () => {
    await request(app).post('/__test/reset-rate-limits');
    let finalStatus;
    for(let i=1;i<=11;i++){
      const res = await request(app).post('/api/emails/trial-followup').send({ email: genEmail('trial', i), parentFirstName:'A', studentFirstName:'B' });
      finalStatus = res.status;
      if(i<11){ expect(res.status).not.toBe(429); }
    }
    expect(finalStatus).toBe(429);
  });

  test('webhook invalid signature returns 400', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature','bad')
      .set('Content-Type','application/json')
      .send(JSON.stringify({type:'invoice.paid'}));
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Webhook Error:/);
  });
});

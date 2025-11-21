const request = require('supertest');

// Configure admin keys before app load
process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_API_KEY_SECONDARY = 'secondary-key';

const app = require('../server');

describe('Analytics instrumentation & persistence', () => {
  test('payment_success webhook emits analytics event', async () => {
    // Reset persistence to start clean
    await request(app).post('/__test/reset-persistence');
    const invoiceObj = { id:'in_123', amount_paid: 2500, currency:'USD', customer_email:'track@example.com' };
    const payload = Buffer.from(JSON.stringify({ id:'evt_pay_success', type:'invoice.paid', data:{ object: invoiceObj } }));
    const res = await request(app).post('/api/webhooks/stripe').set('stripe-signature','good').send(payload);
    expect(res.status).toBe(200);
    // List analytics events via admin endpoint
    const list = await request(app).get('/api/admin/analytics-events?limit=10').set('x-admin-key','primary-key');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    const names = list.body.events.map(e=>e.name);
    expect(names).toContain('payment_success');
  });

  test('batch API persists accepted analytics events', async () => {
    await request(app).post('/__test/reset-persistence');
    const ts = Date.now();
    const batchRes = await request(app).post('/api/analytics/events').send({
      events: [
        { name:'booking_started', payload:{ booking_id:'b77', user_id:'u1', ts } },
        { name:'mobile_screen_view', payload:{ screen:'dashboard', user_id:'u1', ts } }
      ]
    });
    expect(batchRes.status).toBe(200);
    const list = await request(app).get('/api/admin/analytics-events?limit=5').set('x-admin-key','primary-key');
    expect(list.status).toBe(200);
    const names = list.body.events.map(e=>e.name);
    expect(names).toEqual(expect.arrayContaining(['booking_started','mobile_screen_view']));
  });
});

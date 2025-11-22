const request = require('supertest');
process.env.ADMIN_API_KEY = 'window-admin-key';
process.env.WEBHOOK_REPLAY_WINDOW_MS = '1000'; // 1s window
const { generateStripeSignature } = require('./helpers/stripeTestSignature');
const app = require('../server');

function extractMetric(text, name){
  const line = text.split('\n').find(l=>l.startsWith(name+' '));
  if(!line) return 0;
  const parts = line.trim().split(/\s+/);
  return parseFloat(parts[1]);
}

async function fetchMetrics(){
  return request(app).get('/api/admin/metrics').set('x-admin-key','window-admin-key');
}

describe('Configurable webhook replay window', () => {
  test('same event id reprocessed after window expires', async () => {
    const event = { id:'evt_replay_window', type:'invoice.paid', data:{ object:{ id:'in_window_1', number:'001', amount_paid:1111, currency:'usd', customer_email:'rw@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    const first = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature',sig)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received:true });
    const m1 = await fetchMetrics();
    expect(m1.status).toBe(200);
    const paidCount1 = extractMetric(m1.text,'melody_webhook_invoice_paid_total');

    // Wait for > window
    await new Promise(r=>setTimeout(r,1100));

    const second = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature',sig)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received:true }); // not replay_ignored
    const m2 = await fetchMetrics();
    const paidCount2 = extractMetric(m2.text,'melody_webhook_invoice_paid_total');
    expect(paidCount2).toBeGreaterThan(paidCount1); // counter incremented again

    // replay window metric present
    const replayWindowMetric = extractMetric(m2.text,'melody_webhook_replay_window_ms');
    expect(replayWindowMetric).toBe(1000);
  });
});

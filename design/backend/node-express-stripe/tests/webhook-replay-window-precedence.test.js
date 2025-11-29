const request = require('supertest');
// Set both env vars before server import to test precedence
process.env.ADMIN_API_KEY = 'replay-window-precedence-key';
process.env.STRIPE_REPLAY_WINDOW_SEC = '7200'; // 2h window (should take precedence)
process.env.WEBHOOK_REPLAY_WINDOW_MS = '1000'; // legacy value should be ignored
const { generateStripeSignature } = require('./helpers/stripeTestSignature');
const app = require('../server');

function extractMetric(text, name){
  const line = text.split('\n').find(l=>l.startsWith(name+' '));
  if(!line) return 0;
  const parts = line.trim().split(/\s+/);
  return parseFloat(parts[1]);
}

async function fetchMetrics(){
  return request(app).get('/api/admin/metrics').set('x-admin-key','replay-window-precedence-key');
}

describe('Replay window precedence (seconds over legacy ms)', () => {
  test('duplicate event remains blocked when seconds window overrides small legacy ms value', async () => {
    const event = { id:'evt_replay_prec', type:'invoice.paid', data:{ object:{ id:'in_prec_1', number:'P001', amount_paid:5555, currency:'usd', customer_email:'prec@example.com' } } };
    const payload = JSON.stringify(event);
    const sig = generateStripeSignature(payload);
    const first = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received:true });

    // Wait beyond legacy 1s but far below 2h seconds window
    await new Promise(r=>setTimeout(r,1100));

    const second = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(payload);
    expect(second.status).toBe(200);
    // Should be blocked (replay_ignored) because 2h seconds window took precedence
    expect(second.body).toHaveProperty('replay_ignored', true);

    const metricsRes = await fetchMetrics();
    expect(metricsRes.status).toBe(200);
    const configuredWindow = extractMetric(metricsRes.text,'melody_webhook_replay_window_ms');
    expect(configuredWindow).toBe(7200*1000); // 2h in ms
  });
});

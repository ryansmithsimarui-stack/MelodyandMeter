const request = require('supertest');
process.env.ADMIN_API_KEY = 'replay-admin-key';
const app = require('../server');

async function fetchMetrics(){
  return request(app).get('/api/admin/metrics').set('x-admin-key','replay-admin-key');
}

describe('Webhook replay protection', () => {
  test('duplicate event ignored and counters not incremented twice', async () => {
    // First delivery
    const first = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature','good')
      .send({ any:true });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received:true });
    const m1 = await fetchMetrics();
    expect(m1.status).toBe(200);
    const paidCount1 = extractMetric(m1.text, 'melody_webhook_invoice_paid_total');
    expect(paidCount1).toBeGreaterThanOrEqual(1);

    // Replay same event id/signature
    const second = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature','good')
      .send({ any:true });
    expect(second.status).toBe(200);
    expect(second.body).toHaveProperty('replay_ignored', true);
    const m2 = await fetchMetrics();
    const paidCount2 = extractMetric(m2.text, 'melody_webhook_invoice_paid_total');
    expect(paidCount2).toBe(paidCount1); // no increment
  });
});

function extractMetric(text, name){
  const line = text.split('\n').find(l=>l.startsWith(name+' '));
  if(!line) return 0;
  const parts = line.trim().split(/\s+/);
  return parseFloat(parts[1]);
}

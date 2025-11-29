const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'adminkey';
const app = require('../server');

function collectHeaderLines(text){
  return text.split('\n').filter(l => l.startsWith('# HELP') || l.startsWith('# TYPE'));
}

describe('Metrics header stability', () => {
  test('baseline HELP/TYPE metrics present', async () => {
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','adminkey');
    expect(res.status).toBe(200);
    const headerLines = collectHeaderLines(res.text);
    // Ensure core baseline metrics remain; allow additive metrics without snapshot churn.
    const required = [
      '# HELP melody_email_success_total',
      '# HELP melody_email_permanent_failure_total',
      '# HELP melody_webhook_events_stored_total',
      '# HELP melody_webhook_invoice_paid_total',
      '# HELP melody_webhook_subscription_created_total'
    ];
    for(const r of required){
      expect(headerLines.find(l=>l.startsWith(r))).toBeTruthy();
    }
    // Still expect a reasonable number of metric HELP/TYPE lines.
    expect(headerLines.length).toBeGreaterThan(15);
  });
});

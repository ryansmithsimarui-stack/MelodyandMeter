const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'adminkey';
const app = require('../server');

function collectHeaderLines(text){
  return text.split('\n').filter(l => l.startsWith('# HELP') || l.startsWith('# TYPE'));
}

describe('Metrics header stability', () => {
  test('required HELP/TYPE metric headers present', async () => {
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','adminkey');
    expect(res.status).toBe(200);
    const headerLines = collectHeaderLines(res.text);
    expect(headerLines.length).toBeGreaterThan(25); // baseline count sanity
    const requiredHelp = [
      '# HELP melody_analytics_events_total',
      '# HELP melody_bookings_confirmed_total',
      '# HELP melody_email_success_total',
      '# HELP melody_webhook_events_stored_total',
      '# HELP melody_webhook_unhandled_event_total'
    ];
    const requiredType = [
      '# TYPE melody_analytics_events_total',
      '# TYPE melody_bookings_confirmed_total',
      '# TYPE melody_email_success_total',
      '# TYPE melody_webhook_events_stored_total',
      '# TYPE melody_webhook_unhandled_event_total'
    ];
    for (const h of requiredHelp) {
      expect(headerLines.find(l => l.startsWith(h))).toBeTruthy();
    }
    for (const t of requiredType) {
      expect(headerLines.find(l => l.startsWith(t))).toBeTruthy();
    }
  });
});

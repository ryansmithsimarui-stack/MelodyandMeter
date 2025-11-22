const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'adminkey';

const app = require('../server');

function pickLines(text){
  return text.split('\n').filter(l => (
    l.startsWith('melody_email_queue_depth') ||
    l.startsWith('melody_booking_duration_minutes_bucket{le="+Inf"}') ||
    l.startsWith('melody_bookings_confirmed_total') ||
    l.startsWith('melody_webhook_events_stored_total')
  ));
}

describe('Metrics snapshot stability', () => {
  test('selected metric lines present', async () => {
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','adminkey');
    expect(res.status).toBe(200);
    const subset = pickLines(res.text).sort();
    expect(subset.length).toBeGreaterThan(0);
    // Basic invariants
    subset.forEach(line => expect(line).toMatch(/\s[0-9.]+$/));
  });
});

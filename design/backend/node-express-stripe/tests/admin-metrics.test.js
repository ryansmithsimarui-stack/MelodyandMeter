const request = require('supertest');

process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_API_KEY_SECONDARY = 'secondary-key';
process.env.ADMIN_RATE_LIMIT_MAX = '5';

const app = require('../server');

async function resetAdminLimiter(){
  await request(app).post('/__test/reset-admin-rate-limit');
}

describe('Admin metrics endpoint', () => {
  test('returns Prometheus metrics with expected keys', async () => {
    await resetAdminLimiter();
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    const body = res.text;
    expect(body).toMatch(/melody_email_success_total/);
    expect(body).toMatch(/melody_email_permanent_failure_total/);
    expect(body).toMatch(/melody_email_queue_depth/);
    expect(body).toMatch(/melody_audit_log_entries_total/);
    // New expanded metrics
    expect(body).toMatch(/melody_email_jobs_success_total/);
    expect(body).toMatch(/melody_email_jobs_permanent_failure_total/);
    expect(body).toMatch(/melody_webhook_events_stored_total/);
    expect(body).toMatch(/melody_webhook_invoice_paid_total/);
    expect(body).toMatch(/melody_webhook_invoice_payment_failed_total/);
    expect(body).toMatch(/melody_webhook_subscription_created_total/);
    expect(body).toMatch(/melody_webhook_subscription_updated_total/);
    expect(body).toMatch(/melody_webhook_unhandled_event_total/);
    // New booking gauges
    expect(body).toMatch(/melody_bookings_confirmed_total/);
    expect(body).toMatch(/melody_bookings_confirmed\{resource_id=/);
    expect(body).toMatch(/melody_bookings_confirmed_minutes_total/);
    expect(body).toMatch(/melody_bookings_confirmed_minutes\{resource_id=/);
    // Late cancellation counters (initially zero sample emitted)
    expect(body).toMatch(/melody_bookings_cancelled_late_total/);
    expect(body).toMatch(/melody_bookings_cancelled_late\{resource_id=/);
    expect(res.headers['x-admin-key-id']).toBe('primary');
  });

  test('late cancellation increments metrics', async () => {
    await resetAdminLimiter();
    const bookingId = 'b_late_1';
    const now = Date.now();
    // Start time 2 hours ahead (inside penalty window <24h but >1h hard cutoff)
    const startAt = now + 2*60*60*1000;
    // Create booking
    const createRes = await request(app)
      .post('/api/booking/create')
      .send({ booking_id: bookingId, user_id: 'user@example.com', slot_id: 'slotA', start_at: startAt, duration_min: 30 });
    expect(createRes.status).toBe(200);
    // Cancel booking triggering late penalty
    const cancelRes = await request(app)
      .post('/api/booking/cancel')
      .send({ booking_id: bookingId, user_id: 'user@example.com', reason_code: 'user_request' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.penalty_reason).toBe('late_cancel');
    // Fetch metrics
    const metricsRes = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key');
    expect(metricsRes.status).toBe(200);
    const body = metricsRes.text;
    expect(body).toMatch(/melody_bookings_cancelled_late_total 1/);
    expect(body).toMatch(/melody_bookings_cancelled_late\{resource_id="primary"} 1/);
  });

  test('confirmed booking minutes aggregates duration', async () => {
    await resetAdminLimiter();
    const bookingId = 'b_minutes_1';
    const startAt = Date.now() + 48*60*60*1000; // 48h in future (outside reschedule/cancel windows)
    const createRes = await request(app)
      .post('/api/booking/create')
      .send({ booking_id: bookingId, user_id: 'dur@example.com', slot_id: 'slotDurA', start_at: startAt, duration_min: 45 });
    expect(createRes.status).toBe(200);
    const metricsRes = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','primary-key');
    expect(metricsRes.status).toBe(200);
    const body = metricsRes.text;
    expect(body).toMatch(/melody_bookings_confirmed_minutes_total .*45/);
    expect(body).toMatch(/melody_bookings_confirmed_minutes\{resource_id="primary"} 45/);
  });

  test('unauthorized without admin key', async () => {
    await resetAdminLimiter();
    const res = await request(app)
      .get('/api/admin/metrics');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });
});

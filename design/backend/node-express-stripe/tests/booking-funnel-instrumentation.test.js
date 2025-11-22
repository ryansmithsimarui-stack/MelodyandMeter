const request = require('supertest');
process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_API_KEY_SECONDARY = 'secondary-key';
const app = require('../server');

describe('Booking Funnel Instrumentation', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
    await request(app).post('/__test/reset-rate-limits');
    await request(app).post('/__test/reset-admin-rate-limit');
  });

  test('emits booking funnel events and lists them', async () => {
    // Start booking
    await request(app).post('/api/booking/instrument').send({ action:'start', booking_id:'b1', user_id:'u1', channel:'web' }).expect(200);
    // View availability
    await request(app).post('/api/booking/instrument').send({ action:'view_availability', user_id:'u1', instrument:'piano' }).expect(200);
    // Open a slot
    await request(app).post('/api/booking/instrument').send({ action:'open_slot', booking_id:'b1', slot_id:'slot123', user_id:'u1' }).expect(200);
    // Select slot
    await request(app).post('/api/booking/instrument').send({ action:'select_slot', booking_id:'b1', slot_id:'slot123', user_id:'u1' }).expect(200);
    // Confirm booking
    await request(app).post('/api/booking/instrument').send({ action:'confirm', booking_id:'b1', user_id:'u1', amount_cents:2500, currency:'usd' }).expect(200);
    // Subscription instrumentation (payment_initiated + booking_confirmed again)
    await request(app).post('/api/billing/subscriptions').send({ email:'parent@example.com', priceId:'price_ABC123', booking_id:'b1' }).expect(200);

    const listRes = await request(app).get('/api/admin/analytics-events?limit=20').set('x-admin-key','primary-key').expect(200);
    expect(listRes.body.events.length).toBeGreaterThanOrEqual(6);
    const names = listRes.body.events.map(e=>e.name);
    expect(names).toEqual(expect.arrayContaining([
      'booking_started',
      'booking_view_availability',
      'booking_slot_open',
      'booking_slot_selected',
      'booking_confirmed',
      'payment_initiated'
    ]));
  });
});

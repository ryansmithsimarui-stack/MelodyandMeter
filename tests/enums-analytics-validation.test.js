const request = require('supertest');
const app = require('../server');
const validation = require('../validation-stubs');

describe('Enum & Analytics Validation Stubs', () => {
  test('booking status transition valid path', async () => {
    const res = await request(app).post('/api/booking/validate-transition').send({ current:'DRAFT', next:'SLOT_SELECTED' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test('booking status transition invalid path', async () => {
    const res = await request(app).post('/api/booking/validate-transition').send({ current:'COMPLETED', next:'PAYMENT_PENDING' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  test('analytics events batch accepts valid and rejects invalid', async () => {
    const payload = {
      events: [
        { name:'booking_started', payload:{ booking_id:'b123', user_id:'u1', ts: Date.now() } },
        { name:'booking_started', payload:{ user_id:'u2', ts: Date.now() } }, // missing booking_id
        { name:'unknown_event', payload:{ foo:'bar' } }
      ]
    };
    const res = await request(app).post('/api/analytics/events').send(payload);
    expect(res.status).toBe(400); // errors present
    expect(res.body.accepted_count).toBe(1);
    expect(Array.isArray(res.body.errors)).toBe(true);
    const errorCodes = res.body.errors.map(e=>e.error).sort();
    expect(errorCodes).toContain('missing_field');
    expect(errorCodes).toContain('unknown_event');
  });

  test('analytics events batch all valid', async () => {
    const ts = Date.now();
    const res = await request(app).post('/api/analytics/events').send({
      events: [
        { name:'booking_started', payload:{ booking_id:'b1', user_id:'u1', ts } },
        { name:'mobile_screen_view', payload:{ screen:'dashboard', user_id:'u1', ts } }
      ]
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted_count).toBe(2);
  });

  test('batch too large guarded', async () => {
    const big = Array.from({ length: 101 }, (_,i)=>({ name:'booking_started', payload:{ booking_id:'b'+i, user_id:'u', ts: Date.now() } }));
    const res = await request(app).post('/api/analytics/events').send({ events: big });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].error).toBe('batch_too_large');
  });

  test('exports booking statuses & alert types', () => {
    expect(validation.BOOKING_STATUSES).toContain('DRAFT');
    expect(validation.ALERT_TYPES).toContain('payment_failure');
  });
});

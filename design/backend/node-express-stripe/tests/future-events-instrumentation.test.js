const request = require('supertest');
process.env.ADMIN_API_KEY = 'primary-key';
process.env.ADMIN_API_KEY_SECONDARY = 'secondary-key';
const app = require('../server');

describe('Future Events Instrumentation', () => {
  beforeEach(async () => {
    await request(app).post('/__test/reset-persistence');
    await request(app).post('/__test/reset-rate-limits');
    await request(app).post('/__test/reset-admin-rate-limit');
  });

  test('emits booking_cancelled, lesson_completed, practice_entry_added', async () => {
    // Create booking to satisfy new cancellation requirements
    const startAt = Date.now() + 48*60*60*1000; // 48h future
    await request(app).post('/api/booking/create').send({ booking_id:'b55', user_id:'u77', slot_id:'slotX', start_at:startAt }).expect(200);
    await request(app).post('/api/booking/cancel').send({ booking_id:'b55', user_id:'u77', reason_code:'conflict' }).expect(200);
    await request(app).post('/api/lesson/complete').send({ booking_id:'b55', teacher_id:'t9', duration_min:30 }).expect(200);
    await request(app).post('/api/practice/add-entry').send({ booking_id:'b55', student_id:'u77', tasks_count:3, entry_type:'note' }).expect(200);

    const resList = await request(app).get('/api/admin/analytics-events?limit=10').set('x-admin-key','primary-key').expect(200);
    const names = resList.body.events.map(e=>e.name);
    expect(names).toEqual(expect.arrayContaining([
      'booking_cancelled',
      'lesson_completed',
      'practice_entry_added'
    ]));
  });
});

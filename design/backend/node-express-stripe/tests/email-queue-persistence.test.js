const request = require('supertest');

// Force queue behavior even in test mode
process.env.ALWAYS_QUEUE_EMAIL = 'true';
process.env.ADMIN_API_KEY = 'queue-admin-key';

const app = require('../server');

async function resetAll(){
  await request(app).post('/__test/reset-persistence');
  await request(app).post('/__test/reset-rate-limits');
}

describe('Persisted email queue', () => {
  beforeEach(async ()=>{ await resetAll(); });

  test('trial follow-up enqueues persisted email job', async () => {
    const email = 'queueparent@example.com';
    const res = await request(app).post('/api/emails/trial-followup').send({ email, parentFirstName:'Alex', studentFirstName:'Jamie' });
    expect(res.status).toBe(200);
    const q = await request(app).get('/api/admin/email-queue').set('x-admin-key','queue-admin-key');
    expect(q.status).toBe(200);
    expect(q.body.depth).toBeGreaterThanOrEqual(1);
    expect(q.body.pending.some(j=>j.subject.includes('Trial'))).toBe(true);
  });

  test('dispatcher processes queued email job and reduces depth', async () => {
    const email = 'dispatchparent@example.com';
    await request(app).post('/api/emails/trial-followup').send({ email, parentFirstName:'Sam', studentFirstName:'Kit' });
    const before = await request(app).get('/api/admin/email-queue').set('x-admin-key','queue-admin-key');
    expect(before.body.depth).toBeGreaterThanOrEqual(1);
    const dispatchRes = await request(app).post('/__test/dispatch-email-jobs');
    expect(dispatchRes.status).toBe(200);
    const after = await request(app).get('/api/admin/email-queue').set('x-admin-key','queue-admin-key');
    expect(after.status).toBe(200);
    // Depth may be zero after success
    expect(after.body.depth).toBeLessThan(before.body.depth);
  });
});

const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.ALWAYS_QUEUE_EMAIL = 'true';
process.env.SIMULATE_EMAIL_FAILURE_ATTEMPTS = '10'; // force failures until max attempts hit
process.env.EMAIL_MAX_ATTEMPTS = '2';
process.env.EMAIL_BASE_DELAY_MS = '10';
const app = require('../server');
const persistence = require('../persistence');

describe('Email permanent failure path', () => {
  test('reaches permanent_failure after max attempts', async () => {
    const trig = await request(app)
      .post('/api/emails/trial-followup')
      .send({ email: 'pfailure@example.com', parentFirstName: 'Fail', studentFirstName: 'Case' });
    expect(trig.status).toBe(200);
    let job = persistence.getRecentEmailJobs(5)[0];
    expect(job.status).toBe('pending');
    // First attempt
    persistence.updateEmailJob(job.id, { nextAttemptAt: Date.now() });
    await request(app).post('/__test/dispatch-email-jobs');
    job = persistence.getRecentEmailJobs(5)[0];
    expect(job.attempts).toBe(1);
    expect(job.status).toBe('pending');
    // Second attempt -> should hit permanent failure (maxAttempts=2)
    persistence.updateEmailJob(job.id, { nextAttemptAt: Date.now() });
    await request(app).post('/__test/dispatch-email-jobs');
    job = persistence.getRecentEmailJobs(5)[0];
    expect(job.attempts).toBe(2);
    expect(job.status).toBe('permanent_failure');
    expect(job.lastError).toBeTruthy();
  });
});

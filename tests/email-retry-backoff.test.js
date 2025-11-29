const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'adminkey';
process.env.ALWAYS_QUEUE_EMAIL = 'true';
process.env.SIMULATE_EMAIL_FAILURE_ATTEMPTS = '2';
process.env.EMAIL_MAX_ATTEMPTS = '5';
process.env.EMAIL_BASE_DELAY_MS = '50';

const app = require('../server');
const persistence = require('../persistence');

describe('Email retry backoff', () => {
  test('fails twice then succeeds with exponential scheduling', async () => {
    // Queue an invite-trial-followup email
    const trig = await request(app)
      .post('/api/emails/trial-followup')
      .send({ email: 'parent@example.com', parentFirstName: 'Pat', studentFirstName: 'Stu' });
    expect(trig.status).toBe(200);
    expect(trig.body).toHaveProperty('status','sent');

    // Dispatch #1 (expect failure -> attempts 1, pending)
    let dispatch1 = await request(app).post('/__test/dispatch-email-jobs');
    expect(dispatch1.status).toBe(200);
    let jobs = persistence.getRecentEmailJobs(10);
    expect(jobs.length).toBeGreaterThan(0);
    let job = jobs[0];
    expect(job.attempts).toBe(1);
    expect(job.status).toBe('pending');
    const firstNextAt = job.nextAttemptAt;

    // Dispatch #2 (expect second failure -> attempts 2, pending)
    // Force immediate eligibility for second attempt
    persistence.updateEmailJob(job.id, { nextAttemptAt: Date.now() });
    let dispatch2 = await request(app).post('/__test/dispatch-email-jobs');
    expect(dispatch2.status).toBe(200);
    jobs = persistence.getRecentEmailJobs(10);
    job = jobs[0];
    expect(job.attempts).toBe(2);
    expect(job.status).toBe('pending');
    const secondNextAt = job.nextAttemptAt;
    // Validate scheduling relative to now for attempt #2:
    // BASE_RETRY_DELAY_MS=50, multiplier=2 => >= ~100ms plus jitter
    const msUntilSecond = secondNextAt - Date.now();
    expect(msUntilSecond).toBeGreaterThanOrEqual(90);

    // Dispatch #3 (should succeed -> attempts 3, success)
    // Force immediate eligibility for success attempt
    persistence.updateEmailJob(job.id, { nextAttemptAt: Date.now() });
    let dispatch3 = await request(app).post('/__test/dispatch-email-jobs');
    expect(dispatch3.status).toBe(200);
    jobs = persistence.getRecentEmailJobs(10);
    job = jobs[0];
    expect(job.attempts).toBe(3);
    expect(job.status).toBe('success');
  });
});

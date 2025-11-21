const request = require('supertest');

process.env.ALWAYS_QUEUE_EMAIL = 'true';
process.env.ADMIN_API_KEY = 'snapshot-admin-key';

const app = require('../server');

async function resetAll(){
  await request(app).post('/__test/reset-persistence');
  await request(app).post('/__test/reset-rate-limits');
}

describe('Email job body snapshots', () => {
  beforeEach(async ()=>{ await resetAll(); });

  test('queued trial follow-up job stores html/text snapshot', async () => {
    const email = 'snapshotparent@example.com';
    const res = await request(app).post('/api/emails/trial-followup').send({ email, parentFirstName:'Casey', studentFirstName:'Liam' });
    expect(res.status).toBe(200);
    const jobsRes = await request(app).get('/__test/list-email-jobs');
    expect(jobsRes.status).toBe(200);
    const job = jobsRes.body.jobs.find(j=>j.to === email);
    expect(job).toBeTruthy();
    expect(job.htmlBody).toBeDefined();
    expect(job.htmlBody.length).toBeGreaterThan(20); // arbitrary minimal length
    expect(job.textBody).toBeDefined();
    expect(job.template).toBe('invite-trial-followup-email.html');
  });
});

const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'adminkey';
const app = require('../server');

function collectHeaderLines(text){
  return text.split('\n').filter(l => l.startsWith('# HELP') || l.startsWith('# TYPE'));
}

describe('Metrics header stability', () => {
  test('HELP/TYPE lines snapshot', async () => {
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('x-admin-key','adminkey');
    expect(res.status).toBe(200);
    const headerLines = collectHeaderLines(res.text).sort();
    expect(headerLines.length).toBeGreaterThan(10);
    expect(headerLines).toMatchSnapshot();
  });
});

const request = require('supertest');
const app = require('../server');

describe('admin resources endpoint', () => {
  const adminKey = 'primary-key';
  beforeAll(()=>{
    process.env.ADMIN_API_KEY = adminKey;
  });
  test('reports unenforced when allowlist empty', async () => {
    const original = process.env.ALLOWED_RESOURCE_IDS;
    delete process.env.ALLOWED_RESOURCE_IDS;
    const res = await request(app).get('/api/admin/resources').set('x-admin-key', adminKey);
    expect(res.status).toBe(200);
    expect(res.body.enforced).toBe(false);
    expect(Array.isArray(res.body.allowedResourceIds)).toBe(true);
    if(original) process.env.ALLOWED_RESOURCE_IDS = original; else delete process.env.ALLOWED_RESOURCE_IDS;
  });
  test('reports enforced with list when allowlist set', async () => {
    process.env.ALLOWED_RESOURCE_IDS = 'primary,roomA,roomB';
    const res = await request(app).get('/api/admin/resources').set('x-admin-key', adminKey);
    expect(res.status).toBe(200);
    expect(res.body.enforced).toBe(true);
    expect(res.body.allowedResourceIds).toContain('roomA');
    expect(res.body.allowedResourceIds).toContain('roomB');
  });
});
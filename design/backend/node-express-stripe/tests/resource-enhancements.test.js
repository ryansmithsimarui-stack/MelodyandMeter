process.env.ADMIN_API_KEY = 'enh-admin-key';
const request = require('supertest');
const app = require('../server');

// Tests for optional resource catalog enhancements: sorting, bulk import, deletedAt, inactive separation, export endpoint.

describe('resource catalog enhancements', () => {
  const adminKey = 'enh-admin-key';
  test('bulk import, sorting, export, deactivate metadata', async () => {
    // Bulk import three resources (with one duplicate to produce error)
    const importRes = await request(app)
      .post('/api/admin/resources/bulk-import')
      .set('x-admin-key', adminKey)
      .send({ resources: [
        { id:'piano', name:'Piano', capacityMinutes:180, displayOrder:2 },
        { id:'violin', name:'Violin', capacityMinutes:120, displayOrder:3 },
        { id:'harp', name:'Harp', capacityMinutes:90, displayOrder:1 },
        { id:'piano', name:'Duplicate Piano' }
      ]})
      .expect(201);
    expect(importRes.body.imported).toBe(true);
    expect(importRes.body.created.length).toBe(3);
    expect(importRes.body.errors.length).toBe(1);
    expect(importRes.body.errors[0].error).toBe('resource_exists');

    // GET resources should be sorted by displayOrder (harp=1, piano=2, violin=3)
    const listRes = await request(app)
      .get('/api/admin/resources')
      .set('x-admin-key', adminKey)
      .expect(200);
    const idsInOrder = listRes.body.resources.map(r=>r.id);
    expect(idsInOrder).toEqual(['harp','piano','violin']);
    expect(Array.isArray(listRes.body.activeResources)).toBe(true);
    expect(Array.isArray(listRes.body.inactiveResources)).toBe(true);
    expect(listRes.body.inactiveResources.length).toBe(0);

    // Deactivate violin
    // Fetch current version for violin
    const listBeforeDelete = await request(app)
      .get('/api/admin/resources')
      .set('x-admin-key', adminKey)
      .expect(200);
    const violin = listBeforeDelete.body.resources.find(r=>r.id==='violin');
    const delRes = await request(app)
      .delete('/api/admin/resources/violin')
      .set('x-admin-key', adminKey)
      .send({ version: violin.version })
      .expect(200);
    expect(delRes.body.resource.active).toBe(false);
    expect(typeof delRes.body.resource.deletedAt).toBe('number');

    // After deactivation inactiveResources should include violin
    const listRes2 = await request(app)
      .get('/api/admin/resources')
      .set('x-admin-key', adminKey)
      .expect(200);
    const inactiveIds = listRes2.body.inactiveResources.map(r=>r.id);
    expect(inactiveIds).toContain('violin');

    // Export endpoint returns full catalog including deactivated violin
    const exportRes = await request(app)
      .get('/api/admin/resources/export')
      .set('x-admin-key', adminKey)
      .expect(200);
    const exportIds = exportRes.body.resources.map(r=>r.id).sort();
    expect(exportIds).toEqual(['harp','piano','violin']);
  });
});

// WebSocket events integration test
// Enable server + WS even under Jest by setting env before requiring server.
process.env.PORT='5133';
process.env.ENABLE_WS_TESTS='true';
process.env.ADMIN_API_KEY='ws-admin-key';

const WebSocket = require('ws');
const request = require('supertest');
const app = require('../server');

// Note: WebSocket server bound to same port as HTTP server.

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

describe('resource websocket events', ()=>{
  test('receives resource_updated broadcast', async ()=>{
    const ws = new WebSocket('ws://127.0.0.1:5133/ws/resources');
    const messages = [];
    ws.on('message', (data)=>{ messages.push(data.toString()); });
    await new Promise(resolve=> ws.on('open', resolve));

    // Create resource
    const createRes = await request(app)
      .post('/api/admin/resources')
      .set('x-admin-key','ws-admin-key')
      .send({ id:'ws_room', capacityMinutes:100, displayOrder:1 })
      .expect(201);

    // Update resource triggers broadcast
    await request(app)
      .patch('/api/admin/resources/ws_room')
      .set('x-admin-key','ws-admin-key')
      .send({ capacityMinutes:120, version: createRes.body.resource.version })
      .expect(200);

    // Wait briefly for message propagation
    await delay(200);
    ws.close();
    const updateMsg = messages.find(m=> m.includes('resource_updated'));
    expect(updateMsg).toBeTruthy();
    expect(updateMsg).toMatch(/"id":"ws_room"/);
  });
  afterAll(()=>{
    if(app && app._shutdown){ app._shutdown(); }
  });
});

#!/usr/bin/env node
// Backfill resource_id for legacy bookings and add audit log entry.
const fs = require('fs');
const path = require('path');
const persistence = require('../persistence');

const DATA_FILE = process.env.DB_JSON_PATH || path.join(__dirname, '..', 'data.json');
if(!fs.existsSync(DATA_FILE)){
  console.error('Data file not found:', DATA_FILE);
  process.exit(1);
}

// Load via persistence to ensure in-memory state coherence
persistence.init();
let total = 0;
for(const booking of Object.values(require('../persistence').listRecentBookings(100000))){
  if(!booking.resource_id){
    persistence.updateBooking(booking.id, { resource_id: 'primary' });
    persistence.recordBookingStatus(booking.id, booking.status); // history append for trace
    total++;
  }
}
if(total>0){
  persistence.addAudit({ ts: Date.now(), actor: 'migration_script', action: 'backfill_resource_id', meta: { updated: total } });
}
console.log(`Backfill complete. Updated ${total} booking(s).`);

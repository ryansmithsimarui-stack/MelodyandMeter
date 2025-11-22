#!/usr/bin/env node
// Report counts of bookings per resource_id.
const persistence = require('../persistence');

persistence.init();
const all = persistence.listRecentBookings(100000);
const counts = {};
for(const b of all){
  const r = b.resource_id || 'unset';
  counts[r] = (counts[r]||0)+1;
}
console.log('Booking counts per resource_id:');
for(const [r,c] of Object.entries(counts)){
  console.log(`${r}: ${c}`);
}

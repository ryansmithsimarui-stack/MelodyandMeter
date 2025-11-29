// Simple file-based persistence scaffold (JSON). No external deps.
// Data shape: {
//   users: { email: {...} },
//   customers: { email: customerId },
//   audit: [ { ts, actor, action, meta } ],
//   emailJobs: [ { id, to, subject, htmlBody, textBody, attempts, maxAttempts, nextAttemptAt, status, lastError, createdAt, updatedAt, template } ],
//   webhookEvents: { eventId: timestampMs },
//   webhookCounters: { invoice_paid, invoice_payment_failed, subscription_created, subscription_updated, unhandled_event },
//   analyticsEvents: [ { id, name, payload, tsIngested } ],
//   bookings: { bookingId: { id, user_id, slot_id, resource_id, status, start_at, history:[ { ts, status } ], pending_new_slot_id, duration_min } }
// }

const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DB_JSON_PATH || path.join(__dirname, 'data.json');
let state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {} };
let loaded = false;
const isTest = process.env.NODE_ENV === 'test';
// Configurable replay window (default 24h)
const REPLAY_WINDOW_MS = parseInt(process.env.WEBHOOK_REPLAY_WINDOW_MS || (24*60*60*1000), 10);

function load(){
  if(loaded) return;
  if(isTest){
    // Always start fresh in test environment for isolation
    state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {} };
    loaded = true;
    return;
  }
  try {
    if(fs.existsSync(DATA_FILE)){
      const raw = fs.readFileSync(DATA_FILE,'utf8');
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === 'object'){
        state = {
          users: parsed.users||{},
          customers: parsed.customers||{},
            audit: parsed.audit||[],
          emailJobs: parsed.emailJobs||[],
          webhookEvents: parsed.webhookEvents||{},
          webhookCounters: parsed.webhookCounters||{ invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 },
          analyticsEvents: parsed.analyticsEvents||[],
          bookings: parsed.bookings||{}
        };
      }
    }
  } catch(e){
    state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {} };
  }
  loaded = true;
}
function commit(){
  if(isTest) return; // Skip file writes in test to avoid cross-suite leakage
  try{ fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); }catch(e){ /* ignore for now */ }
}

function reset(){
  state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {} };
  if(!isTest){
    try{ fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); }catch(e){ /* ignore */ }
  }
}

function init(){ load(); }

// Users
function getUser(email){ load(); return state.users[email] || null; }
function createUser(email, userObj){ load(); state.users[email] = userObj; commit(); return userObj; }
function verifyUser(email){ load(); if(state.users[email]){ state.users[email].verified = true; commit(); return true; } return false; }

// Customers
function getCustomerId(email){ load(); return state.customers[email] || null; }
function setCustomerId(email, id){ load(); state.customers[email] = id; commit(); return id; }

// Audit
function addAudit(entry){ load(); state.audit.push(entry); if(state.audit.length > 1000){ state.audit = state.audit.slice(-1000); } commit(); }
function getAudit(limit){ load(); const l = limit || 50; return state.audit.slice(-l); }
function getAuditTotal(){ load(); return state.audit.length; }

// --- Email Jobs Persistence ---
// Job status: pending | success | permanent_failure
function addEmailJob(job){
  load();
  const id = 'ej_' + Math.random().toString(36).slice(2,11);
  const now = Date.now();
  const stored = {
    id,
    to: job.to,
    subject: job.subject,
    htmlBody: job.htmlBody || '',
    textBody: job.textBody || '',
    attempts: 0,
    maxAttempts: job.maxAttempts || 5,
    nextAttemptAt: now,
    status: 'pending',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    // Optional meta
    template: job.template || null
  };
  state.emailJobs.push(stored);
  commit();
  return stored;
}
function listProcessableEmailJobs(now){
  load();
  const ts = now || Date.now();
  return state.emailJobs.filter(j=> j.status === 'pending' && j.nextAttemptAt <= ts);
}
function updateEmailJob(id, patch){
  load();
  const idx = state.emailJobs.findIndex(j=>j.id===id);
  if(idx === -1) return null;
  const existing = state.emailJobs[idx];
  const sanitized = sanitizePatch(patch);
  const updated = { ...existing, ...sanitized, updatedAt: Date.now() };
  state.emailJobs[idx] = updated;
  commit();
  return updated;
}
function getEmailJobStats(){
  load();
  let pending = 0, success = 0, permanentFailure = 0;
  for(const j of state.emailJobs){
    if(j.status === 'pending') pending++;
    else if(j.status === 'success') success++;
    else if(j.status === 'permanent_failure') permanentFailure++;
  }
  return { depth: pending, pending, success, permanentFailure };
}
// --- Webhook Replay & Counters ---
function hasRecentWebhookEvent(id, windowMs){
  load();
  const ts = state.webhookEvents[id];
  if(!ts) return false;
  return (Date.now() - ts) <= windowMs;
}
function addWebhookEvent(id){
  load();
  state.webhookEvents[id] = Date.now();
  pruneWebhookEvents();
  commit();
}
function pruneWebhookEvents(){
  const cutoff = Date.now() - REPLAY_WINDOW_MS;
  for(const [eid, ts] of Object.entries(state.webhookEvents)){
    if(ts < cutoff) delete state.webhookEvents[eid];
  }
}
function incrementWebhookCounter(type){
  load();
  if(type === 'invoice.paid') state.webhookCounters.invoice_paid++;
  else if(type === 'invoice.payment_failed') state.webhookCounters.invoice_payment_failed++;
  else if(type === 'customer.subscription.created') state.webhookCounters.subscription_created++;
  else if(type === 'customer.subscription.updated') state.webhookCounters.subscription_updated++;
  else state.webhookCounters.unhandled_event++;
  commit();
}
function getWebhookCounters(){ load(); return { ...state.webhookCounters }; }
function getWebhookEventTotal(){ load(); return Object.keys(state.webhookEvents).length; }
function getRecentEmailJobs(limit){
  load();
  const l = limit || 50;
  return state.emailJobs.slice(-l);
}

function getReplayWindowMs(){ return REPLAY_WINDOW_MS; }

// --- Analytics Events Persistence ---
const MAX_ANALYTICS_EVENTS = parseInt(process.env.MAX_ANALYTICS_EVENTS || '5000', 10);
function addAnalyticsEvent(name, payload){
  load();
  const id = 'ae_' + Math.random().toString(36).slice(2,11);
  const stored = { id, name, payload, tsIngested: Date.now() };
  state.analyticsEvents.push(stored);
  if(state.analyticsEvents.length > MAX_ANALYTICS_EVENTS){
    state.analyticsEvents = state.analyticsEvents.slice(-MAX_ANALYTICS_EVENTS);
  }
  commit();
  return stored;
}
function listAnalyticsEvents(limit){
  load();
  const l = limit || 50;
  return state.analyticsEvents.slice(-l);
}
function getAnalyticsEventTotal(){ load(); return state.analyticsEvents.length; }

// --- Booking Persistence ---
// Simplified booking model for reschedule logic.
function createBooking(id, user_id, slot_id, start_at, duration_min, resource_id){
  load();
  if(state.bookings[id]) return state.bookings[id];
  const now = Date.now();
  const booking = { id, user_id, slot_id, resource_id: resource_id || 'primary', status:'confirmed', start_at: start_at||null, duration_min: typeof duration_min==='number'?duration_min:0, created_at: now, updated_at: now, history:[{ ts: now, status:'confirmed' }], pending_new_slot_id: null };
  state.bookings[id] = booking; commit(); return booking;
}
function getBooking(id){ load(); return state.bookings[id] || null; }
function updateBooking(id, patch){
  load();
  const existing = state.bookings[id];
  if(!existing) return null;
  const sanitized = sanitizePatch(patch);
  const updated = { ...existing, ...sanitized, updated_at: Date.now() };
  state.bookings[id] = updated; commit(); return updated;
}
function recordBookingStatus(id, newStatus){
  load();
  const existing = state.bookings[id];
  if(!existing) return null;
  existing.status = newStatus;
  existing.history.push({ ts: Date.now(), status: newStatus });
  existing.updated_at = Date.now();
  commit();
  return existing;
}
function listRecentBookings(limit){
  load();
  const all = Object.values(state.bookings).sort((a,b)=>a.created_at - b.created_at);
  return all.slice(- (limit||50));
}

// Slot availability: a slot is unavailable if another confirmed booking (excluding optional) has same slot_id and same start_at.
function isSlotAvailable(slot_id, start_at, excludeId){
  load();
  if(!slot_id || !start_at) return true; // if missing data treat as available
  for(const b of Object.values(state.bookings)){
    if(excludeId && b.id === excludeId) continue;
    if(b.status === 'confirmed' && b.slot_id === slot_id && b.start_at && b.start_at === start_at){
      return false;
    }
  }
  return true;
}

// Duration-based slot availability (non-overlap rule). Adjacent (end == start) allowed.
function isSlotAvailableWithDuration(slot_id, start_at, duration_min, excludeId, resource_id){
  load();
  if(!slot_id || !start_at) return true;
  const newDur = typeof duration_min==='number' && duration_min>0 ? duration_min : 0;
  const newStart = start_at;
  const newEnd = newStart + newDur*60000;
  for(const b of Object.values(state.bookings)){
    if(excludeId && b.id === excludeId) continue;
    if(b.status !== 'confirmed') continue;
    if(b.slot_id !== slot_id) continue;
    if(resource_id && b.resource_id && b.resource_id !== resource_id) continue; // allow overlap across different resources
    if(!b.start_at) continue;
    const otherStart = b.start_at;
    const otherDur = typeof b.duration_min==='number' && b.duration_min>0 ? b.duration_min : 0;
    const otherEnd = otherStart + otherDur*60000;
    // Equality check for legacy point bookings handled by general overlap logic.
    const overlap = (newDur===0 && otherDur===0) ? (newStart === otherStart) : (newStart < otherEnd && otherStart < newEnd);
    if(overlap){
      return false;
    }
  }
  return true;
}

// Snapshot of confirmed bookings counts grouped by resource_id
function getConfirmedBookingCountsPerResource(){
  load();
  const counts = {};
  for(const b of Object.values(state.bookings)){
    if(b.status !== 'confirmed') continue;
    const r = b.resource_id || 'primary';
    counts[r] = (counts[r]||0) + 1;
  }
  return counts;
}

function getConfirmedBookingTotal(){
  load();
  let total = 0;
  for(const b of Object.values(state.bookings)){
    if(b.status === 'confirmed') total++;
  }
  return total;
}

function getConfirmedBookingMinutesPerResource(){
  load();
  const minutes = {};
  for(const b of Object.values(state.bookings)){
    if(b.status !== 'confirmed') continue;
    const dur = typeof b.duration_min === 'number' && b.duration_min > 0 ? b.duration_min : 0;
    const r = b.resource_id || 'primary';
    minutes[r] = (minutes[r]||0) + dur;
  }
  return minutes;
}

function getConfirmedBookingMinutesTotal(){
  load();
  let total = 0;
  for(const b of Object.values(state.bookings)){
    if(b.status === 'confirmed'){
      const dur = typeof b.duration_min === 'number' && b.duration_min > 0 ? b.duration_min : 0;
      total += dur;
    }
  }
  return total;
}

// Reschedule lead time stats (hours until start when reschedule initiated)
function getRescheduleLeadTimeStats(){
  load();
  const hours = [];
  let completedCount = 0;
  for(const b of Object.values(state.bookings)){
    if(typeof b.reschedule_lead_time_hours === 'number'){
      hours.push(b.reschedule_lead_time_hours);
    }
    if(typeof b.reschedule_completed_count === 'number'){
      completedCount += b.reschedule_completed_count;
    }
  }
  hours.sort((a,b)=>a-b);
  const count = hours.length;
  let avg = 0, median = 0;
  if(count){
    avg = hours.reduce((acc,v)=>acc+v,0)/count;
    median = count % 2 === 1 ? hours[(count-1)/2] : (hours[count/2 - 1] + hours[count/2]) / 2;
  }
  return { count, avgHours: avg, medianHours: median, completedCount };
}

// Late cancellation counters (derived snapshot)
function getLateCancellationCountsPerResource(){
  load();
  const counts = {};
  for(const b of Object.values(state.bookings)){
    if(b.status !== 'cancelled') continue;
    if(b.penalty_reason !== 'late_cancel') continue;
    const r = b.resource_id || 'primary';
    counts[r] = (counts[r]||0) + 1;
  }
  return counts;
}

function getLateCancellationTotal(){
  load();
  let total = 0;
  for(const b of Object.values(state.bookings)){
    if(b.status === 'cancelled' && b.penalty_reason === 'late_cancel') total++;
  }
  return total;
}

module.exports = {
  init,
  reset,
  getUser,
  createUser,
  verifyUser,
  getCustomerId,
  setCustomerId,
  addAudit,
  getAudit,
  getAuditTotal
  ,addEmailJob
  ,listProcessableEmailJobs
  ,updateEmailJob
  ,getEmailJobStats
  ,getRecentEmailJobs
  ,getReplayWindowMs
  ,hasRecentWebhookEvent
  ,addWebhookEvent
  ,incrementWebhookCounter
  ,getWebhookCounters
  ,getWebhookEventTotal
  ,addAnalyticsEvent
  ,listAnalyticsEvents
  ,getAnalyticsEventTotal
  ,createBooking
  ,getBooking
  ,updateBooking
  ,recordBookingStatus
  ,listRecentBookings
  ,isSlotAvailable
  ,isSlotAvailableWithDuration
  ,getConfirmedBookingCountsPerResource
  ,getConfirmedBookingTotal
  ,getConfirmedBookingMinutesPerResource
  ,getConfirmedBookingMinutesTotal
  ,getLateCancellationCountsPerResource
  ,getLateCancellationTotal
  ,getRescheduleLeadTimeStats
};

// --- Security helpers ---
function sanitizePatch(obj){
  if(!obj || typeof obj !== 'object') return {};
  const out = {};
  for(const [k,v] of Object.entries(obj)){
    if(k === '__proto__' || k === 'prototype' || k === 'constructor') continue;
    out[k] = v;
  }
  return out;
}

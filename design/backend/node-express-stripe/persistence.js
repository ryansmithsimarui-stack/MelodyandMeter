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
let state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {}, resources: [], resourceUtilizationHistory: [] };
let loaded = false;
const isTest = process.env.NODE_ENV === 'test';
// Configurable replay window (default 24h)
const REPLAY_WINDOW_MS = parseInt(process.env.WEBHOOK_REPLAY_WINDOW_MS || (24*60*60*1000), 10);

function load(){
  if(loaded) return;
  if(isTest){
    // Always start fresh in test environment for isolation
    state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {}, resources: [], resourceUtilizationHistory: [] };
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
          bookings: parsed.bookings||{},
          resources: Array.isArray(parsed.resources)? parsed.resources : [],
          resourceUtilizationHistory: Array.isArray(parsed.resourceUtilizationHistory)? parsed.resourceUtilizationHistory : []
        };
      }
    }
  } catch(e){
    state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {}, resources: [], resourceUtilizationHistory: [] };
  }
  loaded = true;
}
function commit(){
  if(isTest) return; // Skip file writes in test to avoid cross-suite leakage
  try{ fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); }catch(e){ /* ignore for now */ }
}

function reset(){
  state = { users: {}, customers: {}, audit: [], emailJobs: [], webhookEvents: {}, webhookCounters: { invoice_paid:0, invoice_payment_failed:0, subscription_created:0, subscription_updated:0, unhandled_event:0 }, analyticsEvents: [], bookings: {}, resources: [], resourceUtilizationHistory: [] };
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
    template: job.template || null,
    backoffStrategy: job.backoffStrategy || 'exponential',
    lastAttemptAt: null,
    failureReason: null,
    movedToDlqAt: null
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
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  if(patch.status === 'permanent_failure' && !updated.movedToDlqAt){
    updated.movedToDlqAt = Date.now();
  }
  if(patch.lastError){
    updated.failureReason = patch.lastError;
  }
  if(patch.attempts !== undefined){
    updated.lastAttemptAt = Date.now();
  }
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
  const updated = { ...existing, ...patch, updated_at: Date.now() };
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

// --- Resource Catalog Persistence ---
// Resource shape: { id, name, capacityMinutes, active, displayOrder, createdAt, updatedAt, deletedAt, version }
function listResources(){ load(); return state.resources.slice(); }
function getResource(id){ load(); return state.resources.find(r=>r.id===id) || null; }
function createResource({ id, name, capacityMinutes, active, displayOrder }){
  load();
  const normId = (id||'').trim();
  if(!normId) return { error:'id_required' };
  if(!/^[a-z0-9_-]{2,32}$/.test(normId)) return { error:'invalid_id_format' };
  if(state.resources.find(r=>r.id===normId)) return { error:'resource_exists' };
  const now = Date.now();
  const resObj = { id: normId, name: (name||'').trim().slice(0,60) || normId, capacityMinutes: typeof capacityMinutes==='number' && capacityMinutes>0 ? capacityMinutes : null, active: active===false?false:true, displayOrder: typeof displayOrder==='number'?displayOrder:null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
  state.resources.push(resObj); commit(); return { resource: resObj };
}
function updateResource(id, patch, expectedVersion){
  load();
  const idx = state.resources.findIndex(r=>r.id===id);
  if(idx === -1) return { error:'not_found' };
  const existing = state.resources[idx];
  if(typeof expectedVersion === 'number' && existing.version !== expectedVersion){
    return { error:'version_conflict', currentVersion: existing.version };
  }
  const updated = { ...existing };
  if(patch.name){ updated.name = patch.name.trim().slice(0,60); }
  if(Object.prototype.hasOwnProperty.call(patch,'capacityMinutes')){
    const v = patch.capacityMinutes;
    updated.capacityMinutes = (typeof v==='number' && v>0) ? v : null;
  }
  if(Object.prototype.hasOwnProperty.call(patch,'active')){
    updated.active = !!patch.active;
  }
  if(Object.prototype.hasOwnProperty.call(patch,'displayOrder')){
    const d = patch.displayOrder;
    updated.displayOrder = typeof d==='number'?d:null;
  }
  updated.updatedAt = Date.now();
  updated.version = (existing.version||1) + 1;
  state.resources[idx] = updated; commit(); return { resource: updated };
}
function deactivateResource(id, expectedVersion){
  load();
  const idx = state.resources.findIndex(r=>r.id===id);
  if(idx === -1) return { error:'not_found' };
  const existing = state.resources[idx];
  if(typeof expectedVersion === 'number' && existing.version !== expectedVersion){
    return { error:'version_conflict', currentVersion: existing.version };
  }
  if(!existing.deletedAt){ existing.deletedAt = Date.now(); }
  existing.active = false;
  existing.updatedAt = Date.now();
  existing.version = (existing.version||1) + 1;
  state.resources[idx] = existing; commit();
  return { resource: existing };
}

function bulkCreateResources(list){
  load();
  if(!Array.isArray(list)) return { error:'resources_array_required' };
  const created = []; const errors = [];
  for(let i=0;i<list.length;i++){
    const item = list[i] || {};
    const result = createResource(item);
    if(result.error){
      errors.push({ index:i, id:item.id||null, error: result.error });
    }else{
      created.push(result.resource);
    }
  }
  return { created, errors };
}

// --- Resource Utilization Snapshot History ---
// Snapshot shape: { ts, origin, perResource: { id: { bookedMinutes, capacityMinutes, utilizationPercent } } }
function recordResourceUtilizationSnapshot(origin){
  load();
  try{
    const minutesPerResource = getConfirmedBookingMinutesPerResource();
    // Build capacity map (env + dynamic active overrides)
    const capacityMap = {};
    const envRaw = process.env.RESOURCE_CAPACITY_MINUTES;
    if(typeof envRaw === 'string' && envRaw.trim()){
      envRaw.split(',').map(pair=>pair.trim()).filter(Boolean).forEach(pair=>{
        const [rid,val] = pair.split(':');
        const m = parseInt(val,10); if(rid && !isNaN(m) && m>0) capacityMap[rid.trim()] = m;
      });
    }
    for(const r of state.resources){
      if(r.active && typeof r.capacityMinutes === 'number' && r.capacityMinutes>0){
        capacityMap[r.id] = r.capacityMinutes;
      }
    }
    const perResource = {};
    const resourceIds = new Set([...Object.keys(minutesPerResource), ...Object.keys(capacityMap), ...state.resources.map(r=>r.id)]);
    for(const rid of resourceIds){
      const booked = minutesPerResource[rid] || 0;
      const cap = capacityMap[rid];
      const utilization = (typeof cap==='number' && cap>0) ? booked/cap : 0;
      perResource[rid] = { bookedMinutes: booked, capacityMinutes: typeof cap==='number'?cap:null, utilizationPercent: utilization };
    }
    const snapshot = { ts: Date.now(), origin: origin||'unknown', perResource };
    state.resourceUtilizationHistory.push(snapshot);
    if(state.resourceUtilizationHistory.length > 500){
      state.resourceUtilizationHistory = state.resourceUtilizationHistory.slice(-500);
    }
    commit();
    return snapshot;
  }catch(e){ return null; }
}
function listResourceUtilizationHistory(limit){
  load();
  const l = typeof limit==='number' && limit>0 ? limit : 50;
  return state.resourceUtilizationHistory.slice(-l);
}
function computeCapacityForecast(){
  load();
  const history = state.resourceUtilizationHistory.slice(-20);
  const perResourceAccum = {};
  for(const snap of history){
    for(const [rid, data] of Object.entries(snap.perResource||{})){
      const acc = perResourceAccum[rid] || { samples:0, sumUtil:0, last: data.utilizationPercent };
      acc.samples += 1;
      acc.sumUtil += (typeof data.utilizationPercent==='number'?data.utilizationPercent:0);
      acc.last = data.utilizationPercent;
      perResourceAccum[rid] = acc;
    }
  }
  const forecast = Object.entries(perResourceAccum).map(([rid,acc])=>{
    const avg = acc.samples ? (acc.sumUtil/acc.samples) : 0;
    // Simple projection: if utilization trend rising (last > avg) project modest increase else keep avg
    const projected = acc.last > avg ? Math.min(acc.last + 0.05, 1) : avg;
    return { id: rid, currentUtilizationPercent: acc.last, averageUtilizationPercent: avg, projectedUtilizationPercent: projected };
  });
  return { generatedAt: Date.now(), forecast };
}

// --- Advanced Forecast (Exponential Smoothing) ---
// Applies simple single-parameter exponential smoothing to recent utilization samples.
// S_t = alpha * U_t + (1-alpha) * S_{t-1}
// Next period projection = S_t (optionally nudged if rising trend).
function computeAdvancedCapacityForecast(alpha){
  load();
  const a = (typeof alpha === 'number' && alpha>0 && alpha<1) ? alpha : 0.5;
  const history = state.resourceUtilizationHistory.slice(-50); // more samples for smoothing
  const sequences = {}; // rid -> [u1,u2,...]
  for(const snap of history){
    for(const [rid,data] of Object.entries(snap.perResource||{})){
      if(!sequences[rid]) sequences[rid] = [];
      sequences[rid].push(typeof data.utilizationPercent==='number'?data.utilizationPercent:0);
    }
  }
  const results = [];
  for(const [rid,arr] of Object.entries(sequences)){
    if(arr.length === 0){
      results.push({ id: rid, samples:0, smoothedUtilizationPercent:0, projectedUtilizationPercent:0 });
      continue;
    }
    let s = arr[0];
    for(let i=1;i<arr.length;i++){ s = a*arr[i] + (1-a)*s; }
    const avg = arr.reduce((acc,v)=>acc+v,0)/arr.length;
    const last = arr[arr.length-1];
    // Trend detection: if last > smoothed by >5% absolute, nudge upward by 2.5% capped.
    let projected = s;
    if(last - s > 0.05){ projected = Math.min(s + 0.025, 1); }
    results.push({ id: rid, samples: arr.length, averageUtilizationPercent: avg, lastUtilizationPercent: last, smoothedUtilizationPercent: s, projectedUtilizationPercent: projected, alpha: a });
  }
  return { generatedAt: Date.now(), alpha: a, forecast: results };
}

// --- Holt-Winters Triple Exponential Smoothing Forecast (additive, short season) ---
// Provides trend + (optional) seasonality handling over utilization ratios.
// Parameters: alpha (level), beta (trend), gamma (seasonal), seasonLength.
// If insufficient data (< 2*seasonLength) falls back to advanced smoothing result shape.
function computeHoltWintersCapacityForecast(alpha, beta, gamma, seasonLength){
  load();
  const a = (typeof alpha==='number' && alpha>0 && alpha<1) ? alpha : 0.5;
  const b = (typeof beta==='number' && beta>0 && beta<1) ? beta : 0.3;
  const g = (typeof gamma==='number' && gamma>0 && gamma<1) ? gamma : 0.2;
  const L = (typeof seasonLength==='number' && seasonLength>=2 && seasonLength<=24) ? seasonLength : 6;
  const history = state.resourceUtilizationHistory.slice(- (L*6)); // cap sample window
  const seriesMap = {}; // rid -> [u1,u2,...]
  for(const snap of history){
    for(const [rid,data] of Object.entries(snap.perResource||{})){
      if(!seriesMap[rid]) seriesMap[rid] = [];
      seriesMap[rid].push(typeof data.utilizationPercent==='number'?data.utilizationPercent:0);
    }
  }
  const forecast = [];
  for(const [rid,arr] of Object.entries(seriesMap)){
    if(arr.length < 2*L){
      // Fallback: use simple advanced smoothing behavior
      let s = arr[0];
      for(let i=1;i<arr.length;i++){ s = a*arr[i] + (1-a)*s; }
      const last = arr[arr.length-1];
      let projected = s;
      if(last - s > 0.05){ projected = Math.min(s + 0.025, 1); }
      forecast.push({ id: rid, samples: arr.length, method:'fallback', projectedUtilizationPercent: projected, smoothedUtilizationPercent: s });
      continue;
    }
    // Initialize level, trend, seasonal indices
    const seasonals = new Array(L).fill(0);
    // Basic season init: average of each position
    for(let i=0;i<L;i++){
      let sum = 0, count = 0;
      for(let j=i; j<arr.length; j+=L){ sum += arr[j]; count++; }
      seasonals[i] = count? (sum/count) : 0;
    }
    let level = arr[0];
    let trend = arr[1] - arr[0];
    // Iterate smoothing
    for(let t=0; t<arr.length; t++){
      const val = arr[t];
      const sIdx = t % L;
      const lastLevel = level;
      const lastTrend = trend;
      const lastSeason = seasonals[sIdx];
      // Additive Holt-Winters update
      level = a * (val - lastSeason) + (1 - a) * (lastLevel + lastTrend);
      trend = b * (level - lastLevel) + (1 - b) * lastTrend;
      seasonals[sIdx] = g * (val - level) + (1 - g) * lastSeason;
    }
    const lastUtil = arr[arr.length-1];
    // Project next L periods, take first as short-term projection
    const projection = level + trend + seasonals[arr.length % L];
    const projected = Math.max(0, Math.min(projection, 1));
    forecast.push({ id: rid, samples: arr.length, method:'holt_winters_additive', projectedUtilizationPercent: projected, level, trend, seasonals, lastUtilizationPercent: lastUtil, alpha:a, beta:b, gamma:g, seasonLength:L });
  }
  return { generatedAt: Date.now(), alpha:a, beta:b, gamma:g, seasonLength:L, forecast };
}

// --- Utilization Anomaly Detection ---
// Computes z-score of latest utilization against prior samples per resource.
// Returns anomalies where |z| >= zThreshold and sample count >= minSamples.
function computeUtilizationAnomalies(historyWindow, zThreshold, varianceMode){
  load();
  const windowSize = typeof historyWindow==='number' && historyWindow>0 ? historyWindow : 50;
  const threshold = typeof zThreshold==='number' && zThreshold>0 ? zThreshold : 2;
  const minSamples = 5;
  const history = state.resourceUtilizationHistory.slice(-windowSize);
  const sequences = {}; // rid -> [u1,u2,...]
  for(const snap of history){
    for(const [rid,data] of Object.entries(snap.perResource||{})){
      if(!sequences[rid]) sequences[rid] = [];
      sequences[rid].push(typeof data.utilizationPercent==='number'?data.utilizationPercent:0);
    }
  }
  const anomalies = [];
  const ciLevel = 0.95; // fixed confidence level (two-tailed)
  // Student's t critical values (two-tailed 95%) for df = 1..29
  const tCriticalMap = {
    1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,9:2.262,10:2.228,
    11:2.201,12:2.179,13:2.160,14:2.145,15:2.131,16:2.120,17:2.110,18:2.101,19:2.093,
    20:2.086,21:2.080,22:2.074,23:2.069,24:2.064,25:2.060,26:2.056,27:2.052,28:2.048,29:2.045
  };
  function resolveCritical(nBaseline){
    // nBaseline = baseline sample count (exclude latest). Use t when <30 else z.
    const df = nBaseline - 1;
    if(df >= 1 && df < 30){ return { critical: tCriticalMap[df], distribution:'t' }; }
    return { critical: 1.96, distribution:'z' }; // normal approximation
  }
  for(const [rid,arr] of Object.entries(sequences)){
    if(arr.length < minSamples) continue; // insufficient data
    const latest = arr[arr.length-1];
    const baseline = arr.slice(0, arr.length-1);
    const mean = baseline.reduce((acc,v)=>acc+v,0) / baseline.length;
    let variance = 0;
    if(baseline.length){
      const sumSq = baseline.reduce((acc,v)=>acc + Math.pow(v-mean,2),0);
      if(varianceMode === 'sample' && baseline.length > 1){
        variance = sumSq / (baseline.length - 1);
      }else{
        variance = sumSq / baseline.length; // population default
      }
    }
    const std = Math.sqrt(variance);
    const z = std > 0 ? (latest - mean) / std : 0;
    const isAnomaly = Math.abs(z) >= threshold;
    const { critical: ciCritical, distribution: ciDistribution } = resolveCritical(baseline.length);
    const meanLower = mean - ciCritical * std;
    const meanUpper = mean + ciCritical * std;
    anomalies.push({ id: rid, samples: arr.length, lastUtilizationPercent: latest, meanUtilizationPercent: mean, stdUtilizationPercent: std, zScore: z, anomaly: isAnomaly, threshold, varianceMode: varianceMode === 'sample' ? 'sample' : 'population', ciLevel, ciDistribution, ciCritical, meanLower, meanUpper });
  }
  return { generatedAt: Date.now(), threshold, varianceMode: varianceMode === 'sample' ? 'sample' : 'population', ciLevel, anomalies };
}

  // --- Seasonal Residual Anomaly Detection ---
  // Uses Holt-Winters additive decomposition to derive expected utilization and residuals.
  // Computes z-score of latest residual vs baseline residuals (previous samples) per resource.
  // Requires >= 2*seasonLength samples; otherwise falls back to simple utilization anomaly if available.
  function computeSeasonalResidualAnomalies(historyWindow, zThreshold, seasonLength, residualDeltaThreshold, alphaOverride, betaOverride, gammaOverride, adapt, varianceMode){
    load();
    const windowSize = typeof historyWindow==='number' && historyWindow>0 ? historyWindow : 60;
    const threshold = typeof zThreshold==='number' && zThreshold>0 ? zThreshold : 2;
    const L = (typeof seasonLength==='number' && seasonLength>=2 && seasonLength<=24) ? seasonLength : 6;
    const deltaThreshold = typeof residualDeltaThreshold==='number' && residualDeltaThreshold>0 ? residualDeltaThreshold : 0.08;
    let useAlpha = (typeof alphaOverride==='number' && alphaOverride>0 && alphaOverride<1) ? alphaOverride : null;
    let useBeta  = (typeof betaOverride==='number' && betaOverride>0 && betaOverride<1) ? betaOverride : null;
    let useGamma = (typeof gammaOverride==='number' && gammaOverride>0 && gammaOverride<1) ? gammaOverride : null;
    const adaptiveEnabled = adapt === true || adapt === 'true';
    const history = state.resourceUtilizationHistory.slice(-windowSize);
    const sequences = {}; // rid -> [u1,u2,...]
    for(const snap of history){
      for(const [rid,data] of Object.entries(snap.perResource||{})){
        if(!sequences[rid]) sequences[rid] = [];
        sequences[rid].push(typeof data.utilizationPercent==='number'?data.utilizationPercent:0);
      }
    }
    const anomalies = [];
    const ciLevel = 0.95;
    const tCriticalMap = {
      1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,9:2.262,10:2.228,
      11:2.201,12:2.179,13:2.160,14:2.145,15:2.131,16:2.120,17:2.110,18:2.101,19:2.093,
      20:2.086,21:2.080,22:2.074,23:2.069,24:2.064,25:2.060,26:2.056,27:2.052,28:2.048,29:2.045
    };
    function resolveCritical(nBaseline){
      const df = nBaseline - 1;
      if(df >= 1 && df < 30){ return { critical: tCriticalMap[df], distribution:'t' }; }
      return { critical: 1.96, distribution:'z' };
    }
    for(const [rid,arr] of Object.entries(sequences)){
      if(arr.length < 2*L){
        // Attempt simple fallback if enough samples for basic anomaly
        if(arr.length >= 5){
          const latest = arr[arr.length-1];
          const baseline = arr.slice(0, arr.length-1);
          const mean = baseline.reduce((a,v)=>a+v,0)/baseline.length;
          let variance = 0;
          if(baseline.length){
            const sumSq = baseline.reduce((a,v)=>a+Math.pow(v-mean,2),0);
            if(varianceMode === 'sample' && baseline.length > 1){
              variance = sumSq / (baseline.length - 1);
            }else{
              variance = sumSq / baseline.length;
            }
          }
          const std = Math.sqrt(variance);
          const z = std>0 ? (latest-mean)/std : 0;
          const isAnomaly = Math.abs(z) >= threshold;
          // Fallback coefficient of variation (raw utilization series)
          const meanU_fb = arr.reduce((a,v)=>a+v,0)/arr.length;
          const varianceU_fb = arr.reduce((a,v)=>a+Math.pow(v-meanU_fb,2),0)/arr.length;
          const stdU_fb = Math.sqrt(varianceU_fb);
          const cv_fb = meanU_fb>0 ? Math.min(1, stdU_fb/meanU_fb) : 0;
          const { critical: ciCritical, distribution: ciDistribution } = resolveCritical(baseline.length);
          const expectedLower = mean - ciCritical * std;
          const expectedUpper = mean + ciCritical * std;
          anomalies.push({ id: rid, samples: arr.length, method:'fallback_simple', lastUtilizationPercent: latest, expectedUtilizationPercent: mean, lastResidual: latest-mean, meanResidual: 0, stdResidual: std, zScore: z, anomaly: isAnomaly, threshold, seasonLength:L, coefficientOfVariation: cv_fb, varianceMode: varianceMode === 'sample' ? 'sample' : 'population', ciLevel, ciDistribution, ciCritical, expectedLower, expectedUpper });
        }
        continue;
      }
      // Initialize seasonal components
      const seasonals = new Array(L).fill(0);
      for(let i=0;i<L;i++){
        let sum=0,count=0; for(let j=i;j<arr.length;j+=L){ sum+=arr[j]; count++; } seasonals[i] = count? (sum/count):0;
      }
      let level = arr[0];
      let trend = arr[1] - arr[0];

      // Compute coefficient of variation (raw series) for observability & potential adaptive mapping
      const meanU = arr.reduce((a,v)=>a+v,0)/arr.length;
      const varianceU = arr.reduce((a,v)=>a+Math.pow(v-meanU,2),0)/arr.length;
      const stdU = Math.sqrt(varianceU);
      const cv = meanU > 0 ? Math.min(1, stdU / meanU) : 0;
      // Adaptive parameter derivation (only if no explicit overrides supplied)
      if(adaptiveEnabled && (useAlpha===null || useBeta===null || useGamma===null)){
        // Alpha: higher when variability higher (more responsiveness).
        const derivedAlpha = 0.25 + 0.40 * cv; // 0.25..0.65
        const derivedBeta = Math.min(0.40, Math.max(0.10, derivedAlpha * 0.5)); // 0.10..0.40
        const derivedGamma = 0.05 + 0.15 * cv; // 0.05..0.20
        if(useAlpha===null) useAlpha = derivedAlpha;
        if(useBeta===null) useBeta = derivedBeta;
        if(useGamma===null) useGamma = derivedGamma;
      }
      // Fallback to defaults if still null (adaptive disabled and overrides absent)
      if(useAlpha===null) useAlpha = 0.3;
      if(useBeta===null) useBeta = 0.15;
      if(useGamma===null) useGamma = 0.1;
      const residuals = [];
      for(let t=0;t<arr.length;t++){
        const val = arr[t];
        const sIdx = t % L;
        // Expected before updating state
        const expected = level + trend + seasonals[sIdx];
        const residual = val - expected;
        residuals.push(residual);
        const lastLevel = level;
        const lastTrend = trend;
        const lastSeason = seasonals[sIdx];
        // Conservative smoothing (defaults) now configurable via overrides
        level = useAlpha * (val - lastSeason) + (1 - useAlpha) * (lastLevel + lastTrend);
        trend = useBeta * (level - lastLevel) + (1 - useBeta) * lastTrend;
        seasonals[sIdx] = useGamma * (val - level) + (1 - useGamma) * lastSeason;
      }
      if(residuals.length < 2) continue;
      const latestResidual = residuals[residuals.length-1];
      // Focus baseline on most recent seasonal cycle for sharper detection
      // Broaden baseline to all prior residuals for more stable CI width
      const baselineResiduals = residuals.slice(0, residuals.length - 1);
      const meanResidual = baselineResiduals.reduce((a,v)=>a+v,0)/baselineResiduals.length;
      let varResidual = 0;
      if(baselineResiduals.length){
        const sumSqRes = baselineResiduals.reduce((a,v)=>a+Math.pow(v-meanResidual,2),0);
        if(varianceMode === 'sample' && baselineResiduals.length > 1){
          varResidual = sumSqRes / (baselineResiduals.length - 1);
        }else{
          varResidual = sumSqRes / baselineResiduals.length;
        }
      }
      const stdResidual = Math.sqrt(varResidual);
      const residualDelta = latestResidual - meanResidual;
      const z = stdResidual>0 ? residualDelta/stdResidual : 0;
      const projectedNextUtil = level + trend + seasonals[residuals.length % L]; // next-period projection
      const lastUtil = arr[arr.length-1];
      // Derive baseline expected for current (last) sample using residual definition: residual = actual - expected
      const expectedCurrentUtil = lastUtil - latestResidual;
      // Dual criterion: relative z-score OR absolute residual jump configurable via deltaThreshold
      const isAnomaly = (Math.abs(z) >= threshold) || (residualDelta >= deltaThreshold);
      // Confidence interval derived from raw utilization baseline (excluding latest) for operator interpretability
      const rawBaseline = arr.slice(0, arr.length - 1);
      const meanRaw = rawBaseline.reduce((a,v)=>a+v,0)/rawBaseline.length;
      let varianceRaw = 0;
      if(rawBaseline.length){
        const sumSqRaw = rawBaseline.reduce((a,v)=>a+Math.pow(v-meanRaw,2),0);
        if(varianceMode === 'sample' && rawBaseline.length > 1){
          varianceRaw = sumSqRaw / (rawBaseline.length - 1);
        }else{
          varianceRaw = sumSqRaw / rawBaseline.length;
        }
      }
      const stdRaw = Math.sqrt(varianceRaw);
      const { critical: ciCritical, distribution: ciDistribution } = resolveCritical(rawBaseline.length);
      const expectedLower = meanRaw - ciCritical * stdRaw;
      const expectedUpper = meanRaw + ciCritical * stdRaw;
      anomalies.push({ id: rid, samples: arr.length, method:'seasonal_residual', lastUtilizationPercent: lastUtil, expectedUtilizationPercent: expectedCurrentUtil, projectedNextUtilizationPercent: projectedNextUtil, lastResidual: latestResidual, meanResidual, stdResidual, zScore: z, anomaly: isAnomaly, threshold, seasonLength:L, residualDelta, residualDeltaThreshold: deltaThreshold, alpha: useAlpha, beta: useBeta, gamma: useGamma, adaptive: adaptiveEnabled, coefficientOfVariation: cv, varianceMode: varianceMode === 'sample' ? 'sample' : 'population', ciLevel, ciDistribution, ciCritical, expectedLower, expectedUpper });
    }
    return { generatedAt: Date.now(), threshold, seasonLength: L, residualDeltaThreshold: deltaThreshold, alpha: useAlpha, beta: useBeta, gamma: useGamma, adaptive: adaptiveEnabled, varianceMode: varianceMode === 'sample' ? 'sample' : 'population', ciLevel, anomalies };
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
  ,listResources
  ,getResource
  ,createResource
  ,updateResource
  ,deactivateResource
  ,bulkCreateResources
  ,recordResourceUtilizationSnapshot
  ,listResourceUtilizationHistory
  ,computeCapacityForecast
  ,computeAdvancedCapacityForecast
  ,computeHoltWintersCapacityForecast
  ,computeUtilizationAnomalies
  ,computeSeasonalResidualAnomalies
  ,computePersistenceUtilizationAnomalies: function(historyWindow, kParam, hParam, varianceMode){
    load();
    const windowSize = typeof historyWindow==='number' && historyWindow>0 ? historyWindow : 80;
    const k = typeof kParam==='number' && kParam>0 ? kParam : 0.25; // drift allowance (fraction of std)
    const h = typeof hParam==='number' && hParam>0 ? hParam : 5;    // threshold multiplier on std for alarm
    const history = state.resourceUtilizationHistory.slice(-windowSize);
    const sequences = {};
    for(const snap of history){
      for(const [rid,data] of Object.entries(snap.perResource||{})){
        if(!sequences[rid]) sequences[rid] = [];
        sequences[rid].push(typeof data.utilizationPercent==='number'?data.utilizationPercent:0);
      }
    }
    const minSamples = 10; // need enough history for stable std
    const results = [];
    for(const [rid,arr] of Object.entries(sequences)){
      if(arr.length < minSamples) continue;
      // Use early segment (first half, min 6) as pre-shift baseline to improve sensitivity
      const baselineFull = arr.slice();
      const segmentSize = Math.max(6, Math.floor(baselineFull.length/2));
      const baselineSegment = baselineFull.slice(0, segmentSize);
      const meanSegment = baselineSegment.reduce((a,v)=>a+v,0)/baselineSegment.length;
      let varianceSegment = 0;
      if(baselineSegment.length){
        const sumSqSeg = baselineSegment.reduce((a,v)=>a+Math.pow(v-meanSegment,2),0);
        if(varianceMode === 'sample' && baselineSegment.length > 1){
          varianceSegment = sumSqSeg / (baselineSegment.length - 1);
        }else{
          varianceSegment = sumSqSeg / baselineSegment.length;
        }
      }
      const stdSegment = Math.sqrt(varianceSegment);
      // Retain overall mean for interpretability (not used in detection increments)
      const overallMean = baselineFull.reduce((a,v)=>a+v,0)/baselineFull.length;
      let cPlus = 0; let cMinus = 0;
      let alarmIndex = -1; let alarmType = null;
      const thresholdAbs = h * stdSegment;
      const cusumSeries = [];
      for(let i=0;i<baselineFull.length;i++){
        const v = baselineFull[i];
        cPlus = Math.max(0, cPlus + (v - meanSegment - k*stdSegment));
        cMinus = Math.max(0, cMinus + (meanSegment - v - k*stdSegment));
        cusumSeries.push({ idx:i, cPlus, cMinus });
        if(alarmIndex === -1){
          if(cPlus > thresholdAbs){ alarmIndex = i; alarmType = 'positive'; }
          else if(cMinus > thresholdAbs){ alarmIndex = i; alarmType = 'negative'; }
        }
      }
      const persistenceAnomaly = alarmIndex !== -1;
      // Persistence magnitude (normalized) for ranking
      const magnitude = alarmType === 'positive' ? (cPlus/(stdSegment||1)) : (alarmType==='negative' ? (cMinus/(stdSegment||1)) : 0);
      // Last window mean shift (compare last 5 vs previous 5 if available)
      let windowShift = 0;
      if(baselineFull.length >= 12){
        const w = 5;
        const tail = baselineFull.slice(-w);
        const prev = baselineFull.slice(-2*w, -w);
        const meanTail = tail.reduce((a,v)=>a+v,0)/tail.length;
        const meanPrev = prev.reduce((a,v)=>a+v,0)/prev.length;
        windowShift = meanTail - meanPrev;
      }
      results.push({ id: rid, samples: baselineFull.length, meanUtilizationPercent: overallMean, stdUtilizationPercent: stdSegment, k, h, varianceMode: varianceMode === 'sample' ? 'sample':'population', persistenceAnomaly, alarmIndex, alarmType, magnitude, lastUtilizationPercent: baselineFull[baselineFull.length-1], thresholdAbs, windowShift, cPlus, cMinus, baselineSegmentSize: segmentSize });
    }
    return { generatedAt: Date.now(), windowSize, k, h, varianceMode: varianceMode === 'sample' ? 'sample':'population', anomalies: results };
  }
  // Test-only helper (injected when NODE_ENV==='test') for controlled anomaly calculations
  ,_testInjectUtilizationSequences: function(perResourceSequences){
    if(!isTest) return false;
    load();
    state.resourceUtilizationHistory = [];
    const now = Date.now();
    const sequences = perResourceSequences || {};
    const maxLen = Object.values(sequences).reduce((m,arr)=> Math.max(m, Array.isArray(arr)?arr.length:0), 0);
    for(let i=0;i<maxLen;i++){
      const perResource = {};
      for(const [rid, arr] of Object.entries(sequences)){
        if(!Array.isArray(arr) || arr.length===0) continue;
        const val = i < arr.length ? arr[i] : arr[arr.length-1];
        perResource[rid] = { bookedMinutes: Math.round(val * 240), capacityMinutes: 240, utilizationPercent: val };
      }
      state.resourceUtilizationHistory.push({ ts: now - (maxLen - i) * 60000, origin: 'test', perResource });
    }
    return true;
  }
};

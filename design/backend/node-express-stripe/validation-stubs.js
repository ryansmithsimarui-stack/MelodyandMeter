// Validation stubs for booking status transitions, alert types, and analytics events.
// These are lightweight and will be expanded later with persistence + instrumentation logic.

// Booking status lifecycle (draft spec):
// DRAFT -> SLOT_SELECTED -> PAYMENT_PENDING -> (COMPLETED | PAYMENT_FAILED)
// PAYMENT_FAILED -> PAYMENT_PENDING (retry) | CANCELLED
// SLOT_SELECTED -> CANCELLED
// PAYMENT_PENDING -> CANCELLED
// COMPLETED is terminal; CANCELLED is terminal.

const BOOKING_STATUSES = [
  'DRAFT',
  'SLOT_SELECTED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'COMPLETED',
  'CANCELLED'
];

const ALERT_TYPES = [
  'payment_failure',
  'payment_method_expiring',
  'trial_expiring',
  'slot_release_warning',
  'generic_info'
];

// Allowed transitions map.
const BOOKING_ALLOWED_TRANSITIONS = {
  DRAFT: ['SLOT_SELECTED', 'CANCELLED'],
  SLOT_SELECTED: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['COMPLETED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PAYMENT_PENDING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

function isValidBookingStatus(status){
  return BOOKING_STATUSES.includes(status);
}

function validateBookingStatusTransition(current, next){
  if(!isValidBookingStatus(current) || !isValidBookingStatus(next)) return false;
  if(current === next) return true; // idempotent allowance
  const allowed = BOOKING_ALLOWED_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

function isValidAlertType(type){
  return ALERT_TYPES.includes(type);
}

// --- Analytics Events ---
// Minimal schema map derived from spec draft; only core required fields enforced.
// Each entry: { required: [field names], optional: [...] }
const ANALYTICS_EVENT_SCHEMAS = {
  // Booking funnel lifecycle
  booking_started: { required:['booking_id','user_id','ts'], optional:['channel'] },
  booking_view_availability: { required:['user_id','ts'], optional:['instrument','source'] },
  booking_slot_open: { required:['booking_id','slot_id','user_id','ts'], optional:[] },
  booking_slot_selected: { required:['booking_id','slot_id','user_id','ts'], optional:['instrument'] },
  booking_confirmed: { required:['booking_id','user_id','ts'], optional:['amount_cents','currency'] },
  payment_initiated: { required:['booking_id','user_id','ts'], optional:['amount_cents','currency','method_type'] },
  // Existing payment outcomes
  payment_success: { required:['invoice_id','amount_cents','currency','ts'], optional:['method_type'] },
  payment_failed: { required:['invoice_id','failure_reason','ts'], optional:['amount_cents'] },
  // Reschedule flow
  reschedule_initiated: { required:['booking_id','user_id','ts'], optional:['origin'] },
  reschedule_completed: { required:['booking_id','user_id','ts'], optional:['previous_slot_id','new_slot_id'] },
  // Misc app events
  alert_dismissed: { required:['alert_id','user_id','ts','alert_type'], optional:[] },
  mobile_screen_view: { required:['screen','user_id','ts'], optional:['session_id'] }
  ,booking_cancelled: { required:['booking_id','user_id','reason_code','ts'], optional:['cancelled_at','start_at','penalty_applied'] }
  ,lesson_completed: { required:['booking_id','teacher_id','duration_min','ts'], optional:['start_at','end_at'] }
  ,practice_entry_added: { required:['booking_id','student_id','tasks_count','entry_type','ts'], optional:[] }
};

function isKnownAnalyticsEvent(name){
  return !!ANALYTICS_EVENT_SCHEMAS[name];
}

function validateAnalyticsEventPayload(name, payload){
  const schema = ANALYTICS_EVENT_SCHEMAS[name];
  if(!schema) return { valid:false, error:'unknown_event' };
  if(!payload || typeof payload !== 'object') return { valid:false, error:'invalid_payload_type' };
  for(const field of schema.required){
    if(!(field in payload)) return { valid:false, error:'missing_field', field };
  }
  // Basic primitive sanity checks (timestamps & IDs shape) - very relaxed.
  if('ts' in payload && typeof payload.ts !== 'number') return { valid:false, error:'invalid_ts_type' };
  return { valid:true };
}

function batchValidateAnalyticsEvents(events){
  const accepted = []; const errors = [];
  if(!Array.isArray(events)) return { accepted, errors:[{ error:'events_not_array' }] };
  if(events.length > 100) return { accepted, errors:[{ error:'batch_too_large' }] };
  for(const ev of events){
    const name = ev && ev.name;
    const payload = ev && ev.payload;
    if(!name){ errors.push({ error:'missing_event_name' }); continue; }
    if(!isKnownAnalyticsEvent(name)){ errors.push({ error:'unknown_event', name }); continue; }
    const result = validateAnalyticsEventPayload(name, payload);
    if(!result.valid){ errors.push({ error:result.error, name, field:result.field }); continue; }
    accepted.push({ name, payload });
  }
  return { accepted, errors };
}

module.exports = {
  BOOKING_STATUSES,
  ALERT_TYPES,
  isValidBookingStatus,
  validateBookingStatusTransition,
  isValidAlertType,
  ANALYTICS_EVENT_SCHEMAS,
  isKnownAnalyticsEvent,
  validateAnalyticsEventPayload,
  batchValidateAnalyticsEvents
};

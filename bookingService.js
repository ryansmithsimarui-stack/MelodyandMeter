const persistence = require('./persistence');
const analytics = require('./analytics');

// Environment-derived config (keep lightweight; fallback defaults preserved)
const RESCHEDULE_CUTOFF_HOURS = parseInt(process.env.RESCHEDULE_CUTOFF_HOURS || '24', 10);
const CANCELLATION_FREE_WINDOW_HOURS = parseInt(process.env.CANCELLATION_FREE_WINDOW_HOURS || '24', 10);
const CANCELLATION_HARD_CUTOFF_HOURS = parseInt(process.env.CANCELLATION_HARD_CUTOFF_HOURS || '1', 10);
// Comma-separated allowlist for resource IDs; defaults to 'primary' only.
function getAllowedResourceIds(){
  const raw = process.env.ALLOWED_RESOURCE_IDS;
  if(typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map(s=>s.trim()).filter(Boolean);
}
function isAllowlistEnforced(){
  const raw = process.env.ALLOWED_RESOURCE_IDS;
  return typeof raw === 'string' && raw.trim().length > 0;
}

function normalizeResourceId(resource_id){
  if(!resource_id) return 'primary';
  return resource_id.trim();
}
function isResourceIdAllowed(resource_id){
  if(!isAllowlistEnforced()) return true;
  return getAllowedResourceIds().includes(resource_id);
}

function createBookingAndTrack({ booking_id, user_id, slot_id, start_at, duration_min, resource_id }) {
  let dur = 0;
  if(typeof duration_min === 'number'){
    if(duration_min < 0 || duration_min > 480) return { error:'invalid_duration_min' };
    dur = duration_min;
  }
  const effectiveResourceId = normalizeResourceId(resource_id);
  if(!isResourceIdAllowed(effectiveResourceId)){
    return { error:'resource_id_invalid', status:400, allowed: getAllowedResourceIds() };
  }
  if(start_at && !persistence.isSlotAvailableWithDuration(slot_id, start_at, dur, null, effectiveResourceId)){
    return { error:'slot_unavailable' };
  }
  const booking = persistence.createBooking(booking_id, user_id, slot_id, start_at||null, dur, effectiveResourceId);
  analytics.trackEvent('booking_confirmed', { booking_id, user_id, resource_id: booking.resource_id, ts: Date.now() });
  return { booking };
}

function initiateReschedule({ booking_id, user_id, new_slot_id }){
  const booking = persistence.getBooking(booking_id);
  if(!booking) return { error:'booking_not_found', status:404 };
  if(booking.user_id !== user_id) return { error:'forbidden', status:403 };
  if(booking.pending_new_slot_id) return { error:'reschedule_already_pending', status:409 };
  if(booking.slot_id === new_slot_id) return { error:'slot_same_as_current', status:400 };
  const startTs = booking.start_at || null;
  if(startTs){
    const hoursUntil = (startTs - Date.now()) / (60*60*1000);
    if(hoursUntil < RESCHEDULE_CUTOFF_HOURS){
      return { error:'reschedule_cutoff_violation', status:400, hours_until: hoursUntil };
    }
    const currentDuration = typeof booking.duration_min==='number'?booking.duration_min:0;
    if(!persistence.isSlotAvailableWithDuration(new_slot_id, startTs, currentDuration, booking_id, booking.resource_id)){
      return { error:'slot_unavailable', status:409 };
    }
    // Record lead time snapshot on initiation
    persistence.updateBooking(booking_id, { reschedule_lead_time_hours: hoursUntil });
  }
  persistence.updateBooking(booking_id, { pending_new_slot_id: new_slot_id, status:'reschedule_pending' });
  persistence.recordBookingStatus(booking_id, 'reschedule_pending');
  const updated = persistence.getBooking(booking_id);
  analytics.trackEvent('reschedule_initiated', { booking_id, user_id, resource_id: booking.resource_id, ts: Date.now(), origin:'user', ...(updated && typeof updated.reschedule_lead_time_hours==='number'?{lead_time_hours: updated.reschedule_lead_time_hours}: {}) });
  return { booking: persistence.getBooking(booking_id) };
}

function completeReschedule({ booking_id, user_id }){
  const booking = persistence.getBooking(booking_id);
  if(!booking) return { error:'booking_not_found', status:404 };
  if(booking.user_id !== user_id) return { error:'forbidden', status:403 };
  if(!booking.pending_new_slot_id) return { error:'no_pending_reschedule', status:400 };
  const previous = booking.slot_id;
  persistence.updateBooking(booking_id, { slot_id: booking.pending_new_slot_id, pending_new_slot_id: null });
  persistence.recordBookingStatus(booking_id, 'confirmed');
  // Increment completed reschedule counter on booking object
  const after = persistence.getBooking(booking_id);
  const currentCount = typeof after.reschedule_completed_count === 'number' ? after.reschedule_completed_count : 0;
  persistence.updateBooking(booking_id, { reschedule_completed_count: currentCount + 1 });
  analytics.trackEvent('reschedule_completed', { booking_id, user_id, resource_id: booking.resource_id, ts: Date.now(), previous_slot_id: previous, new_slot_id: booking.slot_id });
  return { booking: persistence.getBooking(booking_id) };
}

function computeCancellationOutcome(booking){
  const startAt = booking.start_at;
  let hoursUntil = null;
  let penaltyApplied = false;
  let penaltyReason = 'none';
  if(startAt){
    hoursUntil = (startAt - Date.now()) / (60*60*1000);
    if(hoursUntil < 0){
      return { error:'booking_already_started', status:400 };
    }
    if(hoursUntil < CANCELLATION_HARD_CUTOFF_HOURS){
      return { error:'cancellation_cutoff_violation', status:400, hours_until: hoursUntil };
    }
    if(hoursUntil < CANCELLATION_FREE_WINDOW_HOURS){
      penaltyApplied = true;
      penaltyReason = 'late_cancel';
    }
  }
  return { penaltyApplied, penaltyReason, hoursUntil };
}

function cancelBooking({ booking_id, user_id, reason_code }){
  const booking = persistence.getBooking(booking_id);
  if(!booking) return { error:'booking_not_found', status:404 };
  if(booking.user_id !== user_id) return { error:'forbidden', status:403 };
  if(booking.status === 'cancelled') return { error:'booking_already_cancelled', status:409 };
  const outcome = computeCancellationOutcome(booking);
  if(outcome.error) return outcome;
  persistence.updateBooking(booking_id, { status:'cancelled', cancelled_at: Date.now(), penalty_applied: outcome.penaltyApplied, penalty_reason: outcome.penaltyReason, hours_until_at_cancel: outcome.hoursUntil });
  persistence.recordBookingStatus(booking_id, 'cancelled');
  analytics.trackEvent('booking_cancelled', { booking_id, user_id, resource_id: booking.resource_id, reason_code, ts: Date.now(), ...(booking.start_at?{start_at:booking.start_at}:{}) , ...(outcome.hoursUntil!==null?{hours_until:outcome.hoursUntil}:{}) , penalty_applied: outcome.penaltyApplied, penalty_reason: outcome.penaltyReason });
  return { booking: persistence.getBooking(booking_id) };
}

module.exports = {
  createBookingAndTrack,
  initiateReschedule,
  completeReschedule,
  cancelBooking,
  computeCancellationOutcome
};
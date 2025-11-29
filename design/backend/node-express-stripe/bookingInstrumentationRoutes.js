const express = require('express');
const router = express.Router();
const analytics = require('./analytics');
const persistence = require('./persistence');

// Consolidated booking funnel instrumentation endpoint
// POST /api/booking/instrument { action, booking_id?, user_id, slot_id?, instrument?, channel?, amount_cents?, currency?, source? }
// Actions: start, view_availability, open_slot, select_slot, confirm

const ACTION_EVENT_MAP = {
  start: 'booking_started',
  view_availability: 'booking_view_availability',
  open_slot: 'booking_slot_open',
  select_slot: 'booking_slot_selected',
  confirm: 'booking_confirmed'
};

router.post('/api/booking/instrument', (req,res) => {
  const { action } = req.body || {};
  if(!action || !ACTION_EVENT_MAP[action]){
    return res.status(400).json({ error:'invalid_action', allowed: Object.keys(ACTION_EVENT_MAP) });
  }
  const { booking_id, user_id, slot_id, instrument, channel, amount_cents, currency, source, resource_id } = req.body || {};
  // Basic minimal validation: user_id required for funnel context except open_slot/select_slot which also need booking_id, slot_id.
  if(!user_id) return res.status(400).json({ error:'user_id_required' });
  // Action-specific required fields
  if(['start','open_slot','select_slot','confirm'].includes(action) && !booking_id) return res.status(400).json({ error:'booking_id_required' });
  if(['open_slot','select_slot'].includes(action) && !slot_id) return res.status(400).json({ error:'slot_id_required' });

  const eventName = ACTION_EVENT_MAP[action];
  // Determine effective resource_id: prefer existing booking record if present.
  let effectiveResourceId = 'primary';
  if(resource_id && typeof resource_id === 'string' && resource_id.trim()){
    effectiveResourceId = resource_id.trim();
  }
  if(booking_id){
    try{
      const b = persistence.getBooking(booking_id);
      if(b && b.resource_id){
        effectiveResourceId = b.resource_id; // authoritative
      }
    }catch(e){ /* ignore lookup errors */ }
  }
  // Allowlist enforcement (mirrors logic in bookingService & server metrics helpers)
  function getAllowedResourceIds(){
    const raw = process.env.ALLOWED_RESOURCE_IDS;
    if(typeof raw !== 'string' || !raw.trim()) return [];
    return raw.split(',').map(s=>s.trim()).filter(Boolean);
  }
  function dynamicActiveIds(){
    try{ return (typeof persistence.listResources==='function'? persistence.listResources(): []).filter(r=>r.active).map(r=>r.id); }catch(e){ return []; }
  }
  const catalogIds = dynamicActiveIds();
  if(catalogIds.length){
    const bookingStored = booking_id ? persistence.getBooking(booking_id) : null;
    const isLegacyOverride = bookingStored && bookingStored.resource_id && !catalogIds.includes(bookingStored.resource_id);
    if(!isLegacyOverride && !catalogIds.includes(effectiveResourceId)){
      return res.status(400).json({ error:'resource_id_invalid', allowed: catalogIds });
    }
  }else if(getAllowedResourceIds().length){
    const allowed = getAllowedResourceIds();
    const bookingStored = booking_id ? persistence.getBooking(booking_id) : null;
    const isLegacyOverride = bookingStored && bookingStored.resource_id && !allowed.includes(bookingStored.resource_id);
    if(!isLegacyOverride && !allowed.includes(effectiveResourceId)){
      return res.status(400).json({ error:'resource_id_invalid', allowed });
    }
  }
  const payload = { booking_id, user_id, slot_id, resource_id: effectiveResourceId, ts: Date.now() };
  if(channel && action==='start') payload.channel = channel;
  if(instrument && action==='select_slot') payload.instrument = instrument;
  if(instrument && action==='view_availability') payload.instrument = instrument;
  if(source && action==='view_availability') payload.source = source;
  if(action==='confirm'){
    if(typeof amount_cents === 'number') payload.amount_cents = amount_cents;
    if(currency) payload.currency = currency;
  }
  // Remove undefined keys
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  analytics.trackEvent(eventName, payload);
  res.json({ instrumented:true, event:eventName });
});

module.exports = router;
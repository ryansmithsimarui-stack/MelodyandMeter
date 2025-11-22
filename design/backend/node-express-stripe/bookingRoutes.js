const express = require('express');
const router = express.Router();
const persistence = require('./persistence');
const bookingService = require('./bookingService');

// Booking domain endpoints extracted from server.js for maintainability.

// Create Booking
router.post('/api/booking/create', (req,res)=>{
  const { booking_id, user_id, slot_id, resource_id } = req.body || {};
  if(!booking_id || !user_id || !slot_id) return res.status(400).json({ error:'booking_id_user_id_slot_id_required' });
  const existing = persistence.getBooking(booking_id);
  if(existing) return res.status(409).json({ error:'booking_exists' });
  const result = bookingService.createBookingAndTrack({ booking_id, user_id, slot_id, start_at: req.body.start_at, duration_min: req.body.duration_min, resource_id });
  if(result.error) return res.status(result.status||409).json(result);
  res.json({ created:true, booking: result.booking });
});

// Initiate Reschedule
router.post('/api/booking/reschedule/initiate', (req,res)=>{
  const { booking_id, user_id, new_slot_id } = req.body || {};
  if(!booking_id || !user_id || !new_slot_id) return res.status(400).json({ error:'booking_id_user_id_new_slot_id_required' });
  const result = bookingService.initiateReschedule({ booking_id, user_id, new_slot_id });
  if(result.error) return res.status(result.status||400).json(result);
  res.json({ initiated:true, booking: result.booking });
});

// Complete Reschedule
router.post('/api/booking/reschedule/complete', (req,res)=>{
  const { booking_id, user_id } = req.body || {};
  if(!booking_id || !user_id) return res.status(400).json({ error:'booking_id_user_id_required' });
  const result = bookingService.completeReschedule({ booking_id, user_id });
  if(result.error) return res.status(result.status||400).json(result);
  res.json({ completed:true, booking: result.booking });
});

// Cancel Booking (penalty + cutoff windows handled in service)
router.post('/api/booking/cancel', (req,res)=>{
  const { booking_id, user_id, reason_code } = req.body || {};
  if(!booking_id || !user_id || !reason_code) return res.status(400).json({ error:'booking_id_user_id_reason_code_required' });
  const result = bookingService.cancelBooking({ booking_id, user_id, reason_code });
  if(result.error) return res.status(result.status||400).json(result);
  res.json({ cancelled:true, booking: result.booking });
});

module.exports = router;
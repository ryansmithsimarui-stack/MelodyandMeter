# Booking Reschedule & Multi-Resource API & Events

Version: 0.3
Status: Updated (duration overlap + multi-resource availability)

## Overview
Rescheduling allows a learner to move an existing confirmed booking to a new slot (same resource) prior to a configurable cutoff window. Implementation now enforces:
- Cutoff window (default 24 hours before start)
- Single pending reschedule at a time
- Slot must differ from current slot
- Ownership (user_id must match booking.user_id)
- Slot availability (no other confirmed booking with identical slot_id + start_at when duration_min=0)
- Interval availability (no overlapping interval on same resource_id; adjacency allowed)
- Resource scoping (bookings carry `resource_id`; overlaps only block within identical `resource_id`)

## Environment Configuration
| Variable | Purpose | Default |
|----------|---------|---------|
| `RESCHEDULE_CUTOFF_HOURS` | Minimum hours before start when reschedule is allowed | `24` |

## Data Model (persistence.js)
```
# Booking Booking & Reschedule Domain

Version: 0.3
Status: Updated (duration overlap, cancellation penalties, service abstraction, multi-resource)
	status: 'confirmed' | 'reschedule_pending',
	start_at: number|null (epoch ms),
## Overview
The booking domain now supports:
- Booking creation with optional `duration_min` (0–480)
- Interval-based slot availability (no overlapping intervals; adjacency allowed)
- Rescheduling with cutoff window enforcement
- Single pending reschedule guard
- Cancellation with free window, hard cutoff & penalty metadata
- Centralized domain logic in `bookingService.js` (create, initiate/complete reschedule, cancel, penalty computation)
- Analytics instrumentation for lifecycle events (confirm, reschedule initiate/complete, cancel with penalty fields)
Slot availability helper:
```
	isSlotAvailable(slot_id, start_at, excludeId?) -> boolean
// true if no other confirmed booking (excluding excludeId) has same slot_id + start_at
```

	status: 'confirmed' | 'reschedule_pending' | 'cancelled',
	start_at: number|null (epoch ms),
`POST /api/booking/create`
	pending_new_slot_id: string|null,
	duration_min: number, // minutes (0 if point booking)
	penalty_applied?: boolean,
	penalty_reason?: 'none' | 'late_cancel',
	hours_until_at_cancel?: number,
	cancelled_at?: number
Responses:
- 200 `{ created:true, booking }`
- 400 `booking_id_user_id_slot_id_required`
Slot availability helpers:
Event Emitted: `booking_confirmed`
// Legacy (exact timestamp match)
isSlotAvailable(slot_id, start_at, excludeId?) -> boolean
// Interval-based (non-overlap, adjacency allowed) — resource scoped
isSlotAvailableWithDuration(slot_id, start_at, duration_min, excludeId?, resource_id) -> boolean
// Overlap conflict only if another confirmed booking shares slot_id AND resource_id and intervals overlap.
`POST /api/booking/reschedule/initiate`
Body: `{ booking_id, user_id, new_slot_id, start_at? }`
Validation:
1. Booking exists & ownership
2. No existing `pending_new_slot_id`
1. Required fields present
2. `duration_min` within bounds if provided (0–480)
3. Interval availability (no overlapping confirmed booking in same slot)
- 400 `booking_id_user_id_new_slot_id_required | slot_same_as_current | reschedule_cutoff_violation`
- 200 `{ created:true, booking }`
- 400 `booking_id_user_id_slot_id_required | invalid_duration_min`
- 409 `booking_exists | slot_unavailable`
Event Emitted: `booking_confirmed`

### Initiate Reschedule
`POST /api/booking/reschedule/initiate`
Body: `{ booking_id, user_id, new_slot_id }` (resource change not supported in current version)
Validation:
1. Booking exists & ownership
2. No existing `pending_new_slot_id`
3. `new_slot_id != slot_id`
4. Cutoff window satisfied (hours_until >= `RESCHEDULE_CUTOFF_HOURS`)
5. Interval availability for existing booking start_at & duration
Responses:
- 200 `{ initiated:true, booking }`
- 400 `booking_id_user_id_new_slot_id_required | slot_same_as_current | reschedule_cutoff_violation`
- 403 `forbidden`
- 404 `booking_not_found`
- 409 `reschedule_already_pending | slot_unavailable`
Event Emitted: `reschedule_initiated`
State Changes:
- `pending_new_slot_id` set
- `status` -> `reschedule_pending`
- History append
- `pending_new_slot_id` set
- `status` -> `reschedule_pending`
- History append
### Cancel Booking
`POST /api/booking/cancel`
Body: `{ booking_id, user_id, reason_code }`
Validation:
1. Booking exists & ownership
2. Not already cancelled
3. Booking start not in past (if start_at set)
4. Hard cutoff: hours_until >= `CANCELLATION_HARD_CUTOFF_HOURS`
5. Penalty if hours_until < `CANCELLATION_FREE_WINDOW_HOURS`
Responses:
- 200 `{ cancelled:true, booking }` (includes penalty metadata fields on booking)
- 400 `booking_id_user_id_reason_code_required | booking_already_started | cancellation_cutoff_violation`
- 403 `forbidden`
- 404 `booking_not_found`
- 409 `booking_already_cancelled`
Event Emitted: `booking_cancelled` (payload includes `penalty_applied`, `penalty_reason`, `hours_until` when applicable)
State Changes:
- `status` -> `cancelled`
- Penalty metadata persisted
- History append

### Complete Reschedule
`POST /api/booking/reschedule/complete`
Body: `{ booking_id, user_id }`
Validation:
| `booking_confirmed` | Booking created | `booking_id`, `user_id`, `ts`, optional billing fields |
| `booking_cancelled` | Booking cancellation | `booking_id`, `user_id`, `reason_code`, `ts`, `penalty_applied`, `penalty_reason`, `hours_until` (if start_at set) |
1. Booking exists & ownership
2. `pending_new_slot_id` present
Responses:
- 200 `{ completed:true, booking }`
- 400 `booking_id_user_id_required | no_pending_reschedule`
- 403 `forbidden`
- 404 `booking_not_found`
Events Emitted: `reschedule_completed`
State Changes:
- `slot_id` <- `pending_new_slot_id`
- `pending_new_slot_id` cleared
- `status` -> `confirmed`
- History append
| `invalid_duration_min` | Out-of-range duration on create |
| `booking_id_user_id_reason_code_required` | Missing fields on cancellation |
| `booking_already_cancelled` | Duplicate cancellation attempt |
| `cancellation_cutoff_violation` | Hard cutoff violated (includes `hours_until`) |
| `booking_already_started` | Cancellation attempted after start |

## Testing Coverage
`tests/reschedule-instrumentation.test.js` lifecycle & initiation/completion guards
`tests/cancellation-penalty.test.js` cancellation free window, hard cutoff, late penalty
`tests/duration-overlap-availability.test.js` interval overlap, adjacency, reschedule overlap
`tests/future-events-instrumentation.test.js` cancellation analytics event validation pre/post booking
|------|---------|----------------|
## Future Enhancements
- Resource reassignment during reschedule (`resource_id` change)
- Teacher availability & resource calendar integration
- Monetary penalty or fee adjustments (pricing integration)
- Differentiated initiator origin (teacher/admin) in analytics
- Expiration & auto-revert for stale pending reschedules
- Partial slot capacity (multi-learner slots)
- Bulk reschedule tooling (admin initiated)
| `booking_exists` | Duplicate booking create |
## Rollout Notes
- Interval availability reduces collisions vs. exact-match; adjacency is allowed enabling back-to-back lessons.
- Service abstraction (`bookingService.js`) centralizes penalty computation & overlap logic; routes thin.
- For multi-teacher expansion add `teacher_id` to model & slot key and extend overlap logic to resource-level calendars.
| `booking_id_user_id_new_slot_id_required` | Missing fields on initiation |
| `slot_same_as_current` | Attempt to reschedule to same slot |
| `reschedule_cutoff_violation` | Window violated (includes `hours_until`) |
| `reschedule_already_pending` | Second initiation while one pending |
| `no_pending_reschedule` | Completion without a pending change |
| `forbidden` | Ownership mismatch |
| `booking_not_found` | Invalid booking id |

## Testing Coverage
`tests/reschedule-instrumentation.test.js` covers lifecycle & guards.
`tests/slot-availability.test.js` covers creation and reschedule slot conflicts and allowed scenarios.

## Future Enhancements
- Integrate real schedule service (teacher availability, slot duration overlaps)
- Cancellation penalty windows & analytics
- Differentiate initiator origin (teacher, admin)
- Audit log entries per reschedule lifecycle step
- Multi-step negotiation (proposed slot acceptance workflow)
- Expired pending reschedule auto-revert
- Partial slot capacity (multiple learners per slot)

## Rollout Notes
Current slot availability now supports duration overlap and resource scoping. For multi-teacher contexts, rename `resource_id` to `teacher_id` or maintain mapping table; consider validating `resource_id` against allowed set.

## Changelog
- v0.3: Added `resource_id` to bookings; availability and analytics events now include resource context.
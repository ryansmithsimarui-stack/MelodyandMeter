# Analytics Events Specification

Version: 0.6
Generated: (auto scaffold)

This document defines the analytics events currently instrumented in the prototype backend. All user identifiers (`user_id`, `student_id`, `teacher_id`) are subject to privacy hashing when `ENFORCE_USER_ID_HASH=true` is set. In that mode, raw emails must not appear and should be pre-hashed (SHA-256 hex) by the client.

## Global Field Conventions
- `ts`: Ingestion timestamp (ms since epoch) added at send time.
- Time fields (`start_at`, `end_at`, `cancelled_at`) are milliseconds since epoch where provided.
- Monetary fields: `amount_cents` integer.
- Boolean fields: explicit true/false; absent when unknown.

## Booking Funnel Events (Resource-Aware v0.6)
All funnel events are now emitted via a single consolidated endpoint `POST /api/booking/instrument` with an `action` field:

| action | event name | Required fields | Optional fields |
|--------|------------|-----------------|-----------------|
| `start` | `booking_started` | `booking_id`, `user_id` | `channel` |
| `view_availability` | `booking_view_availability` | `user_id` | `instrument`, `source` |
| `open_slot` | `booking_slot_open` | `booking_id`, `slot_id`, `user_id` | (none) |
| `select_slot` | `booking_slot_selected` | `booking_id`, `slot_id`, `user_id` | `instrument` |
| `confirm` | `booking_confirmed` | `booking_id`, `user_id`, `resource_id` | `amount_cents`, `currency` |

Legacy individual endpoints (`/api/booking/start`, `/view-availability`, `/open-slot`, `/select-slot`, `/confirm`) have been removed in favor of this single route (v0.5 spec change). Client batching and future funnel stages can extend the action set without additional routes.

## Reschedule Events (Resource-Aware v0.6)
1. `reschedule_initiated`
	- Fields: `booking_id`, `user_id`, `resource_id`, `ts`, `origin`.
2. `reschedule_completed`
	- Fields: `booking_id`, `user_id`, `resource_id`, `ts`, `previous_slot_id`, `new_slot_id`.

## Payment Events
1. `payment_initiated`
	- Fields: `booking_id`, `user_id`, `ts`.
2. `payment_success`
	- Fields: `invoice_id`, `amount_cents`, `currency`, `ts`.
3. `payment_failed`
	- Fields: `invoice_id`, `failure_reason`, `ts`.

## Lifecycle / Engagement Events
1. `booking_cancelled` (Updated v0.6 for resource context + penalty metadata)
	- Fields: `booking_id`, `user_id`, `resource_id`, `reason_code`, `ts`, optional `start_at`, optional `hours_until` (float), `penalty_applied` (boolean), `penalty_reason` (`none` | `late_cancel`).
2. `lesson_completed`
	- Fields: `booking_id`, `teacher_id`, `duration_min`, `ts`, optional `start_at`, optional `end_at`.
3. `practice_entry_added`
	- Fields: `booking_id`, `student_id`, `tasks_count`, `entry_type`, `ts`.

## Error Codes (Non-Event, surfaced via API responses)
Documented for analytics correlation and potential future tracking.
- `slot_unavailable`: Attempted booking or reschedule against occupied slot/time.
- `reschedule_already_pending`: Duplicate reschedule initiation prevented.
- `reschedule_cutoff_violation`: Reschedule inside cutoff window.
- `cancellation_cutoff_violation`: Cancellation inside hard cutoff window.
- `booking_already_cancelled`: Cancellation attempted on already cancelled booking.
- `booking_already_started`: Cancellation attempted after start time.

## Penalty Logic (v0.3)
Environment variables governing cancellation:
- `CANCELLATION_FREE_WINDOW_HOURS` (default 24): Threshold above which cancellations incur no penalty.
- `CANCELLATION_HARD_CUTOFF_HOURS` (default 1): Inside this window cancellation is rejected.
Derived field logic:
- `hours_until` = (start_at - now)/3600000.
- `penalty_applied` true if `hours_until < CANCELLATION_FREE_WINDOW_HOURS` and `>= CANCELLATION_HARD_CUTOFF_HOURS`.
- `penalty_reason` set to `late_cancel` when penalty applies else `none`.

## Privacy Hashing
When `ENFORCE_USER_ID_HASH=true`, client must supply hashed identifiers. Backend does not hash internally to avoid silent double hashing. Rejects clear emails if enforcement enabled.

## Duration-Based Overlap & Resource Scoping (v0.6)
Slot availability now considers `duration_min` intervals; overlapping intervals within the same `slot_id` are rejected with `slot_unavailable` (adjacent end==start permitted). No new event emitted; rejection surfaced only via API error.

## Future Extensions (Planned)
- Penalty amount fields (`penalty_fee_cents`, `penalty_policy_version`).
- Distinguish reschedule origin (`user`, `system`, `admin`).
- Dedicated overlap rejection event if needed for analytics funnel drop-off.

## Changelog
- v0.1: Initial funnel + payment + lifecycle events.
- v0.2: Added reschedule events, slot availability error codes.
- v0.3: Added cancellation penalty metadata (penalty_applied, penalty_reason, hours_until) and penalty environment variable documentation.
- v0.4: Added duration-based overlap availability documentation.
- v0.5: Consolidated booking funnel instrumentation into single `/api/booking/instrument` endpoint.
- v0.6: Added `resource_id` to booking_confirmed, reschedule_initiated, reschedule_completed, booking_cancelled.

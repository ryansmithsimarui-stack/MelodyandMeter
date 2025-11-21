# Project TODO List (Synced)

This file mirrors the managed internal todo list. Update occurs automatically whenever the list changes.

## Open Tasks

- [ ] Gather requirements & goals
  - Interview studio owner to capture business goals, target audience (ages/levels), primary CTAs (book trial, contact), branding constraints, tone, and project timeline. Deliverable: Requirements brief and success metrics.
- [ ] Collect content & assets
  - Assemble lesson descriptions (piano, movement/music readiness), program formats (individual, group), pricing, instructor bios, testimonials, FAQs, logo, photos, and any videos. Deliverable: Content inventory document and missing-assets list.

### Scheduling Enhancements
- [x] Duration overlap availability
  - Added duration-based availability (`isSlotAvailableWithDuration`), updated endpoints to accept `duration_min`, added tests for partial overlap rejection, adjacency success, legacy point booking conflict, reschedule overlap.
- [x] Analytics spec recreation & update
  - Rebuilt `analytics-events.md` (v0.4) with duration-based overlap documentation.
- [x] Instrumentation consolidation design
  - Unified booking funnel endpoints into single `/api/booking/instrument` action-based route.
- [x] Consolidated instrumentation implementation
  - Added `bookingInstrumentationRoutes.js`, removed legacy start/view/open/select/confirm routes.
- [x] Privacy hash enforcement tests updated
  - Migrated `privacy-hash.test.js` to consolidated endpoint.
- [ ] Multi-resource scheduling design (in progress)
  - Define `resource_id` default ('primary'), constraints, analytics dimension, migration approach.
- [ ] Extend booking schema with resource_id
  - Add field to persisted bookings; default assignment; ensure backward compatibility.
- [ ] Update availability logic for resources
  - Filter overlap checks by matching `resource_id` only.
- [ ] Service layer adjustments
  - Pass `resource_id` through create/reschedule functions; validate presence.
- [ ] Resource scheduling tests
  - Same-resource overlap rejection; different-resource parallel booking acceptance.
- [ ] Analytics events update
  - Include `resource_id` in booking lifecycle & funnel instrumentation payloads.
- [ ] Documentation update
  - Add `resource_id` field to `booking-reschedule.md` & `analytics-events.md` with examples.
- [ ] Regression test run
  - Full suite post changes (expect all 64+ tests passing).

## Completed Tasks
- [x] Admin endpoint rate limiting
- [x] Audit & key tests
## Open Tasks

- [ ] Gather requirements & goals
  - Interview studio owner to capture business goals, target audience (ages/levels), primary CTAs (book trial, contact), branding constraints, tone, and project timeline. Deliverable: Requirements brief and success metrics.
- [ ] Collect content & assets
  - Assemble lesson descriptions (piano, movement/music readiness), program formats (individual, group), pricing, instructor bios, testimonials, FAQs, logo, photos, and any videos. Deliverable: Content inventory document and missing-assets list.
- [x] Metrics endpoint
- [x] Implement email job persistence
## Completed Tasks
- [x] Update metrics for persisted queue
  - Adjust /api/admin/metrics to derive queue depth & status counts from persistence.
- [x] Webhook replay protection design
  - Persist webhook event IDs in JSON store with 24h prune window.
- [x] Implement replay protection logic
  - Ignore duplicate events within window; store new event IDs.
- [x] Persist webhook counters
  - Maintain counters for each processed webhook event type.
- [x] Expand metrics endpoint
  - Added webhook counters, replay store size, email job status metrics.
- [x] Replay protection tests
  - Ensure duplicate invoice.paid does not increment metrics twice.
- [x] Metrics expansion tests
  - Validate presence of new Prometheus metric lines.
- [x] Reschedule endpoints
  - Implement create, initiate, complete with cutoff + analytics events.
- [x] Reschedule tests
  - Added coverage for initiation, completion, cutoff violation, same-slot, already pending guard.
- [x] Reschedule documentation
  - Created `booking-reschedule.md` with endpoints, events, error codes, model.
- [x] Multiple pending guard
  - Added `reschedule_already_pending` 409 status and status transition `reschedule_pending`.
- [x] Slot availability validation
  - Implemented `isSlotAvailable`, enforced on create & reschedule initiation, tests + doc (`slot_unavailable`).
- [x] Cancellation penalty logic
  - Added env-driven windows (`CANCELLATION_FREE_WINDOW_HOURS`, `CANCELLATION_HARD_CUTOFF_HOURS`), endpoint status updates, penalty metadata, analytics fields.
- [x] Analytics spec recreation & update
  - Rebuilt `analytics-events.md` (v0.3) with penalty metadata, error codes, privacy hashing note.

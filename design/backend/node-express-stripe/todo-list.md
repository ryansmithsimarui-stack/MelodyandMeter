# Backend Feature & Anomaly Tracking TODO (Synced)

This list reflects current backend progress and upcoming enhancements. Legacy duplicates removed for clarity.

## Discovery / Content (Cross-Team)
- [ ] Gather requirements & goals (requirements brief + success metrics).
- [ ] Collect content & assets (lesson descriptions, pricing, bios, testimonials, media inventory).

## Scheduling & Resources
- [x] Duration-based overlap availability (`isSlotAvailableWithDuration`).
- [x] Multi-resource scheduling design & implementation (`resource_id` default 'primary').
- [x] Booking schema extended with `resource_id`.
- [x] Availability logic resource-scoped (overlap only if same `resource_id`).
- [x] Service layer propagation of `resource_id` (create/reschedule flows).
- [x] Resource scheduling tests (same-resource reject, different-resource accept).
- [x] Analytics & instrumentation update (resource dimension added).
- [x] Documentation updates (`multi-resource-scheduling.md`, `analytics-events.md`).

## Instrumentation & Analytics
- [x] Consolidated booking instrumentation endpoint (`/api/booking/instrument`).
- [x] Privacy hash enforcement tests migrated.
- [x] Analytics spec updates (duration overlap, penalties, resource dimension).

## Forecasting & Anomaly Detection
- [x] Advanced exponential smoothing forecast (v0.4).
- [x] Holt-Winters additive seasonal forecast (v0.5).
- [x] Utilization anomaly detection (z-score, varianceMode) (v0.6 / v0.7.5 variance).
- [x] Seasonal residual anomaly detection (dual criterion z | residualDelta) (v0.7.x).
- [x] Smoothing parameter overrides (alpha/beta/gamma) (v0.7.2).
- [x] Adaptive smoothing (CV-driven) (v0.7.3).
- [x] Coefficient of Variation exposure (v0.7.4).
- [x] Variance mode (population | sample) integration (v0.7.5).
- [x] Confidence intervals (utilization + seasonal residual; raw baseline CI) (v0.7.6).

### Upcoming Anomaly Enhancements
- [ ] t-distribution CI for small sample sizes (N < 30).
- [ ] Multi-point persistence scoring (CUSUM / windowed mean shift).
- [ ] Alert aggregation & suppression (cool-down per resource).
- [ ] Dynamic threshold auto-tuning (CV & false-positive rate feedback loop).
- [ ] Severity classification endpoint (map z/residualDelta to tier + recommended action).

## Metrics & Queue
- [x] Metrics endpoint & expansion (queue depth, webhook counters, replay store size).
- [x] Email job persistence & body snapshots.
- [x] Admin endpoint rate limiting.
- [ ] Persistent queue (Redis/Bull) with DLQ & retry metadata.
- [ ] Queue health metrics (age, retry histogram, DLQ size).

## Webhooks & Security
- [x] Replay protection (24h window, pruning).
- [x] Webhook counters persistence.
- [ ] Real Stripe signature verification (timestamp skew + tolerance).
- [ ] Key rotation scheme (primary / secondary ADMIN_API_KEY).
- [ ] Audit trail for webhook event processing (append-only structured log).

## Reschedule & Cancellation
- [x] Reschedule endpoints + guard logic.
- [x] Cancellation penalty windows & metadata.
- [x] Slot availability validation & tests.
- [ ] Policy snapshot versioning for booking changes.

## Testing & Quality
- [x] Comprehensive Jest suites (current: 49 suites / 119 tests passing with CI features).
- [ ] Load & stress tests (booking cadence, anomalies scaling).
- [ ] Synthetic volatility scenarios generator (high CV simulation).
- [ ] Accessibility automated checks (admin portal / potential dashboards).

## Operational & Observability
- [x] Structured logging (pino) + request IDs.
- [ ] Prometheus / OpenTelemetry export integration.
- [ ] CI pipeline (lint, tests, security scan) GitHub Actions.
- [ ] Dependency vulnerability scanning (npm audit / Snyk automation).
- [ ] Alert severity metric emission (e.g., `resource_anomaly_severity{level}` counters).

## Documentation & Guidance
- [x] Multi-resource scheduling doc (now v0.7.6 with CI + thresholds).
- [x] Threshold selection guidance & severity mapping.
- [ ] Operator runbook (alert response & escalation criteria).
- [ ] Forecast/anomaly tuning FAQ (alpha/beta/gamma, CV, varianceMode).

## Change Log (Recent)
- v0.7.5: Variance mode added to anomalies.
- v0.7.6: Confidence intervals + threshold guidance integrated; tests updated (119/119 passing).

## Current Focus (Next 5)
1. Implement t-based CI for small N.
2. Design multi-point persistence scoring (choose initial CUSUM variant).
3. Redis/Bull queue architecture spike.
4. Stripe signature verification hardening.
5. Operator runbook draft (alert handling).

## Notes
- Backend service: `design/backend/node-express-stripe/`.
- Anomaly endpoints: `/api/admin/resources/utilization-anomalies`, `/api/admin/resources/utilization-seasonal-anomalies`.
- Tests confirm CI intervals behave (spike outside, mild inside).

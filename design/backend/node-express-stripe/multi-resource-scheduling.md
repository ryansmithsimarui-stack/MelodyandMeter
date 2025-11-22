# Multi-Resource Scheduling Design

Version: 0.7.9 (2025-11-22)
Status: Active

## Objective
Support concurrent lesson scheduling across distinct resources (e.g. different rooms, teachers, instruments) while preserving existing single-resource semantics for legacy bookings. Provide analytics segmentation, capacity utilization metrics, and guarded creation via optional allowlist.

## Core Concept: `resource_id`
Each booking is associated with a `resource_id` string. Legacy records default to `"primary"` (see migration guide `migration-multi-resource.md`).

### Defaults & Normalization
- Omitted or blank `resource_id` -> `"primary"`.
- Trim surrounding whitespace.
- Case sensitive (future enforcement may standardize lower-case).

### Allowlist Enforcement (Optional)
Environment variable `ALLOWED_RESOURCE_IDS` (comma-separated) restricts valid IDs.
Examples:
```
ALLOWED_RESOURCE_IDS=primary,piano_room,drums_room
```
If unset, any non-empty normalized ID accepted.

### Instrumentation Enforcement
Funnel instrumentation endpoint enforces allowlist for `resource_id` when provided and no booking record exists. If a `booking_id` is supplied, the stored booking's `resource_id` overrides any body value (authoritative). Legacy bookings whose `resource_id` later falls outside the current allowlist still emit their original value to preserve historical continuity.

### Error Response
`{ error: 'resource_id_invalid', allowed: ['primary','piano','violin'] }` returned with HTTP 400.

### Test Coverage
`resource-allowlist.test.js` validates booking creation rejection, instrumentation rejection, and override behavior.

### Capacity Minutes Mapping (Future Extension)
`RESOURCE_CAPACITY_MINUTES="primary:480,piano_room:600"` supplies daily theoretical capacity for utilization gauges. Each key maps to maximum bookable minutes used to compute `melody_bookings_utilization_percent{resource_id=...}` = `confirmed_minutes / capacity_minutes` (ratio 0-1).

Example:
```
ALLOWED_RESOURCE_IDS=primary,piano,violin
RESOURCE_CAPACITY_MINUTES=primary:240,piano:180,violin:120
```
Bookings: piano 90 confirmed minutes => utilization 0.5; violin 0 => 0; primary 120 => 0.5.

Resources endpoint (`/api/admin/resources`) now returns:
```
{
	enforced: true,
	allowedResourceIds: ["primary","piano","violin"],
	capacityMinutes: { primary:240, piano:180, violin:120 },
	capacityConfigured: true
}
```

## Availability Logic (Implemented)
Duration-based overlap check (`isSlotAvailableWithDuration`) rejects overlapping intervals only when BOTH bookings share the same `slot_id` AND the same `resource_id`. Overlap across different resources is allowed.
- Zero-duration point bookings use equality; interval bookings use standard `[start,end)` overlap rule; adjacency (end == start) permitted.

## Booking Lifecycle Integration
Service layer (`bookingService.createBookingAndTrack`) passes `resource_id` through creation. Reschedule and cancellation events propagate existing booking `resource_id` to analytics.

## Instrumentation Funnel (Update v0.7)
All funnel actions now include `resource_id` when available:
- `start`, `view_availability`: optional `resource_id` param; default `primary` if omitted.
- `open_slot`, `select_slot`, `confirm`: derive from body param or existing booking (when `booking_id` supplied).
If a booking exists and has a stored `resource_id`, that value overrides a conflicting body value for consistency.

## Analytics & Metrics
Added segmentation:
- Booking funnel events carry `resource_id`.
- Existing lifecycle events (`booking_confirmed`, `reschedule_*`, `booking_cancelled`) already include `resource_id`.
- Metrics endpoint exposes per-resource counts, minutes, late cancellations, utilization ratios.

## Migration
Run backfill script before enabling allowlist or capacity features to ensure legacy rows contain `resource_id`.

## Validation & Errors
- Creation with disallowed `resource_id` -> `{ error: 'resource_id_invalid', allowed: [...] }` (status 400).
- Overlap rejection remains `slot_unavailable` (no change) when same resource.

## Testing Strategy
1. Create booking on `slot_A` resource `piano`.
2. Create booking same slot/time resource `violin` (success).
3. Create booking same slot/time resource `piano` (fail 409 `slot_unavailable`).
4. Instrument funnel actions with `resource_id` and assert analytics payload inclusion via persistence inspection.

## Future Hardening
- Enforce canonical lower-case resource IDs.
- Add endpoint for resource catalog & capacities mutation.
- Introduce concurrency-safe persistence (file locking or db).
- Emit dedicated overlap rejection analytics event (`booking_overlap_rejected`).

## Dynamic Resource Catalog (Added)
The system now supports a persisted resource catalog enabling runtime CRUD without environment variable redeploys.

Endpoint Summary:
- `POST /api/admin/resources` `{ id, name?, capacityMinutes?, active?, displayOrder? }` create.
- `PATCH /api/admin/resources/:id` mutate name, capacityMinutes, active, displayOrder.
- `DELETE /api/admin/resources/:id` soft-deactivate (sets `active:false` and `deletedAt` timestamp).
- `POST /api/admin/resources/bulk-import` `{ resources:[ {...}, {...} ] }` bulk create (returns `created[]` + `errors[]`).
- `GET /api/admin/resources/export` full catalog export (includes inactive / deleted entries).

Response (`GET /api/admin/resources`):
```
{
	enforced: false,
	allowedResourceIds: [],
	capacityMinutes: { piano:180, harp:120 }, // merged env + catalog overrides
	capacityConfigured: true,
	resources: [ ...sorted by displayOrder then id... ],
	activeResources: [ { id:"piano", active:true }, { id:"harp", active:true } ],
	inactiveResources: [ { id:"violin", active:false, deletedAt: 1763788000000 } ]
}
```

Validation Rules:
- `id` regex: `^[a-z0-9_-]{2,32}$`.
- Bulk import applies per-item validation; duplicate IDs yield an `error:'resource_exists'` entry in `errors[]`.
- When catalog has ≥0 (any) resources it supersedes `ALLOWED_RESOURCE_IDS` for creation validation; inactive-only catalog means no resources allowed (all creates invalid until at least one active).
- Deactivated resources remain in catalog (historical continuity) but cannot be used for new bookings; `deletedAt` set once and retained.

Capacity Override Order:
`resource.capacityMinutes` (active) > `RESOURCE_CAPACITY_MINUTES` mapping > absent => utilization ratio 0. Inactive resource capacities are ignored for utilization.

Metrics Impact:
Dynamic capacities applied to `melody_bookings_utilization_percent` (only active resources) and appear after next metrics scrape. Sorting does not affect metric ordering.

Booking Validation Precedence:
1. If catalog has any entries: only active IDs allowed.
2. Else if `ALLOWED_RESOURCE_IDS` set: enforce allowlist.
3. Else: any non-empty normalized ID accepted.

Legacy Continuity: Existing bookings referencing a deactivated or allowlist-removed resource still instrument as legacy override; deactivation does not mutate historical events.

## Versioning & Optimistic Concurrency (Added v0.3)
Each resource now includes a monotonically increasing `version` field:
```
{ id, name, capacityMinutes, active, displayOrder, createdAt, updatedAt, deletedAt, version }
```
Rules:
- On create: `version = 1`.
- On any successful PATCH or DELETE (soft deactivate): `version++`.
- PATCH and DELETE require client to supply `version` in the request body; omission -> `400 { error: 'version_required' }`.
- Mismatch returns `409 { error: 'version_conflict', currentVersion: <serverVersion> }`.
Rationale: Prevent lost updates when multiple admins concurrently modify capacity or active status via UI.

Example update:
```
PATCH /api/admin/resources/piano
{ "capacityMinutes": 240, "version": 3 }
-> 200 { resource: { ..., version: 4 } }
```
Stale update attempt with `version:2` would yield a 409 conflict.

## Resource Audit Endpoint
`GET /api/admin/resources/audit` returns the full catalog including inactive/deactivated entries and all metadata (including `deletedAt`, `version`). Intended for administrative UIs needing complete visibility and for reconciliation scripts.

## Utilization History Snapshots
The system captures lightweight utilization snapshots:
- On every booking creation (`origin: 'booking'`).
- On every metrics scrape (`/api/admin/metrics`, `origin: 'metrics'`).
Snapshot shape:
```
{ ts, origin, perResource: { <id>: { bookedMinutes, capacityMinutes|null, utilizationPercent } } }
```
Stored in a rolling ring (max 500) under `resourceUtilizationHistory`.
Endpoint: `GET /api/admin/resources/utilization-history?limit=50` (default 50) returns latest snapshots (chronological order preserved).

## Capacity Forecast (Heuristic)
Endpoint: `GET /api/admin/resources/capacity-forecast`.
Uses last ≤20 snapshots to compute:
```
{ id, currentUtilizationPercent, averageUtilizationPercent, projectedUtilizationPercent }
```
Projection rule: if latest utilization > historical average, project a modest +5% (capped at 1); else use average. Provides a simple forward-looking signal for capacity planning or surfacing early saturation warnings in dashboards.

## Future Extensions (Post v0.3)
Replaced / extended in v0.4 (see below).

## Real-Time & Advanced Forecasting (Added v0.4)

### WebSocket Event Stream
Path: `ws://<host>/ws/resources`
Messages are JSON lines each containing a `type` field.

Event Types:
```
ws_connected                // initial handshake
resource_updated            // PATCH success
resource_deactivated        // DELETE success
utilization_snapshot        // emitted after metrics scrape (origin:"metrics")
```
Example:
```json
{"type":"resource_updated","ts":1763789000000,"resource":{"id":"piano","capacityMinutes":240,"version":5}}
```
Clients can maintain local cache and update utilization dashboards without polling.

Startup Behavior:
- Disabled under Jest unless `ENABLE_WS_TESTS=true`.
- In production starts automatically with HTTP server.

### Snapshot Broadcasting
Snapshots captured on booking creation and metrics scrape. Metrics scrape broadcasting ensures regular cadence for front-end observers even without continuous booking volume.

### Advanced Forecast (Exponential Smoothing)
Endpoint: `GET /api/admin/resources/capacity-forecast` now returns (v0.5 adds holtWinters):
```
{
	"heuristic": { generatedAt, forecast:[ { id, currentUtilizationPercent, averageUtilizationPercent, projectedUtilizationPercent } ] },
	"advanced": { generatedAt, alpha, forecast:[ { id, samples, averageUtilizationPercent, lastUtilizationPercent, smoothedUtilizationPercent, projectedUtilizationPercent } ] },
	"holtWinters": { generatedAt, alpha, beta, gamma, seasonLength, forecast:[ { id, samples, method, projectedUtilizationPercent, level, trend, seasonals, lastUtilizationPercent } ] }
}
```
Algorithm (advanced): single-parameter exponential smoothing `S_t = α*U_t + (1-α)*S_{t-1}` with α=0.6 chosen to weight recent changes more heavily. If the most recent utilization exceeds smoothed value by >5% absolute, a small upward nudge (+2.5% capped at 1.0) applied to projection to signal acceleration.

### Diff Event Semantics
- `resource_updated`: any successful PATCH (capacity/name/order/active toggles).
- `resource_deactivated`: successful DELETE (soft deactivate) including newly incremented version and `deletedAt`.
- Consumers should treat version as authoritative for conflict resolution; discard events older than local version.

### Client Guidance
- Establish WebSocket; on `ws_connected` immediately fetch `/api/admin/resources` for baseline then apply subsequent diffs.
- For missed periods (connection loss), refetch baseline and resume applying diffs. Utilization snapshots help quickly rehydrate current booking saturation state.

### Future Extensions (Post v0.4)
### Holt-Winters Seasonal Forecast (Added v0.5)
Triple exponential smoothing (additive) incorporated when >= `2*seasonLength` samples exist; otherwise falls back to advanced smoothing behavior. Parameters currently fixed (`alpha=0.5, beta=0.3, gamma=0.2, seasonLength=6`) and exposed in response for tuning visibility.

Projection formula:
```
next = level + trend + seasonal[index]
```
Clamped to [0,1]. Provides early signal of accelerating utilization factoring in short repeating patterns (e.g., intra-day booking cycles) once sufficient snapshots accumulate.

### Utilization Anomaly Detection (Added v0.6)
Endpoint: `GET /api/admin/resources/utilization-anomalies?window=50&threshold=2&variance=sample`

Purpose: Surface sudden utilization spikes (or dips) per resource by computing a z-score of the latest utilization snapshot against preceding samples in a rolling window.

Parameters:
`window` (optional, int >0, default 50) – number of most recent utilization snapshots considered.
`threshold` (optional, float >0, default 2) – absolute z-score cutoff; anomalies where `|zScore| >= threshold`.
`variance` (optional, string, default `population`) – variance estimation mode. `population` divides by N; `sample` divides by N-1 (when N>1). Sample variance increases stdDev slightly for small N, reducing z-score magnitude and mitigating false positives when baseline is tiny.

Computation:
1. Gather the last `window` snapshots from `resourceUtilizationHistory`.
2. Build per-resource utilization sequences.
3. Require at least 5 samples (latest + ≥4 baseline) to evaluate.
4. For each resource, split sequence into baseline (all but latest) and latest value.
5. Compute mean and standard deviation of baseline using selected variance mode (`population` or `sample`).
6. Derive z-score = `(latest - mean) / stdDev` (stdDev==0 -> zScore 0).
7. Flag anomaly when `abs(zScore) >= threshold`.

Response Shape (v0.7.6 adds confidence interval fields):
```
{
	generatedAt: <ts>,
	threshold: <number>,
	varianceMode: 'population' | 'sample',
	ciLevel: 0.95,
	anomalies: [
		{
			id,
			samples,                     // total samples considered
			lastUtilizationPercent,      // latest utilization
			meanUtilizationPercent,      // baseline mean
			stdUtilizationPercent,       // baseline std dev
			zScore,                      // deviation of latest
			anomaly,                     // boolean (|z| >= threshold)
			threshold,                   // echoed threshold
			ciLevel,                     // confidence level (currently fixed 0.95)
			meanLower,                   // lower 95% bound for baseline mean (mean - 1.96*std)
			meanUpper                    // upper 95% bound
		}
	]
}
```

Use Cases:
- Alerting: trigger notifications when `anomaly:true` for critical resources.
- Trend validation: corroborate forecast accelerations with anomaly spikes.
- Capacity planning: early detection of sudden saturation before average rises.

Client Guidance:
- Poll periodically (e.g. every metrics scrape) or combine with WebSocket snapshot events then call anomalies endpoint on significant changes.
- Display severity using `|zScore|` magnitude (e.g. mild: 2-3, high: 3-5, extreme: >5).

Limitations / Next Steps:
- Single latest-point outlier only; future extension: multi-point change detection (e.g. CUSUM) and sustained elevation classification.
- Does not apply seasonality adjustment here (use seasonal residual endpoint).

### Updated Future Extensions (Post v0.6)
### Seasonal Residual Anomaly Detection (Added v0.7, refined v0.7.1, smoothing configurable v0.7.2, adaptive tuning v0.7.3, CV exposure v0.7.4, confidence intervals & raw baseline CI v0.7.6)
Endpoint: `GET /api/admin/resources/utilization-seasonal-anomalies?window=60&threshold=2&seasonLength=6&deltaThreshold=0.08&alpha=0.3&beta=0.15&gamma=0.1&adapt=true&variance=population`

Purpose: Identify deviations after removing seasonal + trend components using Holt-Winters additive smoothing. Reduces false positives from predictable cyclical booking surges while retaining sensitivity to abrupt jumps that may not yield a large z-score (e.g., modest variance baseline).

Parameters:
`window` (int, default 60) – recent utilization snapshots window.
`threshold` (float, default 2) – residual z-score absolute cutoff.
`seasonLength` (int, default 6) – additive season length; requires ≥ `2*seasonLength` samples else fallback.
`deltaThreshold` (float, default 0.08) – absolute residual jump criterion (dual rule with z-score).
`alpha` (float 0-1, default 0.3) – level smoothing factor (lower slows adaptation, amplifies residual spikes).
`beta` (float 0-1, default 0.15) – trend smoothing factor.
`gamma` (float 0-1, default 0.1) – seasonal indices smoothing factor.
`adapt` (boolean, default false) – when `true` and explicit alpha/beta/gamma not provided, derive smoothing parameters from recent utilization variability (coefficient of variation) to balance responsiveness vs stability.
`variance` (optional, string, default `population`) – baseline residual variance mode (`population` or `sample`). Sample variance (n-1) can temper extreme z-scores when residual baseline count is small.
Adaptive Derivation Logic (when `adapt=true` and parameter not overridden):
```
cv = clamp(std(utilization)/mean(utilization), 0, 1)
alpha = 0.25 + 0.40 * cv        # 0.25 .. 0.65
beta  = clamp(alpha * 0.5, 0.10, 0.40)
gamma = 0.05 + 0.15 * cv        # 0.05 .. 0.20
```
Lower variability -> lower alpha/gamma (slower adaptation, amplifies residual spikes). Higher variability -> more responsive smoothing.

Requirements:
– At least `2*seasonLength` samples in the selected window for seasonal decomposition; otherwise falls back to simple utilization anomaly (`method:'fallback_simple'`).

Computation Overview:
1. Build per-resource utilization sequence from last `window` snapshots.
2. Initialize seasonal indices by position averages.
3. Iterate Holt-Winters additive updates using supplied or default conservative parameters (α=0.3, β=0.15, γ=0.1) to slow adaptation and preserve residual spikes.
4. For each sample, compute residual prior to updating components: `residual_t = actual_t - (level + trend + seasonals[pos])`.
5. Baseline residual set = most recent seasonal cycle excluding latest (enhances sensitivity by limiting variance dilution).
6. Compute meanResidual, stdResidual (population). Latest residual delta = `latestResidual - meanResidual`; zScore = `delta / stdResidual` (stdResidual==0 -> zScore 0).
7. Dual anomaly criterion: `(abs(zScore) >= threshold) || (residualDelta >= deltaThreshold)`.
8. Include `expectedUtilizationPercent = level + trend + seasonals[nextPos]` for short-term expectation context.

Response Shape (v0.7.6 adds raw utilization confidence interval + projected next period):
```
{
	generatedAt,
	threshold,
	seasonLength,
	residualDeltaThreshold,
	alpha,
	beta,
	gamma,
	adaptive,
	varianceMode: 'population' | 'sample',
	ciLevel: 0.95,
	anomalies: [
		{
			id,
			samples,
			method: 'seasonal_residual' | 'fallback_simple',
			lastUtilizationPercent,
			expectedUtilizationPercent,
			projectedNextUtilizationPercent, // (seasonal_residual only) forward one-step projection
			lastResidual,
			meanResidual,
			stdResidual,
			zScore,
			residualDelta,
			residualDeltaThreshold,
			alpha,
			beta,
			gamma,
			adaptive,
			coefficientOfVariation,   // (v0.7.4) raw utilization CV in [0,1]
			anomaly,
			threshold,
			seasonLength
			// v0.7.6 confidence interval derived from raw utilization baseline (excluding latest)
			expectedLower,              // meanRaw - 1.96*stdRaw
			expectedUpper               // meanRaw + 1.96*stdRaw
		}
	]
}
```

Advantages:
– Filters recurring seasonal peaks while still catching abrupt utilization surges even if variance inflates denominator.
– Configurable residual jump guard (`deltaThreshold`) offers operational tuning without lowering statistical rigor globally.

Limitations & Next Steps:
- (Resolved in v0.7.6) Provides confidence intervals (raw utilization baseline) for both utilization and seasonal residual anomalies.
- Does not yet provide multi-point persistence scoring.
– Smoothing parameters configurable; adaptive tuning provides automatic parameter selection based on recent variability.
– Dual criterion may produce more alerts; downstream systems can gate on z OR delta magnitude tiers.
– Coefficient of Variation exposed (monitor variability trends; potential future CV-threshold alerting).

### Updated Future Extensions (Post v0.7)
- Backpressure-aware broadcast (skip broadcast if >N queued messages per client).
- Binary frame option for reduced payload size.
- Sample-variance option & confidence interval bands for residual anomalies.
- Multi-point change detection (CUSUM, EARS) for sustained anomalies.

## Summary
`resource_id` enables horizontal scaling of schedule capacity without retroactive semantic changes. Overlap rules are resource-scoped, analytics & metrics gain segmentation, and rollout is low risk via additive defaulting.
Versioned catalog plus history & forecast endpoints provide groundwork for richer operational dashboards and predictive scheduling.

## Confidence Intervals (Added v0.7.6)
Rationale: Add statistically interpretable bounds enabling operators to distinguish normal variability from meaningful excursions without memorizing z-score semantics.

Approach (updated v0.7.7 for small-N rigor):
- Two-tailed 95% interval using Student's t critical when baseline sample count (excluding latest) < 30; falls back to zCritical = 1.96 otherwise.
- Added `ciDistribution` ('t' | 'z') and `ciCritical` fields to each anomaly object for transparency.
- Utilization anomalies: interval bounds around baseline mean (meanLower/meanUpper).
- Seasonal residual anomalies: interval bounds around raw utilization baseline mean, not seasonal expected value, to avoid overly tight bands when decomposed expectation adapts rapidly.

Interpretation:
- lastUtilizationPercent > meanUpper (utilization endpoint) suggests spike outside historical envelope.
- lastUtilizationPercent > expectedUpper (seasonal endpoint) suggests utilization above raw historical band; if seasonal residual anomaly also triggers, escalate.
- Overlap between projection (projectedNextUtilizationPercent) and interval bounds indicates continuity; wide deviation signals emerging trend.

Small Sample Guidance (v0.7.7):
- Expect noticeably wider intervals for baselines < 30 samples due to t critical (e.g., df=4 -> 2.776 vs 1.96).
- Wider band reduces false positives during initial ramp-up before history accrues; switch narrows automatically once baseline >= 30.
- Operators should avoid lowering thresholds prematurely while `ciDistribution='t'` unless consistent actionable anomalies are missed.

## Threshold Selection Guidance (v0.7.6)
Parameters: z-score threshold (`threshold`), residual absolute delta (`deltaThreshold`), and variance mode (`variance`). Tailor to sample size (N) and variability (CV).

Heuristics:
| Baseline Samples (N) | CV (0-0.05) | CV (0.05-0.15) | CV (0.15-0.30) | CV (>0.30) | Recommended z threshold | Recommended deltaThreshold |
|----------------------|-------------|----------------|----------------|-----------|--------------------------|---------------------------|
| 5 - 8                | use sample  | sample         | sample         | sample    | 2.4                      | 0.06                      |
| 9 - 15               | population  | sample         | sample         | sample    | 2.2                      | 0.07                      |
| 16 - 30              | population  | population     | sample         | sample    | 2.0                      | 0.08                      |
| 31 - 60              | population  | population     | population     | sample    | 1.9                      | 0.09                      |
| >60                  | population  | population     | population     | population| 1.8                      | 0.10                      |

Rules of Thumb:
- Prefer `variance=sample` when N < 16 or CV > 0.15 to avoid understating variability.
- Raise z threshold (e.g., 2.4) when N is minimal to reduce noise-induced false positives.
- Increase `deltaThreshold` gradually with larger N to ensure absolute jumps remain meaningful relative to stabilized variance.
- If CV < 0.05 (stable utilization): lower deltaThreshold (0.06–0.07) keeps sensitivity to small absolute shifts that may represent step-changes.
- If CV > 0.30 (high volatility): rely more on residualDelta than raw z-score (retain threshold ≥1.8 but monitor residualDelta tiers: 0.05 mild, 0.10 moderate, 0.15 high).

Operational Playbook:
1. Start: `threshold=2`, `deltaThreshold=0.08`, `variance=sample` if N<20 else `population`.
2. Observe false positive rate for one week.
3. If too many alerts and CV>0.20: raise threshold by +0.2 OR raise deltaThreshold +0.02 (prefer delta change first).
4. If missed surges: decrease deltaThreshold -0.02 (not below 0.05) before lowering z threshold.
5. Reevaluate after seasonal pattern changes (e.g., term start) — recompute CV and adjust adapt flag.

Adaptive Smoothing Interaction:
- High CV triggers larger alpha/gamma (faster adaptation) which can shrink residual variance; compensate by keeping sample variance mode to prevent z inflation due to narrow std.
- Low CV makes residual spikes more pronounced; consider lowering deltaThreshold slightly (0.06) to detect subtle ramps.

Alert Severity Mapping (suggested):
- Level 1 (Informational): |zScore| 1.8–2.5 or residualDelta 0.05–0.07
- Level 2 (Watch): |zScore| 2.5–3.5 or residualDelta 0.07–0.10
- Level 3 (Action): |zScore| 3.5–5 or residualDelta 0.10–0.15
- Level 4 (Critical): |zScore| >5 or residualDelta >0.15

## Release Notes v0.7.6
- Added 95% confidence interval fields: utilization (`ciLevel, meanLower, meanUpper`), seasonal residual (`ciLevel, expectedLower, expectedUpper, projectedNextUtilizationPercent`).
- Standardized variance mode propagation in both endpoints.
- Introduced raw utilization baseline CI for seasonal anomalies (stability over decomposed expected value).
- Added threshold selection guidance and severity mapping.

## Release Notes v0.7.7
- Added t-based confidence intervals for small baseline sizes (<30) across utilization & seasonal residual anomalies.
- Exposed `ciDistribution` and `ciCritical` in anomaly objects for auditability.
- New tests validating widened intervals under t distribution.

## Anomaly Severity Endpoint (Added v0.7.8)
Endpoint: `GET /api/admin/resources/anomaly-severity?window=60&threshold=2&seasonLength=6&variance=sample`

Purpose: Centralize severity classification across utilization and seasonal residual anomalies with consistent recommended operational actions.

Severity Model:
- Utilization zScore tiers:
	- 0 normal: |z| < 1.8
	- 1 informational: 1.8 ≤ |z| < 2.5
	- 2 watch: 2.5 ≤ |z| < 3.5
	- 3 action: 3.5 ≤ |z| ≤ 5
	- 4 critical: |z| > 5
- Seasonal residual combines zScore tier and residualDelta tier; final severity = max(zTier, deltaTier).
	- residualDelta tiers: <0.05 normal; 0.05–0.07 informational; 0.07–0.10 watch; 0.10–0.15 action; >0.15 critical.

Response Shape:
```
{
	generatedAt,
	windowSize,
	threshold,
	seasonLength,
	varianceMode,
	utilizationSeverity: [ { id, severityLevel, severityLabel, recommendedAction, zScore, anomaly, lastUtilizationPercent, meanUtilizationPercent, ciDistribution, ciCritical, meanLower, meanUpper } ],
	seasonalSeverity: [ { id, severityLevel, severityLabel, recommendedAction, zScore, residualDelta, anomaly, lastUtilizationPercent, expectedUtilizationPercent, projectedNextUtilizationPercent, residualDeltaThreshold, ciDistribution, ciCritical, expectedLower, expectedUpper } ],
	severityLegend: [ { level, label, action } ]
}
```

Recommended Actions:
- normal: No action; continue monitoring.
- informational: Log & observe; verify persistence.
- watch: Review trends; prep mitigation (e.g. capacity adjustment plan).
- action: Initiate capacity adjustment or notify stakeholders.
- critical: Escalate immediately; trigger alerts & contingency plan.

Usage:
Poll alongside anomalies endpoints or replace separate anomaly calls when severity tiers suffice for alert routing. Severity tiers can drive notification intensity (e.g., email for action, SMS/Pager for critical).

## Release Notes v0.7.8
- Added anomaly severity classification endpoint with unified severity & action guidance.
- Integrated existing t/z confidence interval metadata into severity payload.
- Expanded documentation for operational response tiers.

## Persistence (Multi-Point) Utilization Anomalies (Added v0.7.9)
Endpoint: `GET /api/admin/resources/utilization-persistence-anomalies?window=80&k=0.25&h=5&variance=population`

Purpose: Detect sustained shifts in utilization that may not produce a large single-point z-score but indicate a structural change (e.g., gradual ramp toward saturation).

Method (CUSUM-based):
- For each resource sequence in the selected window, compute baseline mean & std.
- Maintain positive and negative cumulative sums:
	`C+ = max(0, C+ + (v - mean - k*std))`
	`C- = max(0, C- + (mean - v - k*std))`
- Trigger persistence anomaly when `C+ > h*std` (positive shift) or `C- > h*std` (negative shift).
- Includes windowed mean shift (`windowShift`) comparing last 5 samples vs preceding 5 for additional context.

Parameters:
- `window` (int) recent snapshots (default 80)
- `k` drift allowance fraction of std (default 0.25) — higher k reduces sensitivity to small incremental changes.
- `h` threshold multiplier (default 5) — lower h increases sensitivity (actionable when combined with severity endpoint to avoid noise).
- `variance` mode population|sample for std calculation.

Response Shape:
```
{
	generatedAt,
	windowSize,
	k,
	h,
	varianceMode,
	anomalies: [
		{
			id,
			samples,
			meanUtilizationPercent,
			stdUtilizationPercent,
			k,
			h,
			persistenceAnomaly,        // boolean
			alarmIndex,                // index where first threshold exceed occurred
			alarmType,                 // 'positive' | 'negative' | null
			magnitude,                 // normalized cumulative sum / std at evaluation end
			lastUtilizationPercent,
			thresholdAbs,              // h*std
			windowShift,               // mean(last5) - mean(prev5) if >=12 samples else 0
			cPlus,                     // final positive CUSUM value
			cMinus                     // final negative CUSUM value
		}
	]
}
```

Operational Guidance:
- Use in tandem with severity endpoint: escalate if persistenceAnomaly true AND severityLevel ≥2.
- Adjust `k` upward (0.30–0.35) if too many gradual false positives; adjust `h` downward (4–4.5) if missing slow ramps.
- `windowShift` > 0.02 (2 percentage points) often signals meaningful drift for medium-volatility resources.

Limitations & Next Steps:
- Currently single-scale; future: adaptive `k` based on coefficient of variation.
- Does not yet aggregate consecutive persistence events into a sustained incident count.

## Release Notes v0.7.9
- Added persistence utilization anomalies endpoint (CUSUM + windowed mean shift).
- Extended detection beyond single-point spikes enabling early ramp identification.

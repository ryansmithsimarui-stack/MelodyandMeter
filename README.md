# MelodyandMeter
[![CI](https://github.com/ryansmithsimarui-stack/MelodyandMeter/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ryansmithsimarui-stack/MelodyandMeter/actions/workflows/ci.yml)
website and startup details for Melody and Meter Music Studio

---

Node/Express + Stripe example

Files:
- `server.js` : minimal Express server demonstrating SetupIntent creation, subscription creation, webhook handler, booking & analytics instrumentation.
- `package.json` : dependencies and start script.
- `booking-reschedule.md` : booking lifecycle, reschedule & cancellation domain docs.
- `analytics-events.md` : backend analytics spec (resource-aware events).
- `migration-multi-resource.md` : migration guidance & script snippet for multi-resource backfill (`resource_id`).
- `scripts/backfill-resource-id.js` : performs one-off backfill and writes audit entry.
- `scripts/report-resource-counts.js` : prints booking counts grouped by resource_id.

Setup (developer):
1. Install dependencies:
   npm install
2. Create a `.env` file in this folder with:
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   PORT=4242
3. Run server locally:
   node server.js

Notes:
- This is example/demo code. Replace the in-memory `db` with a proper database and add authentication/authorization middleware.
- Multi-resource scheduling adds `resource_id` to bookings. Run migration before enabling resource-level calendars in production.
 - To validate allowed resources set `ALLOWED_RESOURCE_IDS` env (comma-separated). Invalid values during create return `{ error: 'resource_id_invalid', allowed:[...] }`.
 - Reporting: `node scripts/report-resource-counts.js`
- For webhook testing during development, use the Stripe CLI:
  stripe login
  stripe listen --forward-to "http://localhost:4242/api/webhooks/stripe"
  // copy the signing secret into STRIPE_WEBHOOK_SECRET in .env

Endpoints:
- POST /api/payments/setup-intent { email }
  -> { client_secret, customerId }
- POST /api/billing/subscriptions { email, priceId, payment_method_id? }
  -> subscription object
- POST /api/webhooks/stripe
  -> webhook receiver (expects raw body signature)
 - GET /api/admin/resources (admin key required)
   -> { enforced: boolean, allowedResourceIds: [] } current resource_id allowlist configuration

Security:
- Keep `STRIPE_SECRET_KEY` and webhook secret private.
- Use HTTPS in production and verify webhooks.
- Do not store full card details on your server; use Stripe's hosted elements and tokens.

Resource Monitoring & Segmentation:
- Use `/api/admin/resources` to introspect the active allowlist and verify deployments.
- Segment dashboards and analytics queries by `resource_id` to compare utilization, cancellation rates, and reschedule frequency across rooms/instruments.
- Recommended metrics additions (Prometheus style) for future: `melody_bookings_active{resource_id="roomA"}` gauges derived from persistence, and late cancellation counters per resource.
- For ad-hoc counts today run: `node scripts/report-resource-counts.js`.

Late Cancellation Metrics:
- Added gauges `melody_bookings_cancelled_late_total` and `melody_bookings_cancelled_late{resource_id="..."}` derived from persistence (status `cancelled` with `penalty_reason=late_cancel`).
- Allowlist enforcement mirrors confirmed bookings: every allowed resource emits a series (zero if none yet). Without an allowlist, only observed resources plus a fallback `primary` zero sample appear.
- Example alert (spike >5 in 1h): `increase(melody_bookings_cancelled_late_total[1h]) > 5`.

Grafana Dashboard:
- See `dashboards/bookings.json` for a minimal dashboard definition (panels: confirmed total, per-resource confirmed, per-resource late cancellations, late cancellation total, resource share ratio).
- Import into Grafana: Dashboards > New > Import > Upload JSON file.

Confirmed Booking Minutes Metrics:
- Gauges `melody_bookings_confirmed_minutes_total` and `melody_bookings_confirmed_minutes{resource_id="..."}` expose summed `duration_min` for all confirmed bookings (snapshot, not rate).
- Zero samples emitted per allowed resource under enforcement just like counts.
- Useful for measuring utilization vs theoretical capacity (e.g., target 40 min lesson x slots).

Utilization Percent Metrics:
- Environment variable `RESOURCE_CAPACITY_MINUTES` defines theoretical per-resource capacity in minutes, e.g. `RESOURCE_CAPACITY_MINUTES="primary:480,piano:600"`.
- Gauge `melody_bookings_utilization_percent{resource_id="..."}` emits a 0–1 ratio: `confirmed_minutes(resource) / capacity_minutes(resource)`; if capacity not configured for a resource the ratio is 0.
- Allowlist enforcement mirrors other per-resource metrics (stable zero series). Without an allowlist, only observed resources plus fallback `primary` if empty.
- Example alerts:
  - High sustained utilization (>90% for 6h): `avg_over_time(melody_bookings_utilization_percent{resource_id="piano"}[6h]) > 0.9`
  - Under-utilization (<30% daily): `avg_over_time(melody_bookings_utilization_percent{resource_id="drums"}[24h]) < 0.3`
  - Imbalance (>25% spread between top and bottom resources): `(max(melody_bookings_utilization_percent) - min(melody_bookings_utilization_percent)) > 0.25`

Booking Duration Histogram:
- Histogram metrics expose distribution of confirmed booking durations (minutes):
  - Buckets: `melody_booking_duration_minutes_bucket{le="0"|15|30|45|60|90|120|240|480|+Inf}`
  - Sum: `melody_booking_duration_minutes_sum`
  - Count: `melody_booking_duration_minutes_count`
- Bucket semantics: each sample counts bookings with `duration_min <= le` (standard Prometheus cumulative histogram).
- Example PromQL:
  - Average duration (1h moving): `rate(melody_booking_duration_minutes_sum[1h]) / rate(melody_booking_duration_minutes_count[1h])`
  - 90th percentile (24h): `histogram_quantile(0.9, sum by (le)(rate(melody_booking_duration_minutes_bucket[24h])))`
  - Long booking surge (>60 min bookings in 1h): `increase(melody_booking_duration_minutes_bucket{le="120"}[1h]) - increase(melody_booking_duration_minutes_bucket{le="60"}[1h]) > 10`
  - Share of very short bookings (<=15 min) last 7d: `increase(melody_booking_duration_minutes_bucket{le="15"}[7d]) / increase(melody_booking_duration_minutes_count[7d])`

Reschedule Lead Time Metrics:
- Gauges derived from reschedule initiation snapshots:
  - `melody_reschedule_lead_time_hours_avg`
  - `melody_reschedule_lead_time_hours_median`
  - Completed reschedules counter (gauge snapshot): `melody_reschedule_completed_total`
- Lead time captured at reschedule initiation: hours between request time and original booking start time.
- Operational Uses:
  - Detect last-minute churn (median < 6h consistently): `avg_over_time(melody_reschedule_lead_time_hours_median[7d]) < 6`
  - Spike in reschedules (>20 in 24h): `increase(melody_reschedule_completed_total[24h]) > 20`
  - Lead time degradation vs target (target >=12h): `melody_reschedule_lead_time_hours_avg < 12`
  - Ratio of reschedules to total confirmations (7d): `increase(melody_reschedule_completed_total[7d]) / increase(melody_bookings_confirmed_total[7d]) > 0.15`

PromQL SLO / Alert Examples:
- Cancellation rate SLO (7d): `increase(melody_bookings_cancelled_late_total[7d]) / increase(melody_bookings_confirmed_total[7d]) < 0.05`
- Per-resource cancellation imbalance: `increase(melody_bookings_cancelled_late{resource_id="piano"}[30d]) / increase(melody_bookings_confirmed{resource_id="piano"}[30d]) > 0.08`
- Utilization minutes (24h): `sum_over_time(melody_bookings_confirmed_minutes{resource_id="piano"}[24h])`
- Utilization % vs capacity (example 480 scheduled minutes target): `sum_over_time(melody_bookings_confirmed_minutes{resource_id="piano"}[24h]) / 480 > 0.85`
- Growth rate of booked minutes (1h): `increase(melody_bookings_confirmed_minutes_total[1h]) > 300`
- Minutes imbalance >60% share: `sum_over_time(melody_bookings_confirmed_minutes{resource_id="piano"}[24h]) / sum(sum_over_time(melody_bookings_confirmed_minutes[24h])) > 0.6`
- Sustained high utilization SLO: `avg_over_time(melody_bookings_utilization_percent{resource_id="piano"}[30d]) > 0.8`
- 90th percentile booking duration exceeds cap (target <60): `histogram_quantile(0.9, sum by (le)(rate(melody_booking_duration_minutes_bucket[30d]))) > 60`
- Reschedule ratio SLO (target <10%): `increase(melody_reschedule_completed_total[30d]) / increase(melody_bookings_confirmed_total[30d]) < 0.10`

Alerting & Prometheus Examples:
- Saturation (total confirmed bookings surge): `sum(melody_bookings_confirmed_total) > 200`
- Per-resource capacity threshold (allowlist enforced): `melody_bookings_confirmed{resource_id="piano"} > 50`
- Fast growth detection (1h window): `increase(melody_bookings_confirmed_total[1h]) > 20`
- Idle resource detection (no bookings for 6h): `sum_over_time(melody_bookings_confirmed{resource_id="drums"}[6h]) == 0`
- Percentage share (identify imbalance): `melody_bookings_confirmed{resource_id="piano"} / sum(melody_bookings_confirmed) > 0.6`

Operational Notes:
- When `ALLOWED_RESOURCE_IDS` is set, metrics emit a zero sample for each allowed resource ensuring stable time series even before first booking.
- Without enforcement, only observed resources plus a `primary` fallback (0) are emitted; plan dashboards accordingly before enabling allowlist.

## CI & Automation

- CI: GitHub Actions runs tests on Node 18.x and 20.x for pushes and PRs to `main`.
  - Workflow: `.github/workflows/ci.yml`
  - Steps: `npm install` then `node run-tests.js` (no audit/fund), npm cache enabled.
- CodeQL: Static analysis on push/PR to `main` and weekly schedule.
  - Workflow: `.github/workflows/codeql.yml`
  - Results: GitHub Security tab → Code scanning alerts.
- Dependabot: Weekly dependency PRs for npm with `dependencies` label.
  - Config: `.github/dependabot.yml`
  - Tip: Mark CI as a required status check so Dependabot PRs only merge when green.

## Prometheus Scrape Example

Add this to your Prometheus config and adjust the target to your service address:

```yaml
scrape_configs:
  - job_name: 'melodyandmeter'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:4242']
    metrics_path: /api/admin/metrics
    scheme: http
    relabel_configs: []
```

## Grafana Alerts (How-To)

1) Import the dashboard: Dashboards → New → Import → upload `dashboards/bookings.json`.
2) Create alert rules (Grafana 9+): Alerting → Alert rules → New alert rule.
   - Set the data source to Prometheus and paste one of the expressions below.
   - Choose evaluation interval (e.g., 1m) and a reasonable “for” duration to avoid flapping.
   - Assign contact point (email/Slack/etc.).

Example alert expressions:
- Late cancellations spike (1h): `increase(melody_bookings_cancelled_late_total[1h]) > 5`
- Sustained high utilization (>90% for 6h) on piano: `avg_over_time(melody_bookings_utilization_percent{resource_id="piano"}[6h]) > 0.9`
- Duration P90 above 60 minutes (24h window): `histogram_quantile(0.9, sum by (le)(rate(melody_booking_duration_minutes_bucket[24h]))) > 60`
- Reschedule ratio over 15% (7d): `increase(melody_reschedule_completed_total[7d]) / increase(melody_bookings_confirmed_total[7d]) > 0.15`

Tips:
- Use the resource allowlist to keep series cardinality stable and alerts predictable.
- Start with wider “for” durations (e.g., 10–30m) to suppress brief spikes.


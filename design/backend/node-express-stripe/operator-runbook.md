# Operator Runbook

Version: 0.7.8  
Last Updated: 2025-11-22

## 1. Purpose & Scope
This runbook guides operations staff in monitoring, triaging, and acting on scheduling/utilization anomalies, capacity signals, and related system health for Melody & Meter. It aligns severity tiers exposed by the `/api/admin/resources/anomaly-severity` endpoint with concrete response actions, escalation paths, and tuning procedures.

## 2. Key Endpoints & Data Sources
| Purpose | Endpoint | Notes |
|---------|----------|-------|
| Unified severity & actions | `GET /api/admin/resources/anomaly-severity` | Combines utilization & seasonal residual anomalies. |
| Raw utilization anomalies | `GET /api/admin/resources/utilization-anomalies` | zScore + CI bounds (t vs z). |
| Seasonal residual anomalies | `GET /api/admin/resources/utilization-seasonal-anomalies` | Dual criterion (zScore OR residualDelta) + CI. |
| Capacity forecasts | `GET /api/admin/resources/capacity-forecast` | Heuristic, smoothing, Holt-Winters. |
| Utilization snapshots | `GET /api/admin/resources/utilization-history` | Rolling snapshots (max 500). |
| Metrics (Prometheus-style) | `GET /api/admin/metrics` | Booking counts, utilization, cancellations, etc. |
| Email queue health | `GET /api/admin/email-queue` | Pending email jobs status. |
| Resource catalog | `GET /api/admin/resources` | Active/inactive capacities. |

## 3. Severity Tiers
Derived fields: `severityLevel` (0-4), `severityLabel`, `recommendedAction`.

### Utilization (zScore Based)
- 0 Normal: |z| < 1.8
- 1 Informational: 1.8 ≤ |z| < 2.5
- 2 Watch: 2.5 ≤ |z| < 3.5
- 3 Action: 3.5 ≤ |z| ≤ 5
- 4 Critical: |z| > 5

### Seasonal Residual (Max of zScore Tier & residualDelta Tier)
Residual Delta Tiers:
- 0 <0.05 Normal
- 1 0.05–<0.07 Informational
- 2 0.07–<0.10 Watch
- 3 0.10–≤0.15 Action
- 4 >0.15 Critical

### Confidence Maturity
- `ciDistribution='t'` indicates baseline samples <30 (intervals wider). Treat spikes cautiously; prefer confirming persistence before escalation.
- Transition to `ciDistribution='z'` (≥30 samples) narrows intervals; severity levels more reliable for automation.

## 4. Standard Operating Procedure (SOP)
1. Query severity endpoint every monitoring interval (e.g., 1–5 min).  
2. Filter results where `severityLevel >= 2` (Watch+).  
3. For each, fetch raw anomaly endpoints if additional detail needed (e.g., confirm residualDelta vs zScore driver).  
4. Apply action by tier (Section 5).  
5. Log adjustments or overrides (threshold changes, suppression initiated) in audit channel.

### Quick PowerShell Commands
```powershell
# Set working directory
Set-Location "c:\Users\kcsmi\OneDrive\Documents\VSCode\Meter & Melody\design\backend\node-express-stripe"

# Fetch severity (example window override)
$severity = Invoke-RestMethod -Uri "http://localhost:4242/api/admin/resources/anomaly-severity?window=60&threshold=2&seasonLength=6" -Headers @{"x-admin-key"="primary-key"}
$severity.utilizationSeverity | Format-Table id,severityLabel,zScore

# Fetch seasonal anomalies for a specific resource
$seasonal = Invoke-RestMethod -Uri "http://localhost:4242/api/admin/resources/utilization-seasonal-anomalies?window=60&seasonLength=6&threshold=2" -Headers @{"x-admin-key"="primary-key"}
$seasonal.anomalies | Where-Object {$_.id -eq 'piano'} | Format-List

# Metrics snapshot
Invoke-RestMethod -Uri "http://localhost:4242/api/admin/metrics" -Headers @{"x-admin-key"="primary-key"} | Out-String | Select-String "melody_bookings_utilization_percent"
```

## 5. Action Matrix
| Severity | Label | Primary Drivers | Operator Action | SLA (Response) |
|----------|-------|-----------------|-----------------|----------------|
| 0 | Normal | Routine variance | None | N/A |
| 1 | Informational | Mild z/residual rise | Annotate dashboard; watch next cycle | 1 hour |
| 2 | Watch | Emerging trend (z 2.5–3.5 or residualDelta 0.07–0.10) | Review capacity forecast; prepare mitigation (extend capacity minutes or shift bookings) | 30 min |
| 3 | Action | Significant spike (z up to 5 or delta ≤0.15) | Trigger capacity adjustment plan; notify scheduling lead | 15 min |
| 4 | Critical | Extreme spike (z>5 or delta>0.15) | Escalate: send alert (email/SMS), initiate contingency (overflow resource activation) | 5 min |

## 6. Escalation Path
1. Scheduling Engineer On-Call (primary).  
2. Product Operations Lead.  
3. Director (if severity 4 persists > 30 min or repeated 3 times in 2 hours).  
4. Executive notification if severity 4 impacts >50% of active resources simultaneously.

## 7. Investigation Checklist
For severity ≥3:
- Confirm `ciDistribution` (t vs z) to judge confidence.
- Examine `expectedLower/expectedUpper` vs `lastUtilizationPercent` (outside upper bound?).
- Retrieve utilization history to assess duration of elevation.
- Check capacity forecast projection (`capacity-forecast` endpoint) – is projectedNextUtilizationPercent reinforcing trend?
- Validate booking volume surges: compare `melody_bookings_confirmed_total` metric over last intervals.
- Confirm no data anomalies (e.g., sudden capacityMinutes changes or dropped snapshots).

## 8. Threshold Tuning Procedure
Use only after documented false-positive or false-negative occurrence.
1. Record current baseline: sample count (N), CV (coefficientOfVariation if seasonal), current thresholds.
2. If false positives with high volatility (CV > 0.30): increment `threshold +0.2` OR raise `deltaThreshold +0.02` (prefer delta first).  
3. If false negatives (missed surges): lower `deltaThreshold -0.02` (not below 0.05) before adjusting z threshold.
4. Re-evaluate after 3 monitoring cycles; revert if effect detrimental.
5. Log change: `{ ts, resource_id?, threshold_before, threshold_after, delta_before, delta_after, reason }`.

## 9. Capacity Response Playbook
When severity reaches Action (3) for >2 consecutive cycles OR Critical (4) once:
- Identify top 3 impacted resources by severityLevel & zScore magnitude.
- If capacityMinutes adjustable (dynamic catalog), increase temporary capacity (e.g., +10–15%) with versioned PATCH.
- If no capacity slack: redistribute future bookings to lower-utilization resources (reschedule outreach). Prioritize bookings with >48h lead time.
- Post-change: monitor severity for regression; if normalization occurs (back to ≤1), revert temporary capacity after a cool-down period (≥24h).

## 10. Alert Suppression & Cool-down (Future Extension)
Until suppression is implemented, manual gating:
- If repeated severity 3 spikes (≥5 times in 2 hours) without escalation to 4 and utilization returns inside CI within 2 cycles, pause further Action alerts for that resource for 60 min.
- Document manual suppression decisions in audit.

## 11. Runbook Review Cadence
- Weekly: Spot-check severity trends; adjust thresholds only with evidence.
- Monthly: Recompute recommended thresholds using updated sample distributions & CV medians.
- Quarterly: Validate seasonLength appropriateness; adjust if pattern shifts (e.g., new scheduling rhythm).

## 12. Operational KPIs
| KPI | Target | Source |
|-----|--------|--------|
| Mean time to acknowledge action severity | <15 min | Audit log timestamps |
| False positive ratio (alerts dismissed) | <10% | Alert tracking vs actions taken |
| Capacity saturation incidents (critical >30 min) | 0 per week | Severity endpoint + metrics |
| Time in t-based CI mode (N<30) for primary resource | <10% of operating hours | Anomaly-severity endpoint |

## 13. Glossary
- **CI**: Confidence Interval for baseline mean (utilization) or raw utilization baseline (seasonal residual) using t or z distribution.
- **Residual Delta**: Absolute deviation of latest residual from baseline residual mean.
- **CV**: Coefficient of Variation (std/mean) clamped [0,1]. Higher indicates volatility.
- **SeasonLength**: Number of samples in one seasonal cycle for Holt-Winters decomposition.
- **CapacityMinutes**: Configured theoretical daily capacity for a resource.

## 14. Change Log
- v0.7.8: Initial runbook with severity integration (t-based CI maturity handling).

## 15. Reference Configuration Snippets
Adjust resource capacity (example):
```powershell
$body = @{ capacityMinutes = 300; version = 4 } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://localhost:4242/api/admin/resources/piano" -Headers @{"x-admin-key"="primary-key"} -Body $body -ContentType "application/json"
```

Inactive (soft delete) a resource:
```powershell
$body = @{ version = 7 } | ConvertTo-Json
Invoke-RestMethod -Method Delete -Uri "http://localhost:4242/api/admin/resources/violin" -Headers @{"x-admin-key"="primary-key"} -Body $body -ContentType "application/json"
```

## 16. Incident Template
```
Incident: <id>
Start TS: <timestamp>
Resources Affected: <list>
Initial Severity: <level/label>
Metrics Summary: utilization %, capacity %, bookings confirmed
Actions Taken: capacity increase / reschedule / threshold tune
Escalations: on-call -> ops lead -> director (if any)
Outcome: normalized / persistent / escalated
Follow-up Tasks: threshold revert, suppression rule, forecasting parameter review
```

---
End of Runbook.

# Anomaly Detection Endpoints

This document describes the resource utilization anomaly endpoints exposed under `/api/admin/resources/*`.
All endpoints require a valid admin key header: `x-admin-key`.

## Shared Concepts
- window (windowSize): Number of most recent utilization samples considered.
- threshold: Z-score (or residual z-score) cutoff for flagging anomalies.
- variance: Optional query param `variance=sample` to use sample variance (default population).
- Confidence Intervals (CI): For small sample sizes (`n < 30`), a t-critical value substitutes the z-critical in CI bounds.

## 1. Utilization Anomalies
`GET /api/admin/resources/utilization-anomalies?window=50&threshold=2&variance=sample`

Identifies point anomalies in raw utilization percent time series.

Parameters:
- window (default 50)
- threshold (default 2): absolute z-score cutoff ⇒ anomaly if `|z| >= threshold`.
- variance (default population)

Response Shape:
```
{
  windowSize,
  threshold,
  varianceMode,
  anomalies: [
    {
      id,
      samples,            // recent sample count considered
      zScore,              // last point z-score
      anomaly: true|false,
      lastUtilizationPercent,
      meanUtilizationPercent,
      ciDistribution,     // distribution critical (z or t)
      ciCritical,         // numeric critical value used
      meanLower,          // mean - critical * stdErr
      meanUpper
    }
  ]
}
```

## 2. Seasonal Residual Utilization Anomalies
`GET /api/admin/resources/utilization-seasonal-anomalies?window=60&threshold=2&seasonLength=6&alpha=0.5&beta=0.3&gamma=0.2&adapt=true&variance=sample`

Applies Holt–Winters (triple exponential smoothing) to derive seasonal expectation and flags residual anomalies.

Parameters:
- window (default 60)
- threshold (default 2): absolute residual z-score cutoff.
- seasonLength (default 6): length of season cycle.
- deltaThreshold (optional): if provided, uses residual absolute difference threshold layering.
- alpha, beta, gamma (optional): smoothing coefficients. If omitted internal defaults or adaptive tuning.
- adapt (optional boolean): `adapt=true` triggers adaptive coefficient selection.
- variance (optional): sample vs population variance.

Response Additions:
- expectedUtilizationPercent: Holt–Winters smoothed expectation.
- projectedNextUtilizationPercent: next-step forecast.
- residualDelta: absolute difference between last residual and mean residual.
- residualDeltaThreshold: threshold applied if `deltaThreshold` provided.
- expectedLower / expectedUpper: CI bounds around expected utilization.

## 3. Persistence (CUSUM) Utilization Anomalies
`GET /api/admin/resources/utilization-persistence-anomalies?window=80&k=0.25&h=5&variance=sample`

Detects sustained mean shifts using one-sided CUSUM accumulation.

Parameters:
- window (default 80): sample window for baseline and monitoring.
- k (default 0.25): reference value controlling sensitivity (approx half of detectable shift in std units).
- h (default 5): decision interval; larger h ⇒ fewer false positives.
- variance (optional): sample vs population.

Response Fields:
- k, h: parameters used.
- baselineMean: mean of early segment used for reference.
- cusumPositive / cusumNegative: current cumulative sums.
- shiftDetected: boolean aggregated anomaly flag.

## 4. Anomaly Severity Aggregation
`GET /api/admin/resources/anomaly-severity?window=60&threshold=2&seasonLength=6&variance=sample`

Combines point anomalies (utilization) and seasonal residual anomalies assigning severity tiers and recommended actions.

Severity Levels:
```
0 normal
1 informational
2 watch
3 action
4 critical
```

Residual Delta Tiers:
```
<0.05 normal
0.05–0.07 informational
0.07–0.10 watch
0.10–0.15 action
>0.15 critical
```

Final seasonal severity = max(zScore tier, residualDelta tier).

Response:
```
{
  generatedAt,
  windowSize,
  threshold,
  seasonLength,
  varianceMode,
  utilizationSeverity: [ { id, type:'utilization', severityLevel, severityLabel, recommendedAction, ... } ],
  seasonalSeverity: [ { id, type:'seasonal_residual', severityLevel, residualDelta, ... } ],
  severityLegend: [ { level, label, action } ]
}
```

## Error Handling & Admin Key
All endpoints return `401 { error:'unauthorized' }` if the admin key header is missing or invalid.
Rate limiting responses: `429 { error:'admin_rate_limited' }`.

## PromQL Suggestions
- Recent anomaly count (utilization): `increase(melody_utilization_anomalies_total[1h])`
- Seasonal residual watch rate: custom counter if instrumented separately.
- Persistence anomaly surge: consider exposing `melody_persistence_utilization_anomaly_total` and alert on 3+ in 1h.

## CI Behavior
For small windows (<30 samples) CI computation uses t-distribution critical values. Fields `ciDistribution` ("t" or "z") and `ciCritical` differentiate the selection.

## Adaptive Tuning Notes
When `adapt=true`, smoothing parameters may adjust per resource to minimize forecast error; monitor cardinality to ensure stability.

---
Revision: 0.1.2
Last Updated: 2025-11-22

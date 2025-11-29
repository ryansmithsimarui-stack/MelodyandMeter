# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2025-11-22
### Added
- Webhook hardening documentation: multi-secret rotation (`STRIPE_WEBHOOK_SECRETS`), timestamp tolerance (`STRIPE_SIG_TOLERANCE_SEC`), replay protection semantics.
- Metrics section for new security counters: valid, invalid, stale, replay_blocked, multisecret_match.

### Changed
- README environment setup now prefers `STRIPE_WEBHOOK_SECRETS` over legacy `STRIPE_WEBHOOK_SECRET`.
- Removed obsolete snapshot file after metrics expansion (test suite stable without brittle header snapshot).

## [0.1.0] - 2025-11-22
### Initial
- Base Express + Stripe integration, booking & resource analytics, metrics foundation.

## [0.1.2] - 2025-11-22
### Added
- Configurable replay window via `STRIPE_REPLAY_WINDOW_SEC` (seconds) with fallback to legacy `WEBHOOK_REPLAY_WINDOW_MS`; exposed as gauge metric.
- Structured JSON webhook error responses with stable `error` codes (`signature_invalid`, `signature_stale`, `signature_malformed`, etc.) and `detail` field.
- Comprehensive anomaly endpoint documentation (`ANOMALY-ENDPOINTS.md`) and README cross-link.

### Changed
- Updated tests to assert structured JSON errors instead of plaintext responses.
- Webhook handler now centralizes error mapping through helper for consistency.

### Security
- Clearer replay protection semantics and operator tunability without code changes.

# Changelog

## 3.3.0 (2026-10-28)

- New platforms: Elementor Pro, Kartra, WPForms, Squarespace, Contact Form 7 (nine total)
- `ec_event_id` (UUID) and `ec_detection_method` on every event
- 5-minute dedupe ledger (identifier-based, content-signature fallback)
- Consent queue: events raised while analytics consent is denied are replayed on grant
- First and last touch attribution with click IDs
- Optional SHA-256 hashing (`hashPii`)
- Expanded user data: `ec_first_name`, `ec_last_name`, `ec_company`, `ec_street`, `ec_city`, `ec_region`, `ec_postal_code`, `ec_country`
- Phone normalization to E.164 with `defaultCountryCode` and `countryCodeField`
- `strictSuccess` to drop inferred successes
- Failure diagnostics: `ec_failed_fields`, `ec_submit_attempt`, `ec_time_to_submit_*`, `ec_fast_submit`
- `ec_form_interaction` and `ec_tracker_initialized` events
- SPA route-change handling, observer cleanup after success
- Config moved to `window.EC_FORM_CONFIG`; `window._ecFormTracker.status()` debug API
- Container JSON updated to the v3.3.0 listener and trigger regex
- No existing event name or payload key changed

## 2.0.0

- SwipePages, Gravity Forms, GoHighLevel (inline and iframe), Unbounce
- Consent gate (Consent Mode v2, OneTrust, Cookiebot), PII redaction, failure tracking

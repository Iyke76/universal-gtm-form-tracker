# Universal GTM Form Tracker

> Confirmation-render-based form tracking for Google Tag Manager. One script. Nine platforms. Built-in consent gate, PII redaction, failure tracking, dedupe and Enhanced Conversions-ready user data.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-3.3.0-blue.svg)](CHANGELOG.md)
[![Platforms](https://img.shields.io/badge/platforms-9-green.svg)](#supported-platforms)

Docs, payload examples and per-platform standalone versions: **[iyrexmedia.com/gtm-form-listeners](https://iyrexmedia.com/gtm-form-listeners/)**

---

## The problem

Default form tracking in most GTM containers fires on **button click** (counts validation failures, rage clicks) or **thank-you page load** (counts refreshes, direct visits). Both methods miss real submissions and count fake ones. The accepted estimate from practitioners is a **5 to 30% miscount** on every install nobody audited.

The fix in theory is simple: listen for the confirmation render. The fix in practice is hard because every platform renders confirmation differently. Most form-tracking scripts cover one platform. This one covers nine, with the correct platform-native signal for each.

---

## What it does

- **Fires on the platform's own success signal**: a confirmation event, class or render. Never on a button click
- **Per-platform success and failure events** pushed to `window.dataLayer`, plus `ec_form_interaction` (first real input) and `ec_tracker_initialized` (heartbeat)
- **`ec_detection_method` on every event**, so you can segment leads by how they were detected
- **`ec_event_id` (UUID) on every event** for browser and Meta CAPI deduplication
- **5-minute dedupe ledger**: a repeat success for the same form and person is suppressed
- **Enhanced Conversions-ready user data**: normalized email, E.164 phone, first and last name, company, street, city, region, postal code, country. Optional SHA-256 hashes
- **Universal consent gate**: auto-detects Google Consent Mode v2, OneTrust and Cookiebot, with a one-function override for everything else. Events raised while consent is denied are queued and replayed when consent is granted
- **PII redaction**: password, card, SSN, IBAN and similar field names are always stripped. Add your own with `redactFields`
- **First and last touch attribution**: UTMs, click IDs (gclid, gbraid, wbraid, fbclid, msclkid, ttclid and more), landing page and referrer, stored for 30 days
- **Failure diagnostics**: which fields failed, attempt number, time to submit
- **Redirect-safe**: data captured at submit is recalled on same-domain thank-you pages and Gravity Forms or WPForms postback pages
- **Multi-form and SPA aware**: top, middle and footer forms tracked independently; late-loaded forms and `history.pushState` route changes handled
- **Idempotent**: safe to load twice, never double-initializes
- **ES5 only**: GTM's Custom HTML compiler accepts it without errors
- **`window._ecFormTracker.status()`** debug API

---

## Quick start

### Option A: Import the GTM container (5 minutes, no code)

1. Download [`universal-gtm-form-tracker.json`](universal-gtm-form-tracker.json) from this repo
2. In GTM: **Admin → Import Container → choose Merge → Rename Conflicting Tags**
3. Open the variable `Const - GA4 Measurement ID` and replace the placeholder with your own GA4 Measurement ID
4. Preview the container, submit a test form, confirm `*_form_success` lands in the dataLayer
5. Publish

The container ships the v3.3.0 listener tag and a Custom Event trigger on the v3.3.0 regex.

### Option B: Drop the script into your own GTM tag

1. Create a **Custom HTML** tag in GTM
2. Paste the full contents of [`universal-form-tracking-v3.3.0.gtm.html`](universal-form-tracking-v3.3.0.gtm.html). It already includes the `<script>` wrapper and fits under GTM's 102,400-character Custom HTML limit
3. Trigger on **All Pages (Page View)**, or Consent Initialization if your CMP needs the tracker early
4. Create a **Custom Event** trigger with the regex below and attach your GA4, Google Ads, Meta or server-side GTM tags

---

## Supported platforms

| Platform | Success signal | Event prefix |
|---|---|---|
| SwipePages | `amp-form-submit-success` class | `swipe_form` |
| Gravity Forms | `gform_confirmation_loaded` + `.gform_confirmation_wrapper`, postback pages | `gf_form` |
| Unbounce | Confirmation render after submit, HTML5 `invalid` for failures | `unbounce_form` |
| Elementor Pro | `submit_success` event + `.elementor-message-success` | `elementor_form` |
| GoHighLevel (inline) | Confirmation render after submit | `ghl_form` |
| GoHighLevel (iframe) | `postMessage` from the form iframe | `ghl_form` |
| Kartra | Confirmation render, `_error_border` class for failures | `kartra_form` |
| WPForms | `wpformsAjaxSubmitSuccess` + confirmation container, postback pages | `wpforms_form` |
| Squarespace | 2xx response from `/api/form/` + submission message render | `squarespace_form` |
| Contact Form 7 | `wpcf7mailsent` + `data-status="sent"` | `cf7_form` |

---

## Events fired

```
swipe_form_success        | swipe_form_failed
gf_form_success           | gf_form_failed
unbounce_form_success     | unbounce_form_failed
elementor_form_success    | elementor_form_failed
ghl_form_success          | ghl_form_failed
kartra_form_success       | kartra_form_failed
wpforms_form_success      | wpforms_form_failed
squarespace_form_success  | squarespace_form_failed
cf7_form_success          | cf7_form_failed

ec_form_interaction       (first real input on a form)
ec_tracker_initialized    (script loaded, platforms detected)
```

One GTM trigger for every success event:

```
^(swipe|gf|unbounce|elementor|ghl|kartra|wpforms|squarespace|cf7)_form_success$
```

### Payload shape

```javascript
{
  event: 'cf7_form_success',
  ec_event_id: 'b3f1c2d4-...',            // UUID, pass to Meta as event_id
  ec_detection_method: 'confirmation_event',
  ec_tracker_version: '3.3.0',
  ec_name: 'Jane Doe',                    // PII
  ec_first_name: 'Jane',                  // PII
  ec_last_name: 'Doe',                    // PII
  ec_email: 'jane@example.com',           // PII, lowercased and validated
  ec_phone: '+15551234567',               // PII, E.164
  ec_company: '', ec_street: '', ec_city: '', ec_region: '',
  ec_postal_code: '', ec_country: '',
  form_url: 'https://example.com/contact',
  form_cta: 'Send',
  form_platform: 'cf7',
  form_position: 'top',                   // 'top' | 'middle' | 'footer'
  form_index: 1,
  form_id: '5',
  ec_submit_attempt: 1,
  ec_time_to_submit_s: 42,
  ec_fast_submit: false,                  // true when under fastSubmitMs (bot signal)
  ec_dedupe_basis: 'identifier',
  ec_first_source: 'google', ec_first_medium: 'cpc', ec_first_campaign: '...',
  ec_last_source: 'google',  ec_last_medium: 'cpc',  ec_last_campaign: '...',
  ec_click_id: 'Cj0K...', ec_click_id_type: 'gclid'
  // ec_email_sha256 / ec_phone_sha256 when hashPii: true
  // ec_raw_fields when rawFields: true
}
```

When PII consent is denied, `ec_name`, `ec_email`, `ec_phone`, `ec_raw_fields` and the hashes are removed and `ec_pii_redacted: true` is added.

### `ec_detection_method` values

| Value | Meaning |
|---|---|
| `confirmation_event` | The platform's own success event fired |
| `confirmation_class` | The platform's success class or container appeared |
| `confirmation_render` | A success or thank-you element rendered after submit |
| `postmessage` | GoHighLevel iframe posted the submission |
| `stored_recall` | Thank-you or postback page, matched to data stored at submit |
| `form_removed`, `generic_node`, `pagehide` | Inferred success. Turn off with `strictSuccess: true` |
| `validation_message`, `error_class`, `error_render`, `invalid_event`, `spam_blocked`, `mail_failed` | Failure paths |

---

## Configuration

Set `window.EC_FORM_CONFIG` before the script runs. The deploy build ships with a production config block at the top of the file.

| Key | Default | What it does |
|---|---|---|
| `debug` | `false` in the deploy build | `[EC]` console logs |
| `hashPii` | `false` | Add `ec_email_sha256` and `ec_phone_sha256` (HTTPS only) |
| `rawFields` | `false` in the deploy build | Include `ec_raw_fields`. Keep it out of GA4 |
| `dedupe` | `true` | Suppress a repeat success within 5 minutes |
| `strictSuccess` | `false` | Drop inferred successes (`generic_node`, `pagehide`, `form_removed`) |
| `defaultCountryCode` | `'1'` | Phone fallback when the form has no country field |
| `countryCodeField` | `''` | Exact field name that holds an ISO2 or dial code |
| `platforms` | all | Limit to e.g. `['cf7','gravityforms']` |
| `redactFields` | `[]` | Extra field names (strings or RegExps) to strip |
| `extraThankYouPatterns` | `[]` | Extra thank-you URL substrings |
| `attribution` | `true` | First and last touch keys |
| `queueOnDenied` | `true` | Queue events while consent is denied, replay on grant |
| `allowRecoverySuccess` | `true` | Allow a success after a failure on the same form |
| `submitWindowMs` | `15000` | How long after submit a success signal is accepted |
| `ttlMs` | `600000` | Freshness window for thank-you recall |
| `fastSubmitMs` | `2000` | Threshold for `ec_fast_submit` |
| `failedFieldSelectors` | `''` | Extra CSS selectors for failed-field capture |

### Consent

Auto-detected, no setup required:

- **Google Consent Mode v2**: `analytics_storage` and `ad_user_data`
- **OneTrust**: groups C0002 (analytics) and C0004 (targeting)
- **Cookiebot**: `statistics` and `marketing`

For anything else, set this before the script loads:

```javascript
window.EC_FORM_CONSENT_CHECK = function () {
  return { analytics: yourCmp.statisticsGranted(), pii: yourCmp.marketingGranted() };
};
```

| Axis | Denied behavior |
|---|---|
| `analytics` | Nothing fires, nothing stored. Events queue and replay on grant |
| `pii` | Events fire without PII keys, `ec_pii_redacted: true` added |

If no CMP or override is found, the tracker assumes full consent. Match that to your own legal requirements. After a custom CMP updates consent, call `window._ecFormTracker.consentUpdated()`.

---

## PII handling: read this

`ec_name`, `ec_email`, `ec_phone`, the address keys and `ec_raw_fields` are meant for Google Ads Enhanced Conversions, Meta CAPI (ideally through server-side GTM) and first-party CRM integrations.

**Do not send them to GA4.** GA4's terms prohibit PII in event parameters. Send `form_id`, `form_platform`, `form_position` and `ec_detection_method` to GA4 instead.

---

## Debugging

```javascript
window._ecFormTracker.status()          // version, consent, platforms, forms, last event, config
window._ecFormTracker.payload({...})    // dry-run the classifier on a fields object
window._ecFormTracker.normalizePhone('(555) 123-4567')
```

---

## Upgrading from v2.0.0

- Event names for SwipePages, Gravity Forms, GoHighLevel and Unbounce are unchanged. Existing triggers keep working
- Widen your trigger regex to the v3.3.0 pattern above to pick up the five new platforms
- `DEBUG` inside the script is replaced by `EC_FORM_CONFIG.debug`
- New keys are additive. No existing key was renamed or removed
- [`universal-form-tracking-v2.js`](universal-form-tracking-v2.js) stays in the repo for anyone pinned to v2

**Do not run the universal tracker and a standalone tracker for the same platform on the same page.** You will get two success events per submission.

---

## Caveats / known limitations

- The GHL iframe `postMessage` format is reverse-engineered. If GoHighLevel changes it, that path stops firing. `debug: true` shows ignored messages
- Squarespace detection patches `fetch` and `XMLHttpRequest` for `/api/form/` requests only
- Cross-domain thank-you redirects cannot use same-domain recall
- Bot submissions that pass the platform's own validation still count as success. Use `ec_fast_submit` to filter
- Not every CMP is auto-detected. Use the override hook
- HubSpot and Marketo are not covered yet

---

## Credits

This script exists because of public work by:

- **[Chloe Christine](https://www.linkedin.com/in/chloe-christine-allerton/)**, whose LinkedIn post on form tracking miscount was the springboard
- **[Simo Ahava](https://www.simoahava.com/)**, whose decade of writing on the GTM Form Submission trigger shaped the philosophy
- **[Julius Fedorovicius](https://www.analyticsmania.com/)**, whose platform-specific tutorials informed every detection signal here
- Charles Farina, Lukas Oldenburg, Brian Clifton, Markus Baersch, Krista Seiden, for the broader measurement-quality conversation this work sits inside

Background reading: [the original deep dive on Medium](https://medium.com/@abeliyke/the-universal-gtm-form-tracker-that-doesnt-exist-yet-swipe-unbounce-gravity-and-gohighlevel-b3d8dfa432c7).

---

## License

[MIT](LICENSE). Use it freely, modify it freely, ship it in client work, keep the copyright notice.

## Author

Iyke Abel · [LinkedIn](https://www.linkedin.com/in/iykeabel/) · [iyrexmedia.com](https://iyrexmedia.com/gtm-form-listeners/)

If this saved you time, forward it to one measurement engineer who manages a GTM container they didn't build.

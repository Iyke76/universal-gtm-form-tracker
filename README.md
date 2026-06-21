# Universal GTM Form Tracker

> Confirmation-render-based form tracking for Google Tag Manager. One script. Five platforms. Built-in consent gate, PII redaction, failure tracking.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](#)
[![Platforms](https://img.shields.io/badge/platforms-5-green.svg)](#supported-platforms)

---

## The problem

Default form tracking in most GTM containers fires on **button click** (counts validation failures, rage clicks) or **thank-you page load** (counts refreshes, direct visits). Both methods miss real submissions and count fake ones. The accepted estimate from practitioners is a **5–30% miscount** on every install nobody audited.

The fix in theory is simple: listen for the confirmation render. The fix in practice is hard because every platform renders confirmation differently. Most form-tracking scripts cover one platform. This one covers five with the correct platform-native signal for each.

---

## What it does

- **Fires only on observable confirmation render** — never on click, never on thank-you page load
- **Per-platform success and failure events** pushed to `window.dataLayer`
- **Multi-form aware** — top / middle / footer forms tracked independently with position labels
- **Universal consent gate** — auto-detects Google Consent Mode v2, OneTrust, Cookiebot; one-function override hook for everything else
- **PII redaction** — toggle a flag, raw email/phone/name are stripped from the payload (GA4 ToS safe)
- **Failure tracking** — gated by `hadInput` so empty-click rage doesn't fire false failures
- **Idempotent** — safe to load multiple times (won't double-init, won't double-fire)
- **Multilingual thank-you URL fallback** — English plus 8 other languages
- **Cross-page persistence** — `localStorage` + `sessionStorage` with 10-min TTL
- **`pagehide` (not `beforeunload`)** — reliable on mobile Safari and bfcache

---

## Quick start

### Option A: Import the GTM container (5 minutes, no code)

1. Download [`universal-gtm-form-tracker.json`](universal-gtm-form-tracker.json) from this repo
2. In GTM: **Admin → Import Container → choose Merge → Rename Conflicting Tags**
3. Open the variable `Const - GA4 Measurement ID` and replace the placeholder with your own GA4 Measurement ID
4. Preview the container, submit a test form, confirm `*_form_success` lands in the dataLayer
5. Publish

### Option B: Drop the script into your own GTM tag

1. Create a **Custom HTML** tag in GTM
2. Paste the contents of [`universal-form-tracking.js`](universal-form-tracking-v2.js) wrapped in `<script>` tags
3. Trigger on **All Pages — Page View** (or Consent Initialization if using a CMP)
4. Configure your GA4 / Meta CAPI / sGTM tags to listen for the events listed below

---

## Supported platforms

| Platform | Detection signal | Event prefix |
|---|---|---|
| SwipePages | `amp-form-submit-success` class mutation | `swipe_form` |
| Gravity Forms | `gform_confirmation_loaded` event + `.gform_confirmation_wrapper` observer | `gf_form` |
| GoHighLevel (inline) | DOM mutation after submit + `pagehide` fallback | `ghl_form` |
| GoHighLevel (iframe) | `postMessage` parsing across origins | `ghl_form` |
| Unbounce | Parent node observer + HTML5 `invalid` + `pagehide` | `unbounce_form` |

---

## Events fired

Each platform fires success and failure events with platform-specific prefixes:

```
swipe_form_success     | swipe_form_failed
gf_form_success        | gf_form_failed
ghl_form_success       | ghl_form_failed
unbounce_form_success  | unbounce_form_failed
```

To match all four success events with one GTM trigger, use a regex:

```
^(swipe|gf|ghl|unbounce)_form_success$
```

### Payload shape

```javascript
{
  event: 'gf_form_success',         // platform-specific
  ec_name: 'Jane Doe',              // PII — strip before sending to GA4
  ec_email: 'jane@example.com',     // PII — strip before sending to GA4
  ec_phone: '+15551234567',         // PII — strip before sending to GA4
  ec_raw_fields: { ... },           // PII — strip before sending to GA4
  form_url: 'https://...',
  form_cta: 'Get a quote',
  form_platform: 'gravityforms',
  form_position: 'top',             // 'top' | 'middle' | 'footer'
  form_index: 1
}
```

When PII consent is denied, the PII fields are removed and a flag is added:

```javascript
{
  event: 'gf_form_success',
  form_url: '...',
  form_cta: '...',
  form_platform: 'gravityforms',
  form_position: 'top',
  form_index: 1,
  ec_pii_redacted: true
}
```

---

## Configuration

### Debug mode

Set `DEBUG = true` (default) in the script for `[EC]`-prefixed console logs of every lifecycle event. Set to `false` for production silent mode.

### Consent gate — auto-detection

Auto-detected CMPs (no setup required):

- **Google Consent Mode v2** — reads `ad_user_data` and `analytics_storage` states
- **OneTrust** — checks `OnetrustActiveGroups` for C0002 (analytics) and C0004 (targeting)
- **Cookiebot** — checks `Cookiebot.consent.statistics` and `Cookiebot.consent.marketing`

If none detected, defaults to full consent. Set up an override for anything else.

### Consent gate — override hook

For Iubenda, Termly, Usercentrics, or custom solutions, set this **before the script loads** (in a GTM Consent Initialization tag, or above the script tag in your HTML):

```javascript
window.EC_FORM_CONSENT_CHECK = function() {
  // Return one of:
  //   true                            — full consent
  //   false                           — no consent
  //   { analytics: bool, pii: bool }  — granular (recommended)
  return {
    analytics: yourCmp.statisticsGranted(),
    pii: yourCmp.marketingGranted()
  };
};
```

### Two consent axes

| Axis | Denied behavior |
|---|---|
| `analytics` | No event fires, no storage written |
| `pii` | Event fires *without* `ec_email` / `ec_phone` / `ec_name` / `ec_raw_fields`; `ec_pii_redacted: true` added |

---

## PII handling — READ THIS

The dataLayer payload includes `ec_email`, `ec_phone`, `ec_name`, and `ec_raw_fields`. These are intended for:

1. **Server-side GTM** with a SHA-256 hashing transformation before forwarding to Meta CAPI, Google Enhanced Conversions, etc.
2. **First-party CRM integrations** where the data stays in your own infrastructure.

**Do NOT send these raw fields to GA4 via a standard GA4 Event tag.** GA4's Terms of Service prohibit PII in event parameters and Google can disable the property. Either:

- Use server-side GTM with hashing, OR
- Configure your GA4 Event tag in GTM to explicitly **exclude** `ec_email`, `ec_phone`, `ec_name`, and `ec_raw_fields` from the parameters list

This is your GTM configuration, not the script's job. The script gives you the clean data — what you do with it downstream is on you.

---

## Architecture overview

The script lives in a single IIFE. On page load it:

1. Checks idempotency (`window._ec_form_tracker_loaded`)
2. Detects which form platforms are present
3. Attaches platform-specific listeners to each form independently (state stored per-form in a `WeakMap`)
4. Watches for late-loaded or dynamically-injected forms via `MutationObserver` + a 12-second polling fallback
5. Captures form data progressively (on every keystroke) into in-memory + localStorage + sessionStorage
6. Fires success events on confirmation render; fires failure events on observable error states (gated by `hadInput`)

The hardest dedupe case — Gravity Forms AJAX success **plus** redirect to a thank-you URL — is handled by a `_success_fired` flag persisted with the form data. Thank-you page bootstrap checks the flag before firing. One success per submission, always.

For the full architectural walkthrough including code excerpts, see the [Medium deep dive](#) *(https://medium.com/@abeliyke/the-universal-gtm-form-tracker-that-doesnt-exist-yet-swipe-unbounce-gravity-and-gohighlevel-b3d8dfa432c7)*.

---

## Caveats / known limitations

- **Not every CMP is auto-detected.** Iubenda, Termly, Usercentrics, and custom solutions require the override hook (documented above).
- **The GHL iframe `postMessage` format is reverse-engineered.** If GoHighLevel changes their internal message structure, the listener silently stops firing for that iframe. Debug logs surface this immediately when `DEBUG=true`.
- **`SUBMIT_WINDOW` is 15 seconds.** Generous, but extremely slow networks with file uploads or CAPTCHA chains could exceed it. Configurable at the top of the script.
- **`MutationObserver` has theoretical race edge cases** on very slow renders or when unrelated DOM mutations occur within the submit window (popups, A/B testing tools, chat widgets). The submit-window gate and classname filter mitigate this in practice.
- **HubSpot, Marketo, WPForms, and CF7 are not yet covered.** See [Roadmap](#roadmap).
- **This is not a replacement for server-side CAPI dedupe.** The script gives you clean client-side data with PII ready for hashing. Sending that to Meta or Google's Conversions API with proper deduplication is still your job.

---

## Roadmap

Planned platform additions for v2.1:

- HubSpot embedded forms (native `onFormSubmitted` callback)
- Marketo forms (`MktoForms2.whenReady` + `onSuccess` callback)
- WPForms (`wpformsAjaxSubmitSuccess` event)
- Contact Form 7 (`wpcf7mailsent` event)

If you need one of these urgently, open an issue or submit a PR.

---

## Contributing

PRs welcome. The fastest way to add value:

1. **Test on a real install** of one of the supported platforms and report regressions
2. **Add a platform** following the existing handler pattern (`initSwipePages` is the cleanest reference)
3. **Improve CMP auto-detection** — Iubenda, Termly, Usercentrics signal detection
4. **Translate `isThankYouUrl()` patterns** — add language coverage for confirmation URLs

For substantive changes, please open an issue first, describing the approach.

---

## Credits

This script exists because of public work by:

- **[Chloe Christine](https://www.linkedin.com/in/chloe-christine-allerton/)** — whose LinkedIn post on form tracking miscount was the springboard
- **[Simo Ahava](https://www.simoahava.com/)** — whose decade of writing on the GTM Form Submission trigger shaped the philosophy
- **[Julius Fedorovicius](https://www.analyticsmania.com/)** — whose platform-specific tutorials informed every detection signal here
- Charles Farina, Lukas Oldenburg, Brian Clifton, Markus Baersch, Krista Seiden — for the broader measurement-quality conversation, this work sits inside

---

## License

[MIT](LICENSE) — use it freely, modify it freely, ship it in client work, just keep the copyright notice.

---

## Author

Iyke Abel · [LinkedIn](https://www.linkedin.com/in/iykeabel/) · abeliyke05@gmail.com

If this saved you time, please forward it to one measurement engineer who manages a GTM container they didn't build.

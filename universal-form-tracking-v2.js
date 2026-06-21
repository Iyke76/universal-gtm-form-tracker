<script>
/**
 * Author: Iyke Abel
 * Linkedin: https://www.linkedin.com/in/iykeabel/
 * Email: abeliyke05@gmail.com
 *
 * Universal Form Tracking — Confirmation-Render-Based (v2.0.0)
 * ============================================================
 * Supports SwipePages, Gravity Forms, GoHighLevel (inline + iframe), Unbounce
 *
 * Philosophy:
 *  - Fires on observable confirmation render (DOM-level success signal)
 *  - NOT on submit button click (counts validation failures, rage clicks)
 *  - NOT on thank-you page load (counts direct navigations, refreshes)
 *  - Failed submissions fire on real failure render only (not on every click)
 *
 * Multi-form aware: handles top/middle/footer placements independently.
 *
 * Events pushed to dataLayer (platform-specific names — by design, so each
 * platform can be triggered independently in GTM):
 *  - SwipePages    : swipe_form_success    | swipe_form_failed
 *  - Gravity Forms : gf_form_success       | gf_form_failed
 *  - GoHighLevel   : ghl_form_success      | ghl_form_failed
 *  - Unbounce      : unbounce_form_success | unbounce_form_failed
 *
 * To match across all four in a single GTM trigger, use a regex match like:
 *   ^(swipe|gf|ghl|unbounce)_form_success$
 *
 * --- PII & DATALAYER ROUTING (READ BEFORE DEPLOYING) ---
 * The event payload includes ec_email, ec_phone, ec_name, and ec_raw_fields.
 * These are intended for:
 *   (a) Server-side use — Meta Conversions API, Google Enhanced Conversions,
 *       server-side GTM — where values are hashed before leaving the browser
 *   (b) First-party CRM integrations
 *
 * DO NOT send these raw fields to GA4 via a standard GA4 Event tag —
 * GA4's Terms of Service prohibit PII in event parameters and Google can
 * disable the property. Either:
 *   1. Use server-side GTM with a SHA-256 hashing transformation, OR
 *   2. Configure GA4 Event tags in GTM to explicitly EXCLUDE the
 *      ec_email / ec_phone / ec_name / ec_raw_fields parameters
 *
 * --- CONSENT GATE ---
 * Auto-detects: Google Consent Mode v2, OneTrust, Cookiebot.
 * Override globally before this script loads:
 *
 *   window.EC_FORM_CONSENT_CHECK = function() {
 *     // Return one of:
 *     //   true                                 — full consent (event + PII)
 *     //   false                                — no consent (no event, no storage)
 *     //   { analytics: bool, pii: bool }       — granular (recommended)
 *     return { analytics: true, pii: false };
 *   };
 *
 * Behavior:
 *   analytics denied → no event, no storage
 *   pii denied       → event fires WITHOUT ec_email/ec_phone/ec_name/ec_raw_fields,
 *                      storage strips PII, ec_pii_redacted=true flag is added
 *
 * Default (no CMP detected, no override): full consent — caller is responsible.
 *
 * --- IDEMPOTENCY ---
 * Safe to load multiple times. Re-init is a no-op (logged when DEBUG=true).
 *
 * --- DEBUGGING ---
 * Set DEBUG=true (default) to see [EC]-prefixed console logs for every
 * lifecycle event. Set to false for production silent mode.
 */
(function () {
  'use strict';
  // ═══════════════════════════════════════════════════════════════
  // LOAD GUARD — prevent double-init when script is loaded twice
  // (e.g., GTM Custom HTML + embedded copy on same page)
  // ═══════════════════════════════════════════════════════════════
  if (window._ec_form_tracker_loaded) {
    if (window.console) {
      console.log('[EC] Already initialized (v' + (window._ec_form_tracker_version || '?') + '), skipping re-init');
    }
    return;
  }
  window._ec_form_tracker_loaded = true;
  window._ec_form_tracker_version = '2.0.0';

  // ─── Config ───────────────────────────────────────────────────
  var DEBUG          = true;            // false in production for silent mode
  var STORAGE_KEY    = 'ec_form_data';
  var TTL            = 10 * 60 * 1000;  // 10 min — stale data ignored
  var SUBMIT_WINDOW  = 15 * 1000;       // 15s post-click watch window
                                        // (bumped from 10s — accommodates slow
                                        // networks, file uploads, CAPTCHA)
  function log() {
    if (DEBUG && window.console) console.log.apply(console, ['[EC]'].concat([].slice.call(arguments)));
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSENT GATE — universal, configurable
  //
  // Returns { analytics: bool, pii: bool }. analytics=false suppresses
  // event firing and storage entirely. pii=false strips PII from both
  // dataLayer pushes and storage (event still fires with metadata only).
  //
  // Detection priority:
  //   1. window.EC_FORM_CONSENT_CHECK override (caller-defined)
  //   2. Google Consent Mode v2 (window.google_tag_data.ics)
  //   3. OneTrust (window.OnetrustActiveGroups)
  //   4. Cookiebot (window.Cookiebot.consent)
  //   5. Default: full consent
  // ═══════════════════════════════════════════════════════════════
  function getConsent() {
    // Caller override — takes precedence over auto-detection
    if (typeof window.EC_FORM_CONSENT_CHECK === 'function') {
      try {
        var r = window.EC_FORM_CONSENT_CHECK();
        if (r === true)  return { analytics: true,  pii: true  };
        if (r === false) return { analytics: false, pii: false };
        if (r && typeof r === 'object') {
          return {
            analytics: r.analytics !== false,
            pii: r.pii === true || r.ads === true || r.marketing === true
          };
        }
      } catch (e) { log('Consent check threw:', e); }
    }
    // Google Consent Mode v2
    // State codes: 1 = granted, 2 = denied, undefined = not set
    if (window.google_tag_data && window.google_tag_data.ics &&
        typeof window.google_tag_data.ics.getConsentState === 'function') {
      try {
        var adUserData = window.google_tag_data.ics.getConsentState('ad_user_data');
        var analytics  = window.google_tag_data.ics.getConsentState('analytics_storage');
        return {
          analytics: analytics !== 2,           // any state except denied
          pii: adUserData === 1                 // strictly granted
        };
      } catch (e) {}
    }
    // OneTrust — common group IDs (C0002=Performance, C0004=Targeting).
    // Adjust group IDs in EC_FORM_CONSENT_CHECK if your OneTrust config differs.
    if (typeof window.OnetrustActiveGroups === 'string') {
      return {
        analytics: window.OnetrustActiveGroups.indexOf('C0002') !== -1,
        pii: window.OnetrustActiveGroups.indexOf('C0004') !== -1
      };
    }
    // Cookiebot
    if (window.Cookiebot && window.Cookiebot.consent) {
      return {
        analytics: !!window.Cookiebot.consent.statistics,
        pii: !!window.Cookiebot.consent.marketing
      };
    }
    // No CMP detected — full consent (caller is responsible for wiring one)
    return { analytics: true, pii: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // STORAGE — persists across same-domain navigation as a backup
  // ═══════════════════════════════════════════════════════════════
  function persist(data) {
    var consent = getConsent();
    data._ts = Date.now();
    // In-memory always retains full data for current page lifecycle.
    // Cross-page recall uses localStorage/sessionStorage, which is gated.
    window._ec_form_data = data;
    if (!consent.analytics) {
      log('Analytics consent denied — skipping storage');
      return;
    }
    var toStore = data;
    if (!consent.pii && data.fields) {
      // Deep clone then strip PII-bearing field types from persisted copy
      toStore = JSON.parse(JSON.stringify(data));
      Object.keys(toStore.fields).forEach(function (k) {
        var t = toStore.fields[k].type;
        if (t === 'email' || t === 'tel' || t === 'text' || t === 'textarea') {
          delete toStore.fields[k];
        }
      });
      toStore._pii_redacted = true;
    }
    var json = JSON.stringify(toStore);
    try { localStorage.setItem(STORAGE_KEY, json);   } catch (e) {}
    try { sessionStorage.setItem(STORAGE_KEY, json); } catch (e) {}
  }
  function recall() {
    var d = window._ec_form_data;
    if (!d) { try { var l = localStorage.getItem(STORAGE_KEY);   if (l) d = JSON.parse(l); } catch (e) {} }
    if (!d) { try { var s = sessionStorage.getItem(STORAGE_KEY); if (s) d = JSON.parse(s); } catch (e) {} }
    if (d && d._ts && (Date.now() - d._ts) > TTL) { wipe(); return null; }
    return d || null;
  }
  function wipe() {
    try { localStorage.removeItem(STORAGE_KEY);   } catch (e) {}
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
    window._ec_form_data = null;
  }
  // ═══════════════════════════════════════════════════════════════
  // PAYLOAD BUILDER — identifies PII by input TYPE, not field name.
  // Descriptive text fields (message, company, subject, etc.) are
  // excluded from ec_name by matching the field KEY against a regex,
  // so they don't pollute the name even when type="text".
  // ═══════════════════════════════════════════════════════════════
  var DESCRIPTIVE_FIELD_RE = /description|message|comment|note|project|about|bio|subject|how|details|inquiry|company|organi[sz]ation|website|url|reason|need|want|interest|budget|industry|role|title|address|city|state|country|zip|postal|referr|source|hear|question|feedback/i;

  function buildPayload(data) {
    var fields = data.fields || {};
    var nameParts = [], ec_email = '', ec_phone = '';
    Object.keys(fields).forEach(function (key) {
      var f = fields[key];
      if      (f.type === 'email')                                                              { ec_email = f.value; }
      else if (f.type === 'tel')                                                                { ec_phone = f.value; }
      else if (f.type === 'text' && !/^\d+$/.test(f.value) && !DESCRIPTIVE_FIELD_RE.test(key)) { nameParts.push(f.value); }
    });
    return {
      ec_name       : nameParts.join(' ').trim(),
      ec_email      : ec_email,
      ec_phone      : ec_phone,
      form_url      : data.entire_url || '',
      form_cta      : data.form_cta   || '',
      form_platform : data.platform   || '',
      form_position : data.position   || '',
      form_index    : data.index      || 0,
      ec_raw_fields : fields
    };
  }
  function pushEvent(eventName, data) {
    var consent = getConsent();
    if (!consent.analytics) {
      log('Analytics consent denied — skipping event:', eventName);
      return;
    }
    var p = buildPayload(data);
    p.event = eventName;
    if (!consent.pii) {
      delete p.ec_name;
      delete p.ec_email;
      delete p.ec_phone;
      delete p.ec_raw_fields;
      p.ec_pii_redacted = true;
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(p);
    log('->', eventName, p);
  }
  // ═══════════════════════════════════════════════════════════════
  // STATE — per-form state via WeakMap (per-element fallback for old browsers)
  // ═══════════════════════════════════════════════════════════════
  var STATE = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function getState(el)        { return STATE ? STATE.get(el) : el._ec_state; }
  function setState(el, state) { if (STATE) STATE.set(el, state); else el._ec_state = state; }
  // ═══════════════════════════════════════════════════════════════
  // POSITION — top / middle / footer based on DOM order
  // ═══════════════════════════════════════════════════════════════
  function positionFor(idx, total) {
    if (total <= 1)            return 'top';
    if (idx === 0)             return 'top';
    if (idx === total - 1)     return 'footer';
    return 'middle';
  }
  // ═══════════════════════════════════════════════════════════════
  // EVENT NAME RESOLVER
  // ═══════════════════════════════════════════════════════════════
  function eventName(platform, kind) {
  var prefix = platform === 'swipepages'      ? 'swipe_form'
             : platform === 'gravityforms'    ? 'gf_form'
             : platform === 'unbounce'        ? 'unbounce_form'
             : (platform === 'ghl_inline' ||
                platform === 'ghl_iframe')    ? 'ghl_form'
             : 'form';
  return prefix + '_' + kind;
}
  // ═══════════════════════════════════════════════════════════════
  // CONFIRMATION PAGE HANDLING
  // ═══════════════════════════════════════════════════════════════
  function isThankYouUrl() {
    var url = window.location.href.toLowerCase();
    var patterns = [
      // English
      'thank-you', 'thankyou', 'thank_you', '/thanks', '/ty',
      '/confirmation', '/confirmed', '/success', '/submitted', '/complete',
      // German
      '/danke', '/danke-schoen', '/danke-schon',
      // French
      '/merci', '/succes',
      // Spanish
      '/gracias', '/exito',
      // Italian
      '/grazie',
      // Portuguese
      '/obrigado', '/obrigada',
      // Dutch
      '/bedankt',
      // Polish
      '/dziekuje',
      // Swedish / Norwegian / Danish
      '/tack', '/takk'
    ];
    for (var i = 0; i < patterns.length; i++) if (url.indexOf(patterns[i]) !== -1) return true;
    return false;
  }
  function isGFPostbackConfirmation() {
    return document.querySelector('.gform_confirmation_wrapper') &&
          !document.querySelector('form[id^="gform_"]');
  }
  function handleConfirmationPage() {
    var stored = recall();
    if (!stored) { log('Confirmation page: no stored data'); return; }
    if (stored._success_fired) { log('Confirmation page: already fired on form page, skipping'); wipe(); return; }
    pushEvent(eventName(stored.platform, 'success'), stored);
    wipe();
  }
  // ═══════════════════════════════════════════════════════════════
  // PLATFORM DETECTION
  // ═══════════════════════════════════════════════════════════════
  function hasSwipePages()  { return !!document.querySelector('form[action-xhr="https://app.swipepages.com/api/leads"]'); }
  function hasGravityForms(){ return !!document.querySelector('form[id^="gform_"]'); }
  function hasGHLInline()   { return !!document.querySelector('.ghl-form-wrap form'); }
  function hasGHLIframe()   { return !!document.querySelector('iframe[src*="leadconnectorhq.com"], iframe[src*="msgsndr.com"], iframe[src*="gohighlevel.com"]'); }
  function hasUnbounce() {
  var allForms = document.querySelectorAll('form');
  for (var i = 0; i < allForms.length; i++) {
    if (allForms[i].querySelector('.lp-pom-form-field')) return true;
  }
  return false;
}
  // ═══════════════════════════════════════════════════════════════
  // SWIPEPAGES HANDLER
  // ═══════════════════════════════════════════════════════════════
  function initSwipePages() {
    var forms = document.querySelectorAll('form[action-xhr="https://app.swipepages.com/api/leads"]');
    if (!forms.length) return false;
    var attachedAny = false;
    forms.forEach(function (form, idx) {
      if (getState(form)) { attachedAny = true; return; }
      var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
      if (!inputs.length) return;
      var state = {
        position: positionFor(idx, forms.length),
        index: idx + 1,
        successFired: false,
        failedFired: false,
        hadInput: false
      };
      setState(form, state);
      function collect() {
        var fields = {};
        form.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="submit"])').forEach(function (i) {
          if (i.name && i.value && i.value.trim()) {
            fields[i.name] = { value: i.value.trim(), type: i.type };
          }
        });
        var urlField = form.querySelector('input[name="Entire_URL_sp"]');
        var ctaLabel = form.querySelector('.tatsu-form-primary-text');
        return {
          fields: fields,
          entire_url: urlField ? urlField.value : window.location.href,
          form_cta: ctaLabel ? ctaLabel.textContent.trim() : '',
          platform: 'swipepages',
          position: state.position,
          index: state.index
        };
      }
      inputs.forEach(function (input) {
        ['input', 'blur', 'change'].forEach(function (ev) {
          input.addEventListener(ev, function () {
            var d = collect();
            if (Object.keys(d.fields).length) { state.hadInput = true; persist(d); }
          });
        });
      });
      new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.type !== 'attributes' || m.attributeName !== 'class') return;
          if (!state.successFired && form.classList.contains('amp-form-submit-success')) {
            state.successFired = true;
            var d = collect();
            if (Object.keys(d.fields).length) {
              d._success_fired = true;
              persist(d);
              pushEvent('swipe_form_success', d);
            }
          }
          if (!state.failedFired && form.classList.contains('amp-form-submit-error') && state.hadInput) {
            state.failedFired = true;
            pushEvent('swipe_form_failed', collect());
          }
        });
      }).observe(form, { attributes: true, attributeNames: ['class'] });
      new MutationObserver(function () {
        if (state.failedFired || state.successFired || !state.hadInput) return;
        var w1 = form.querySelector('.tatsu-form-single-wraning');
        var w2 = form.querySelector('.tatsu-form-terms-wraning');
        var visible = function (el) { return el && el.offsetParent !== null; };
        if (visible(w1) || visible(w2)) {
          state.failedFired = true;
          pushEvent('swipe_form_failed', collect());
        }
      }).observe(form, { childList: true, subtree: true, attributes: true });
      attachedAny = true;
    });
    if (attachedAny) log('SwipePages:', forms.length, 'form(s) attached');
    return attachedAny;
  }
  // ═══════════════════════════════════════════════════════════════
  // GRAVITY FORMS HANDLER
  // ═══════════════════════════════════════════════════════════════
  function initGravityForms() {
    var forms = document.querySelectorAll('form[id^="gform_"]');
    if (!forms.length) return false;
    var attachedAny = false;
    forms.forEach(function (form, idx) {
      if (getState(form)) { attachedAny = true; return; }
      var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([autocomplete="new-password"]), select, textarea');
      if (!inputs.length) return;
      var state = {
        position: positionFor(idx, forms.length),
        index: idx + 1,
        successFired: false,
        failedFired: false,
        hadInput: false
      };
      setState(form, state);
      function collect() {
        var fields = {};
        form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([autocomplete="new-password"])').forEach(function (i) {
          if (i.closest('.gform_validation_container')) return;
          if (i.name && i.value && i.value.trim()) fields[i.name] = { value: i.value.trim(), type: i.type };
        });
        form.querySelectorAll('select').forEach(function (s) {
          if (s.name && s.value && s.value.trim()) fields[s.name] = { value: s.value.trim(), type: 'select' };
        });
        form.querySelectorAll('textarea').forEach(function (t) {
          if (t.name && t.value && t.value.trim()) fields[t.name] = { value: t.value.trim(), type: 'textarea' };
        });
        var btn = form.querySelector('input[type="submit"]');
        return {
          fields: fields,
          entire_url: window.location.href,
          form_cta: btn ? btn.value : '',
          platform: 'gravityforms',
          position: state.position,
          index: state.index
        };
      }
      inputs.forEach(function (input) {
        ['input', 'blur', 'change'].forEach(function (ev) {
          input.addEventListener(ev, function () {
            var d = collect();
            if (Object.keys(d.fields).length) { state.hadInput = true; persist(d); }
          });
        });
      });
      document.addEventListener('gform_confirmation_loaded', function () {
        if (state.successFired) return;
        state.successFired = true;
        var d = collect();
        if (Object.keys(d.fields).length || recall()) {
          var data = Object.keys(d.fields).length ? d : recall();
          if (data) { data._success_fired = true; persist(data); pushEvent('gf_form_success', data); }
        }
      });
      new MutationObserver(function () {
        if (state.successFired) return;
        if (document.querySelector('.gform_confirmation_wrapper')) {
          state.successFired = true;
          var stored = recall() || collect();
          if (stored) { stored._success_fired = true; persist(stored); pushEvent('gf_form_success', stored); }
        }
      }).observe(document.body, { childList: true, subtree: true });
      new MutationObserver(function () {
        if (state.failedFired || state.successFired || !state.hadInput) return;
        if (form.classList.contains('gform_validation_error') || form.querySelector('.validation_message:not(:empty)')) {
          state.failedFired = true;
          pushEvent('gf_form_failed', collect());
        }
      }).observe(form, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      attachedAny = true;
    });
    if (attachedAny) log('GravityForms:', forms.length, 'form(s) attached');
    return attachedAny;
  }
  // ═══════════════════════════════════════════════════════════════
  // GHL INLINE HANDLER
  // ═══════════════════════════════════════════════════════════════
  function initGHLInline() {
    var forms = document.querySelectorAll('.ghl-form-wrap form');
    if (!forms.length) return false;
    var attachedAny = false;
    forms.forEach(function (form, idx) {
      if (getState(form)) { attachedAny = true; return; }
      var wrap = form.closest('.ghl-form-wrap');
      var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select');
      if (!inputs.length) return;
      var state = {
        position: positionFor(idx, forms.length),
        index: idx + 1,
        successFired: false,
        failedFired: false,
        submitAt: 0,
        hadInput: false
      };
      setState(form, state);
      function collect() {
        var fields = {};
        form.querySelectorAll('input:not([type="hidden"]):not([type="submit"])').forEach(function (i) {
          if (i.name && i.value && i.value.trim()) fields[i.name] = { value: i.value.trim(), type: i.type };
        });
        form.querySelectorAll('textarea').forEach(function (t) {
          if (t.name && t.value && t.value.trim()) fields[t.name] = { value: t.value.trim(), type: 'textarea' };
        });
        form.querySelectorAll('select').forEach(function (s) {
          if (s.name && s.value && s.value.trim()) fields[s.name] = { value: s.value.trim(), type: 'select' };
        });
        var btnText = form.querySelector('.button-text p, .button-text');
        return {
          fields: fields,
          entire_url: window.location.href,
          form_cta: btnText ? btnText.textContent.trim() : '',
          platform: 'ghl_inline',
          position: state.position,
          index: state.index
        };
      }
      function fireSuccess() {
        if (state.successFired || state.failedFired) return;
        state.successFired = true;
        var d = collect();
        if (Object.keys(d.fields).length || recall()) {
          var data = Object.keys(d.fields).length ? d : recall();
          data._success_fired = true;
          persist(data);
          pushEvent('ghl_form_success', data);
        }
      }
      function fireFailed() {
        if (state.failedFired || state.successFired || !state.hadInput) return;
        state.failedFired = true;
        pushEvent('ghl_form_failed', collect());
      }
      inputs.forEach(function (input) {
        ['input', 'blur', 'change'].forEach(function (ev) {
          input.addEventListener(ev, function () {
            var d = collect();
            if (Object.keys(d.fields).length) { state.hadInput = true; persist(d); }
          });
        });
      });
      var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          state.submitAt = Date.now();
          persist(collect());
        });
      }
      new MutationObserver(function (mutations) {
        if (state.successFired || state.failedFired) return;
        if (!state.submitAt || (Date.now() - state.submitAt) > SUBMIT_WINDOW) return;
        if (!document.body.contains(form) || form.offsetParent === null) {
          fireSuccess();
          return;
        }
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1 || n === form || form.contains(n)) continue;
            var cls = (n.className || '') + ' ' + (n.querySelector ? (n.querySelector('*') || {className:''}).className || '' : '');
            if (/error|invalid|wrong|fail/i.test(cls)) { fireFailed(); return; }
            fireSuccess();
            return;
          }
        }
      }).observe(wrap || form.parentNode, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      new MutationObserver(function () {
        if (state.failedFired || state.successFired || !state.hadInput || !state.submitAt) return;
        if ((Date.now() - state.submitAt) > SUBMIT_WINDOW) return;
        var err = (wrap || form).querySelector('[class*="error" i], [class*="invalid" i], [aria-invalid="true"]');
        if (err && err.offsetParent !== null) fireFailed();
      }).observe(wrap || form, { childList: true, subtree: true, attributes: true });
      // pagehide (not beforeunload) — more reliable on mobile Safari + bfcache.
      // Covers the redirect-on-success scenario where no in-page render happens.
      window.addEventListener('pagehide', function () {
        if (state.successFired || state.failedFired) return;
        if (!state.submitAt || (Date.now() - state.submitAt) > SUBMIT_WINDOW) return;
        fireSuccess();
      });
      attachedAny = true;
    });
    if (attachedAny) log('GHL inline:', forms.length, 'form(s) attached');
    return attachedAny;
  }
  // ═══════════════════════════════════════════════════════════════
// UNBOUNCE HANDLER
// Success (inline message)  : form removed/hidden OR new content in parent
// Success (redirect)        : pagehide within window of submit
// Failure                   : HTML5 invalid event OR error-flagged element
// ═══════════════════════════════════════════════════════════════
function initUnbounce() {
  // Find Unbounce forms by their distinctive .lp-pom-form-field children
  var allForms = document.querySelectorAll('form');
  var forms = [];
  for (var i = 0; i < allForms.length; i++) {
    if (allForms[i].querySelector('.lp-pom-form-field')) forms.push(allForms[i]);
  }
  if (!forms.length) return false;
  var attachedAny = false;
  forms.forEach(function (form, idx) {
    if (getState(form)) { attachedAny = true; return; }
    var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select');
    if (!inputs.length) return;
    var state = {
      position: positionFor(idx, forms.length),
      index: idx + 1,
      successFired: false,
      failedFired: false,
      submitAt: 0,
      hadInput: false
    };
    setState(form, state);
    function collect() {
      var fields = {};
      form.querySelectorAll('input:not([type="hidden"]):not([type="submit"])').forEach(function (i) {
        if (i.name && i.value && i.value.trim()) {
          var type = i.type;
          // Tag descriptive text fields so buildPayload doesn't pull them into ec_name.
          // (Redundant safety — buildPayload also filters by field-name regex universally,
          // but this Unbounce-specific tagging is kept as defense-in-depth.)
          if (type === 'text' && /description|message|comment|note|project|about|bio|subject|how|details|inquiry/i.test(i.name)) {
            type = 'description';
          }
          fields[i.name] = { value: i.value.trim(), type: type };
        }
      });
      form.querySelectorAll('textarea').forEach(function (t) {
        if (t.name && t.value && t.value.trim()) fields[t.name] = { value: t.value.trim(), type: 'textarea' };
      });
      form.querySelectorAll('select').forEach(function (s) {
        if (s.name && s.value && s.value.trim()) fields[s.name] = { value: s.value.trim(), type: 'select' };
      });
      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      var label = btn ? (btn.querySelector('.label') || btn) : null;
      return {
        fields: fields,
        entire_url: window.location.href,
        form_cta: label ? label.textContent.trim() : '',
        platform: 'unbounce',
        position: state.position,
        index: state.index
      };
    }
    function fireSuccess() {
      if (state.successFired || state.failedFired) return;
      state.successFired = true;
      var d = collect();
      if (Object.keys(d.fields).length || recall()) {
        var data = Object.keys(d.fields).length ? d : recall();
        data._success_fired = true;
        persist(data);
        pushEvent('unbounce_form_success', data);
      }
    }
    function fireFailed() {
      if (state.failedFired || state.successFired || !state.hadInput) return;
      state.failedFired = true;
      pushEvent('unbounce_form_failed', collect());
    }
    // Progressive save
    inputs.forEach(function (input) {
      ['input', 'blur', 'change'].forEach(function (ev) {
        input.addEventListener(ev, function () {
          var d = collect();
          if (Object.keys(d.fields).length) { state.hadInput = true; persist(d); }
        });
      });
    });
    // Submit click — stamp time for pagehide + render-detection correlation
    var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        state.submitAt = Date.now();
        persist(collect());
      });
    }
    // HTML5 validation failure — Unbounce uses native required/pattern attributes
    inputs.forEach(function (input) {
      input.addEventListener('invalid', function () {
        if (state.successFired || !state.hadInput) return;
        // Only treat as failure if user actually submitted recently
        if (!state.submitAt || (Date.now() - state.submitAt) > 2000) return;
        fireFailed();
      });
    });
    // Render watcher: form removed/hidden OR new content appears in parent
    var parent = form.parentNode;
    new MutationObserver(function (mutations) {
      if (state.successFired || state.failedFired) return;
      if (!state.submitAt || (Date.now() - state.submitAt) > SUBMIT_WINDOW) return;
      if (!document.body.contains(form) || form.offsetParent === null) {
        fireSuccess();
        return;
      }
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1 || n === form || form.contains(n)) continue;
          var cls = (n.className || '') + ' ' + (n.querySelector ? (n.querySelector('*') || {className:''}).className || '' : '');
          if (/error|invalid|wrong|fail/i.test(cls)) { fireFailed(); return; }
          if (/confirmation|success|thank/i.test(cls)) { fireSuccess(); return; }
          fireSuccess();
          return;
        }
      }
    }).observe(parent, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    // pagehide — successful redirect scenario (mobile-Safari-friendly vs beforeunload)
    window.addEventListener('pagehide', function () {
      if (state.successFired || state.failedFired) return;
      if (!state.submitAt || (Date.now() - state.submitAt) > SUBMIT_WINDOW) return;
      fireSuccess();
    });
    attachedAny = true;
  });
  if (attachedAny) log('Unbounce:', forms.length, 'form(s) attached');
  return attachedAny;
}

  // ═══════════════════════════════════════════════════════════════
  // GHL IFRAME HANDLER
  // ═══════════════════════════════════════════════════════════════
  function initGHLIframe() {
    var iframes = document.querySelectorAll(
      'iframe[src*="leadconnectorhq.com"], iframe[src*="msgsndr.com"], iframe[src*="gohighlevel.com"]'
    );
    if (!iframes.length) return false;
    iframes.forEach(function (frame, idx) {
      if (getState(frame)) return;
      setState(frame, {
        position: positionFor(idx, iframes.length),
        index: idx + 1,
        successFired: false
      });
    });
    // Unmatched-message logger — surfaces silent breakage if GHL changes
    // their postMessage format. Active only when DEBUG=true.
    function logUnmatched(reason, data) {
      log('GHL iframe: ignored message (' + reason + '):', data);
    }
    window.addEventListener('message', function (event) {
      if (!/leadconnectorhq\.com|msgsndr\.com|gohighlevel\.com/.test(event.origin)) return;
      var source = null;
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i].contentWindow === event.source) { source = iframes[i]; break; }
      }
      if (!source) { logUnmatched('source iframe not matched', event.data); return; }
      var state = getState(source);
      if (!state || state.successFired) return;
      var data = event.data;
      if (!Array.isArray(data)) { logUnmatched('payload not array', data); return; }
      if (data[0] === 'msgsndr-booking-complete') return;
      if (typeof data[0] === 'string' && /booking|appointment|calendar/i.test(data[0])) return;
      if (typeof data[2] !== 'string') { logUnmatched('data[2] not string', data); return; }
      var parsed;
      try { parsed = JSON.parse(data[2]); } catch (e) { logUnmatched('data[2] JSON parse failed', data); return; }
      if (!parsed || typeof parsed !== 'object') { logUnmatched('parsed not object', parsed); return; }
      var hasIdentifier = parsed.email || parsed.phone || parsed.full_name || parsed.first_name || parsed.name;
      if (!hasIdentifier) { logUnmatched('no identifier field', parsed); return; }
      var fields = {};
      Object.keys(parsed).forEach(function (k) {
        var v = parsed[k];
        if (v == null || v === '') return;
        var sv = (typeof v === 'string') ? v.trim() : String(v);
        if (!sv) return;
        var type = /email/i.test(k) ? 'email' : /phone/i.test(k) ? 'tel' : 'text';
        fields[k] = { value: sv, type: type };
      });
      if (!Object.keys(fields).length) { logUnmatched('no usable fields after parse', parsed); return; }
      state.successFired = true;
      var payload = {
        fields: fields,
        entire_url: window.location.href,
        form_cta: '',
        platform: 'ghl_iframe',
        position: state.position,
        index: state.index,
        _success_fired: true
      };
      persist(payload);
      pushEvent('ghl_form_success', payload);
    });
    log('GHL iframe:', iframes.length, 'iframe(s) attached');
    return true;
  }
  // ═══════════════════════════════════════════════════════════════
  // BOOTSTRAP
  // ═══════════════════════════════════════════════════════════════
  function runHandlers() {
  var ran = false;
  if (hasSwipePages())   ran = initSwipePages()   || ran;
  if (hasGravityForms()) ran = initGravityForms() || ran;
  if (hasUnbounce())     ran = initUnbounce()     || ran;
  if (hasGHLInline())    ran = initGHLInline()    || ran;
  if (hasGHLIframe())    ran = initGHLIframe()    || ran;
  return ran;
}
  function bootstrap() {
    // 1. GF postback confirmation render (same URL, wrapper present, no form)
    if (isGFPostbackConfirmation()) { handleConfirmationPage(); return; }
    // 2. Thank-you URL fallback — works for ANY platform with stored data
    //    Safe because stored data has TTL — direct visits with no recent
    //    submission won't have data to fire
    if (isThankYouUrl()) {
      var stored = recall();
      if (stored && !stored._success_fired) {
        handleConfirmationPage();
        // Don't return — thank-you page may have its own forms (site-wide top/footer)
        // that we still want to attach to in case user submits again
      }
    }
    // 3. Attach platform handlers
    if (runHandlers()) return;
    // 4. Poll for late-rendered forms
    var tries = 0;
    var poll = setInterval(function () {
      if (runHandlers() || ++tries >= 40) clearInterval(poll);
    }, 300);
    // 5. MutationObserver for dynamically injected forms
    new MutationObserver(function () { runHandlers(); })
      .observe(document.body, { childList: true, subtree: true });
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', bootstrap)
    : bootstrap();
})();
</script>

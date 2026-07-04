/* serial_gate.js — the DETERMINISTIC serial-only gate for NNWI Operation-ID Phase-1 capture.
 *
 * Operator decision (EmeS 2026-07-03): in Phase 1 the camera may capture ONLY a serial number.
 * Anything other than a serial number is a HARD BLOCK. This module is the deterministic classifier
 * that the on-device OCR feeds: given the OCR text of a camera frame, it returns the serial to
 * green-light, or null to block. It stores/transmits nothing — it only classifies a string.
 *
 * Pure function, no DOM, no network — unit-testable in Node and reusable in the browser gate.
 */
(function (root) {
  // A serial is a compact alphanumeric token: has letters and/or digits, at least one digit,
  // no sentence structure, within a plausible length band. Faces/scenes OCR to junk or nothing;
  // documents OCR to many words / sentences — both are blocked.
  var MIN = 4, MAX = 24;

  function normalize(s) {
    return String(s || "").replace(/[‐-―]/g, "-").trim();
  }

  // Reject strings that look like sentences/PII rather than a serial.
  function looksLikeProse(text) {
    var words = text.split(/\s+/).filter(Boolean);
    if (words.length > 3) return true;                 // a serial is 1 token (allow a little OCR noise)
    if (/[.,;:!?'"()]/.test(text)) return true;        // punctuation => sentence/PII
    if (/@|https?:|www\./i.test(text)) return true;    // email/url
    return false;
  }

  function candidateToken(text) {
    // pick the longest alnum(+hyphen) run — a serial is usually the dominant token in frame
    var runs = (text.toUpperCase().match(/[A-Z0-9][A-Z0-9\-]{2,}/g) || []);
    runs.sort(function (a, b) { return b.length - a.length; });
    return runs[0] || "";
  }

  /** classifySerial(ocrText) -> { ok:true, serial } | { ok:false, reason } */
  function classifySerial(ocrText) {
    var text = normalize(ocrText);
    if (!text) return { ok: false, reason: "no_text (blank frame / face / scene)" };
    if (looksLikeProse(text)) return { ok: false, reason: "prose_or_pii (not a serial — hard block)" };
    var tok = candidateToken(text);
    if (!tok) return { ok: false, reason: "no_alnum_token" };
    if (tok.length < MIN) return { ok: false, reason: "too_short (" + tok.length + ")" };
    if (tok.length > MAX) return { ok: false, reason: "too_long (" + tok.length + ")" };
    if (!/[0-9]/.test(tok)) return { ok: false, reason: "no_digit (words are not serials)" };
    if (!/^[A-Z0-9\-]+$/.test(tok)) return { ok: false, reason: "bad_chars" };
    // All-digit tokens are ambiguous (PINs, years, ZIPs, phone fragments): require >=6 digits to be a
    // plausible serial. Mixed alphanumeric (has a letter) is accepted from length 4.
    var digitsOnly = tok.replace(/-/g, "");
    if (/^[0-9]+$/.test(digitsOnly) && digitsOnly.length < 6) {
      return { ok: false, reason: "short_all_digits (PIN/year/zip — not a serial)" };
    }
    return { ok: true, serial: tok };
  }

  var api = { classifySerial: classifySerial, _normalize: normalize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NNWI_SERIAL_GATE = api;
})(typeof window !== "undefined" ? window : globalThis);

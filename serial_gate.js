/* serial_gate.js — serial detector for NNWI Operation-ID Phase-1 capture.
 *
 * Operator decision: the capture must yield ONLY a serial number — no photo is ever stored or
 * transmitted; the on-device OCR must produce a serial to green-light. In the real world a product
 * label (e.g. an Arturia MiniLab) carries the serial PLUS model text, "Made in China", FCC/CE marks and
 * a barcode. So the gate does NOT reject a multi-word frame — it FINDS the serial-pattern token inside
 * the label text and returns only that string (the user then confirms it). Frames with no serial-like
 * token at all (a face, a scene, plain prose) are still a hard block.
 *
 * Pure functions, no DOM/network. Unit-testable in Node.
 */
(function (root) {
  "use strict";

  function normalize(s) { return String(s || "").replace(/[‐-―]/g, "-"); }

  // Is a single token a plausible serial? has a digit; length band; not a short all-digit (PIN/year/zip).
  function isSerialToken(tok) {
    var d = tok.replace(/[-\/]/g, "");
    if (d.length < 5 || d.length > 24) return false;
    if (!/[0-9]/.test(d)) return false;                   // words are not serials
    if (/^[0-9]+$/.test(d) && d.length < 6) return false; // 4-5 digit all-numeric = PIN/year
    if (!/^[A-Z0-9\-\/]+$/.test(tok)) return false;
    return true;
  }

  // Prefer longer; strongly prefer mixed alnum (letters+digits) over all-digits.
  function score(tok) {
    var mixed = /[A-Z]/.test(tok) && /[0-9]/.test(tok);
    return tok.replace(/[-\/]/g, "").length + (mixed ? 6 : 0);
  }

  var STOP = { MADEIN: 1, CHINA: 1, MODEL: 1, SERIAL: 1, TYPE: 1, INPUT: 1, OUTPUT: 1, RATED: 1, CLASS: 1 };

  /** findSerial(ocrText) -> { ok:true, serial, candidates, seen } | { ok:false, reason, seen } */
  function findSerial(ocrText) {
    var text = normalize(ocrText);
    var seen = text.replace(/\s+/g, " ").trim().slice(0, 90);
    if (!text.trim()) return { ok: false, reason: "no text in view", seen: seen };
    var raw = text.toUpperCase().match(/[A-Z0-9][A-Z0-9\-\/]{3,29}/g) || [];
    var cands = raw.filter(function (t) { return isSerialToken(t) && !STOP[t.replace(/[-\/]/g, "")]; });
    if (!cands.length) return { ok: false, reason: "no serial-like number found", seen: seen };
    cands.sort(function (a, b) { return score(b) - score(a); });
    var uniq = []; cands.forEach(function (c) { if (uniq.indexOf(c) < 0) uniq.push(c); });
    return { ok: true, serial: uniq[0], candidates: uniq.slice(0, 4), seen: seen };
  }

  // strict single-token check (kept for tests / typed-serial validation)
  function classifySerial(s) {
    var t = normalize(s).trim();
    if (!t) return { ok: false, reason: "no_text" };
    var tok = (t.toUpperCase().match(/[A-Z0-9][A-Z0-9\-\/]+/g) || []).sort(function (a, b) { return b.length - a.length; })[0] || "";
    if (!tok) return { ok: false, reason: "no_alnum" };
    if (isSerialToken(tok)) return { ok: true, serial: tok };
    if (!/[0-9]/.test(tok)) return { ok: false, reason: "no_digit" };
    var d = tok.replace(/[-\/]/g, "");
    if (/^[0-9]+$/.test(d) && d.length < 6) return { ok: false, reason: "short_all_digits" };
    return { ok: false, reason: "bad_length_or_chars" };
  }

  var api = { findSerial: findSerial, classifySerial: classifySerial, isSerialToken: isSerialToken };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NNWI_SERIAL_GATE = api;
})(typeof window !== "undefined" ? window : globalThis);

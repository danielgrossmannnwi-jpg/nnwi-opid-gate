/* opid_ocr_gate.js — NNWI Operation-ID Phase-1 camera capture gate.
 *
 * Operator decision (EmeS 2026-07-03): the camera may capture ONLY a serial number. Anything else is a
 * HARD BLOCK: the on-device OCR must GREEN-LIGHT a serial before the serial is accepted; no image is
 * ever stored or transmitted. This module drives the camera, OCRs frames on-device (Tesseract.js),
 * runs each through the deterministic serial_gate, and — only when a serial is confirmed — fills the
 * register form's serial field. It never uploads a frame; the frame is used in-memory then discarded.
 *
 * Depends on: serial_gate.js (window.NNWI_SERIAL_GATE) and Tesseract.js (window.Tesseract).
 * Production: self-host Tesseract.js + its worker/lang data under the plugin assets (no external CDN).
 *
 * Usage:
 *   NNWI_OPID_GATE.start({ video, canvas, status, shutter, serialInput, onAccept });
 */
(function (root) {
  "use strict";
  var GATE = root.NNWI_SERIAL_GATE;

  function setStatus(el, kind, msg) {
    if (!el) return;
    el.textContent = msg;
    el.className = "opid-gate-status opid-gate-" + kind; // block | scan | green
  }

  function start(cfg) {
    var video = cfg.video, canvas = cfg.canvas, status = cfg.status,
        shutter = cfg.shutter, serialInput = cfg.serialInput, onAccept = cfg.onAccept;
    var stream = null, worker = null, running = false, lastHit = null, hitCount = 0;

    function stop() {
      running = false;
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (worker && worker.terminate) { worker.terminate(); worker = null; }
    }

    function disableShutter() { if (shutter) { shutter.disabled = true; shutter.setAttribute("aria-disabled", "true"); } }
    function enableShutter() { if (shutter) { shutter.disabled = false; shutter.removeAttribute("aria-disabled"); } }

    disableShutter();
    setStatus(status, "scan", "Point the camera at the serial number…");

    if (!root.Tesseract) { setStatus(status, "block", "OCR engine not loaded. (self-hosted Tesseract.js required)"); return { stop: stop }; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus(status, "block", "Camera not available on this device — type the serial instead."); return { stop: stop }; }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (s) {
        stream = s; video.srcObject = s; video.setAttribute("playsinline", ""); video.play();
        return Tesseract.createWorker("eng");
      })
      .then(function (w) {
        worker = w; running = true; loop();
      })
      .catch(function () { setStatus(status, "block", "Camera permission denied — type the serial instead."); });

    function loop() {
      if (!running) return;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) { return setTimeout(loop, 300); }
      // sample the CENTER band where the user frames the serial (privacy: only this region is read)
      var cw = Math.floor(vw * 0.8), ch = Math.floor(vh * 0.28);
      canvas.width = cw; canvas.height = ch;
      canvas.getContext("2d").drawImage(video, Math.floor((vw - cw) / 2), Math.floor((vh - ch) / 2), cw, ch, 0, 0, cw, ch);
      worker.recognize(canvas).then(function (res) {
        // classify the OCR text deterministically — NOTHING about the frame is kept
        var text = (res && res.data && res.data.text) || "";
        canvas.getContext("2d").clearRect(0, 0, cw, ch); // discard the pixels immediately
        var verdict = GATE.classifySerial(text);
        if (verdict.ok) {
          // require the SAME serial on 2 consecutive frames to avoid OCR flukes
          if (verdict.serial === lastHit) { hitCount++; } else { lastHit = verdict.serial; hitCount = 1; }
          if (hitCount >= 2) {
            setStatus(status, "green", "Serial detected: " + verdict.serial + " — capture enabled.");
            enableShutter();
            if (shutter) {
              shutter.onclick = function () {
                if (serialInput) serialInput.value = verdict.serial;   // only the serial STRING proceeds
                stop();
                setStatus(status, "green", "Captured serial " + verdict.serial + ". No photo was stored.");
                if (typeof onAccept === "function") onAccept(verdict.serial);
              };
            }
            return; // stop the loop once green-lit; user confirms with the shutter
          }
        } else {
          hitCount = 0; lastHit = null;
          disableShutter();
          setStatus(status, "block", "HARD BLOCK — not a serial number (" + verdict.reason + "). No capture allowed.");
        }
        if (running) setTimeout(loop, 500);
      }).catch(function () { if (running) setTimeout(loop, 700); });
    }

    return { stop: stop };
  }

  root.NNWI_OPID_GATE = { start: start };
})(typeof window !== "undefined" ? window : globalThis);

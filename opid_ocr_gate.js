/* opid_ocr_gate.js — NNWI Operation-ID Phase-1 camera capture gate.
 *
 * The camera capture must yield ONLY a serial number; no image is ever stored or transmitted. This
 * drives the camera at high resolution with continuous autofocus (so a serial can be read from a
 * comfortable distance instead of an unfocusable macro close-up), OCRs a wide centre region on-device
 * (Tesseract.js), finds the serial token inside the label text (serial_gate.findSerial), shows a live
 * readout of what it sees, and — once a serial is found — enables the shutter for the user to confirm.
 *
 * Depends on: serial_gate.js (window.NNWI_SERIAL_GATE), Tesseract.js (window.Tesseract).
 * Production: self-host Tesseract.js + worker/lang data under the plugin assets (no external CDN).
 *
 * Usage: NNWI_OPID_GATE.start({ video, canvas, status, readout, shutter, serialInput, onAccept });
 */
(function (root) {
  "use strict";
  var GATE = root.NNWI_SERIAL_GATE;

  function setStatus(el, kind, msg) { if (el) { el.textContent = msg; el.className = "opid-gate-status opid-gate-" + kind; } }

  function start(cfg) {
    var video = cfg.video, canvas = cfg.canvas, status = cfg.status, readout = cfg.readout,
        shutter = cfg.shutter, serialInput = cfg.serialInput, onAccept = cfg.onAccept;
    var stream = null, worker = null, running = false, current = null;

    function stop() {
      running = false;
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (worker && worker.terminate) { worker.terminate(); worker = null; }
    }
    function enableShutter() { if (shutter) { shutter.disabled = false; shutter.removeAttribute("aria-disabled"); } }
    function disableShutter() { if (shutter) { shutter.disabled = true; shutter.setAttribute("aria-disabled", "true"); } }

    disableShutter();
    setStatus(status, "scan", "Hold the label ~15–25 cm away so it stays in focus…");

    if (!root.Tesseract) { setStatus(status, "block", "OCR engine not loaded."); return { stop: stop }; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus(status, "block", "Camera not available — type the serial."); return { stop: stop }; }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false
    }).then(function (s) {
      stream = s; video.srcObject = s; video.setAttribute("playsinline", ""); video.muted = true; video.play();
      // best-effort continuous autofocus (helps reading from a distance; ignored where unsupported)
      try {
        var track = s.getVideoTracks()[0];
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        var adv = [];
        if (caps.focusMode && caps.focusMode.indexOf("continuous") >= 0) adv.push({ focusMode: "continuous" });
        if (caps.focusDistance) adv.push({ focusDistance: caps.focusDistance.min }); // bias toward near
        if (adv.length) track.applyConstraints({ advanced: adv }).catch(function () {});
      } catch (e) {}
      return Tesseract.createWorker("eng");
    }).then(function (w) {
      worker = w; running = true; loop();
    }).catch(function () { setStatus(status, "block", "Camera permission denied — type the serial."); });

    function loop() {
      if (!running) return;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) { return setTimeout(loop, 300); }
      // WIDE centre region at NATIVE resolution — a distant serial keeps enough pixels to OCR.
      var cw = Math.floor(vw * 0.92), ch = Math.floor(vh * 0.55);
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, Math.floor((vw - cw) / 2), Math.floor((vh - ch) / 2), cw, ch, 0, 0, cw, ch);
      worker.recognize(canvas).then(function (res) {
        var text = (res && res.data && res.data.text) || "";
        ctx.clearRect(0, 0, cw, ch); // discard the pixels immediately — nothing is kept
        var r = GATE.findSerial(text);
        if (readout) readout.textContent = r.seen ? ("reading: " + r.seen) : "reading: (nothing yet — steady the label)";
        if (r.ok) {
          current = r.serial;
          var extra = r.candidates && r.candidates.length > 1 ? ("  ·  also saw: " + r.candidates.slice(1).join(", ")) : "";
          setStatus(status, "green", "Serial found: " + r.serial + " — tap “Use this serial” (or steady for a clearer read)." + extra);
          enableShutter();
          if (shutter) shutter.onclick = function () {
            if (serialInput) serialInput.value = current;
            stop();
            setStatus(status, "green", "Captured serial " + current + ". No photo was stored.");
            if (typeof onAccept === "function") onAccept(current);
          };
        } else {
          current = null; disableShutter();
          setStatus(status, "scan", "Looking for a serial number… (" + r.reason + ")");
        }
        if (running) setTimeout(loop, 450);
      }).catch(function () { if (running) setTimeout(loop, 700); });
    }

    return { stop: stop };
  }

  root.NNWI_OPID_GATE = { start: start };
})(typeof window !== "undefined" ? window : globalThis);

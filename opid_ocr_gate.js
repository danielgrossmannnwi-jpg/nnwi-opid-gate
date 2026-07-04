/* opid_ocr_gate.js — NNWI Operation-ID Phase-1 camera capture gate.
 *
 * Yields ONLY a serial number; no image is stored or transmitted. On a dense product label (serial +
 * unlock code + barcodes + regulatory text) the gate does NOT guess — it detects every serial-like code
 * (barcode via BarcodeDetector where available, plus on-device OCR of the label text) and presents them
 * as tappable candidates; the user taps the correct serial. A live readout shows what the camera reads.
 * High-res capture + continuous autofocus so the label reads from a comfortable ~15-25cm (no macro).
 *
 * Depends on: serial_gate.js (window.NNWI_SERIAL_GATE), Tesseract.js (window.Tesseract).
 * Usage: NNWI_OPID_GATE.start({ video, canvas, status, readout, candidates, serialInput, onAccept });
 */
(function (root) {
  "use strict";
  var GATE = root.NNWI_SERIAL_GATE;

  function setStatus(el, kind, msg) { if (el) { el.textContent = msg; el.className = "opid-gate-status opid-gate-" + kind; } }

  function start(cfg) {
    var video = cfg.video, canvas = cfg.canvas, status = cfg.status, readout = cfg.readout,
        candEl = cfg.candidates, serialInput = cfg.serialInput, onAccept = cfg.onAccept;
    var stream = null, worker = null, running = false;
    var found = {};       // distinct serial candidates seen so far
    var barcode = ("BarcodeDetector" in root) ? new root.BarcodeDetector() : null;

    function stop() {
      running = false;
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (worker && worker.terminate) { worker.terminate(); worker = null; }
    }
    function accept(serial) {
      if (serialInput) serialInput.value = serial;
      stop();
      setStatus(status, "green", "Captured serial " + serial + ". No photo was stored.");
      if (candEl) candEl.innerHTML = "";
      if (typeof onAccept === "function") onAccept(serial);
    }
    function addCandidate(s, src) {
      if (!s || found[s]) return;
      found[s] = src || "ocr";
      renderCandidates();
    }
    function renderCandidates() {
      if (!candEl) return;
      var keys = Object.keys(found);
      candEl.innerHTML = "";
      if (!keys.length) return;
      var h = document.createElement("div"); h.className = "cand-hint";
      h.textContent = "Tap the SERIAL number:";
      candEl.appendChild(h);
      keys.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "cand-btn";
        b.innerHTML = s + (found[s] === "barcode" ? " <small>(barcode)</small>" : "");
        b.onclick = function () { accept(s); };
        candEl.appendChild(b);
      });
      setStatus(status, "green", "Found " + keys.length + " code" + (keys.length > 1 ? "s" : "") + " — tap the serial below.");
    }

    setStatus(status, "scan", "Hold the label ~15–25 cm away, steady, in good light…");
    if (!root.Tesseract) { setStatus(status, "block", "OCR engine not loaded."); return { stop: stop }; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus(status, "block", "Camera not available — type the serial."); return { stop: stop }; }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false
    }).then(function (s) {
      stream = s; video.srcObject = s; video.setAttribute("playsinline", ""); video.muted = true; video.play();
      try {
        var track = s.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.indexOf("continuous") >= 0)
          track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () {});
      } catch (e) {}
      return Tesseract.createWorker("eng");
    }).then(function (w) { worker = w; running = true; loop(); })
      .catch(function () { setStatus(status, "block", "Camera permission denied — type the serial."); });

    function loop() {
      if (!running) return;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) { return setTimeout(loop, 300); }
      var cw = Math.floor(vw * 0.94), ch = Math.floor(vh * 0.7);
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, Math.floor((vw - cw) / 2), Math.floor((vh - ch) / 2), cw, ch, 0, 0, cw, ch);
      // 1) barcode (most reliable for a serial) — Android/Chrome; ignored where unsupported
      if (barcode) {
        barcode.detect(canvas).then(function (codes) {
          codes.forEach(function (c) { var v = GATE.classifySerial(c.rawValue); if (v.ok) addCandidate(v.serial, "barcode"); });
        }).catch(function () {});
      }
      // 2) OCR the label text and pull out serial-like tokens
      worker.recognize(canvas).then(function (res) {
        var text = (res && res.data && res.data.text) || "";
        ctx.clearRect(0, 0, cw, ch); // discard pixels immediately — nothing kept
        var r = GATE.findSerial(text);
        if (readout) readout.textContent = r.seen ? ("reading: " + r.seen) : "reading: (nothing yet — steady the label)";
        if (r.ok) (r.candidates || [r.serial]).forEach(function (s) { addCandidate(s, "ocr"); });
        else if (!Object.keys(found).length) setStatus(status, "scan", "Looking for a serial number… (" + r.reason + ")");
        if (running) setTimeout(loop, 450);
      }).catch(function () { if (running) setTimeout(loop, 700); });
    }

    return { stop: stop };
  }

  root.NNWI_OPID_GATE = { start: start };
})(typeof window !== "undefined" ? window : globalThis);

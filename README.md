# NNWI Operation-ID — serial-only OCR capture-gate (prototype)

Phase-1 capture gate: the camera captures **only a serial number**. On-device OCR must green-light a
serial before capture is enabled; anything else (a face, document, address, PIN) is a **hard block**.
**No photo is ever stored or transmitted** — frames are OCR'd in memory and discarded.

Open `index.html` (served over HTTPS, e.g. GitHub Pages) on a phone, tap "Scan serial with camera".

- `serial_gate.js` — deterministic serial classifier (unit-tested).
- `opid_ocr_gate.js` — camera + on-device OCR (Tesseract.js) driver.

Test host only. Production integrates into the `nnwi-operation-id` WP plugin with **self-hosted**
Tesseract.js (no CDN).

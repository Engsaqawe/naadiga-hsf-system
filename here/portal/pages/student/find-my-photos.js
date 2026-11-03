/**
 * Find My Photos — portal.
 * Auto-scan, analysis UI, group-photo matching, save to My Photos, Ignore, Redownload.
 */
(function () {
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model';
  // Stricter — reduces false matches (face-api default is ~0.6)
  const MATCH_THRESHOLD = 0.5;
  const MATCH_MARGIN = 0.08; // best face must beat 2nd-best by this in group photos
  const FACE_AUTH_KEY = 'hsf_face_verified';
  const DETECT_MATCH = { inputSize: 608, scoreThreshold: 0.3 };
  const DETECT_SELFIE = { inputSize: 608, scoreThreshold: 0.2 }; // find small/mid-shot faces in uploads
  const DETECT_CAMERA = { inputSize: 416, scoreThreshold: 0.4 };
  const STABLE_FRAMES = 3;
  const MIN_FACE_RATIO = 0.18;
  const MAX_FACE_RATIO = 0.78;
  const MIN_FACE_RATIO_UPLOAD = 0.004; // allow mid-shot / distant faces in uploads
  const MAX_FACE_RATIO_UPLOAD = 0.95;
  const MIN_DET_SCORE = 0.45;
  const MIN_DET_SCORE_UPLOAD = 0.25; // accept softer / slightly blurred faces
  const GUIDE = {
    looking: 'Raadinaya wajigaaga… / Looking for your face…',
    hold: 'Ha dhaqdhaqaaqin… / Hold still…',
    closer: 'Waji kaaga soo dhowaad kamaradda. / Move closer to the camera.',
    farther: 'Waxyar ka fogee. / Move a little farther.',
    center: 'Waji kaaga dhex dhig shaashadda. / Center your face on screen.',
    light: 'Iftiin wanaagsan isticmaal. / Use better light.',
    captured: 'Waa la qabtay! Ha eegin shaashadda — waa la isbarbardhigayaa. / Captured — you can look away.',
    none: 'Waji lama helin. Soo dhowaay ama Upload isticmaal. / No face found.',
    fake: 'Waji dhab ah lama hubin. Iska dhaqaaq oo isku day. / Could not verify a real face — move slightly and try again.',
    uploadNoFace: 'Waji buuxan lama helin — isticmaal sawir waji cad oo hore. / No clear face — use a front-facing selfie.',
    uploadSmall: 'Waji aad u yar — isticmaal sawir uu wajigaagu ku weyn yahay. / Face too small — use a closer selfie.',
    uploadBlur: 'Sawirka waa cadayn — isku day mid iftiin wanaagsan leh. / Photo unclear — try better light.',
  };

  const $ = (id) => document.getElementById(id);

  let modelsReady = false;
  let stream = null;
  let myDescriptor = null;
  let currentMatches = [];
  let previewItem = null;
  let pendingUser = null;
  let pendingPass = '';
  let scanAbort = false;
  let currentEventTitle = '';
  let suppressEventChange = false;
  let matchRunId = 0;
  let lastCommittedMatches = [];
  const LAST_EVENT_KEY = 'hsf_face_last_event';
  const LAST_SCAN_KEY = 'hsf_face_last_scan';

  function apiBase() {
    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5000/api';
    }
    return `${window.location.origin}/api`;
  }

  function absUrl(path) {
    if (!path) return '';
    if (/^https?:/i.test(path)) return path;
    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return `http://127.0.0.1:5000${path}`;
    }
    return `${window.location.origin}${path}`;
  }

  function getPortalUser() {
    return typeof getCurrentUser === 'function' ? getCurrentUser() : {};
  }

  function getFaceAuth() {
    try {
      return JSON.parse(sessionStorage.getItem(FACE_AUTH_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function setFaceAuth(auth) {
    if (!auth) sessionStorage.removeItem(FACE_AUTH_KEY);
    else sessionStorage.setItem(FACE_AUTH_KEY, JSON.stringify(auth));
  }

  function authHeaders(extra = {}) {
    const auth = getFaceAuth();
    const portal = getPortalUser();
    return {
      ...extra,
      'X-Username': (auth?.username || portal.username || '').toLowerCase().trim(),
      'X-Password': (auth?.password || pendingPass || portal.password || '').trim(),
    };
  }

  async function api(path, opts = {}) {
    const headers = authHeaders(opts.headers || {});
    const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setMsg(elId, msg, cls) {
    const el = $(elId);
    if (!el) return;
    el.textContent = msg || '';
    const extra = elId === 'cameraStatus' ? ' center-text' : '';
    el.className = `find-status${extra}${cls ? ` ${cls}` : ''}`;
  }

  function showAnalysis(show, sub) {
    $('faceHero')?.classList.toggle('hidden', show);
    $('cameraPanel')?.classList.add('hidden');
    $('analysisPanel')?.classList.toggle('hidden', !show);
    if (sub) {
      const el = $('analysisSub');
      if (el) el.textContent = sub;
    }
    const hint = $('matchHint');
    if (show && hint) {
      hint.textContent = lastCommittedMatches.length
        ? `Keeping ${lastCommittedMatches.length}…`
        : 'Analyzing…';
    }
    if (!show) {
      const bar = $('analysisBar');
      const pct = $('analysisPct');
      if (bar) bar.style.width = '0%';
      if (pct) pct.textContent = '0%';
      clearCapturedFace();
      // Never blank the matches chip when analysis ends
      if (hint) {
        const n = currentMatches.length || lastCommittedMatches.length;
        hint.textContent = n ? `${n} photo(s)` : 'No matches yet';
      }
      ensureMatchesVisible();
    }
  }

  function setCapturedFace(dataUrl) {
    const img = $('capturedFace');
    const orb = $('analysisOrb');
    if (!img) return;
    if (dataUrl) {
      img.src = dataUrl;
      img.classList.remove('hidden');
      orb?.classList.add('with-capture');
    } else {
      clearCapturedFace();
    }
  }

  function clearCapturedFace() {
    const img = $('capturedFace');
    const orb = $('analysisOrb');
    if (img) {
      img.src = '';
      img.classList.add('hidden');
    }
    orb?.classList.remove('with-capture');
  }

  /** Crop face region from canvas/video-sized frame for preview. */
  function cropFacePreview(sourceCanvas, det) {
    try {
      const box = det?.detection?.box;
      if (!box || !sourceCanvas) return sourceCanvas.toDataURL('image/jpeg', 0.88);
      const pad = Math.max(box.width, box.height) * 0.35;
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      const w = Math.min(sourceCanvas.width - x, box.width + pad * 2);
      const h = Math.min(sourceCanvas.height - y, box.height + pad * 2);
      const out = document.createElement('canvas');
      const size = 240;
      out.width = size;
      out.height = size;
      const ctx = out.getContext('2d');
      ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, size, size);
      return out.toDataURL('image/jpeg', 0.9);
    } catch {
      return sourceCanvas.toDataURL('image/jpeg', 0.88);
    }
  }

  async function facePreviewFromImage(img, det) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return cropFacePreview(canvas, det);
  }

  function dedupeMatches(list) {
    const map = new Map();
    for (const m of list || []) {
      if (!m?.name) continue;
      const key = `${m.event_id || ''}/${m.name}`;
      const prev = map.get(key);
      if (!prev || (m.dist ?? 99) < (prev.dist ?? 99)) {
        map.set(key, m);
      }
    }
    return [...map.values()].sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
  }

  function setAnalysisProgress(done, total) {
    const p = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const bar = $('analysisBar');
    const pct = $('analysisPct');
    if (bar) bar.style.width = `${p}%`;
    if (pct) pct.textContent = `${p}%`;
    const sub = $('analysisSub');
    if (sub && total) sub.textContent = `Matching photos… ${done}/${total}`;
  }

  async function loadModels() {
    if (modelsReady) return;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
  }

  function hideBoot() {
    $('bootCard')?.classList.add('hidden');
  }

  function showAuth() {
    hideBoot();
    $('authCard')?.classList.remove('hidden');
    $('appPanel')?.classList.add('hidden');
    $('loginStep')?.classList.remove('hidden');
    $('otpStep')?.classList.add('hidden');
  }

  function showOtp(emailMasked) {
    hideBoot();
    $('authCard')?.classList.remove('hidden');
    $('loginStep')?.classList.add('hidden');
    $('otpStep')?.classList.remove('hidden');
    const hint = $('otpHint');
    if (hint) {
      hint.textContent = emailMasked
        ? `Enter the code sent to ${emailMasked}.`
        : 'Enter the verification code sent to your registered email.';
    }
  }

  function showApp(opts = {}) {
    const reset = !!opts.reset;
    hideBoot();
    $('authCard')?.classList.add('hidden');
    $('appPanel')?.classList.remove('hidden');
    showAnalysis(false);
    $('faceHero')?.classList.remove('hidden');
    $('cameraPanel')?.classList.add('hidden');
    stopCamera();
    if (reset) {
      myDescriptor = null;
      // Keep sessionStorage — restoreLastScan() will refill after loadEvents
      currentMatches = [];
      lastCommittedMatches = [];
      const results = $('results');
      if (results) results.innerHTML = '';
      const hint = $('matchHint');
      if (hint) hint.textContent = 'No matches yet';
      setMsg('status', 'Choose Scan or Upload when ready.');
    }
  }

  async function loadEvents() {
    const sel = $('eventSelect');
    suppressEventChange = true;
    sel.innerHTML = '<option value="">Loading…</option>';
    const data = await api('/face-photos/events');
    const events = data.events || [];
    if (!events.length) {
      sel.innerHTML = '<option value="">No events yet</option>';
      suppressEventChange = false;
      return;
    }
    sel.innerHTML = events
      .map((e) => `<option value="${e.id}">${e.title} (${e.photo_count} photos)</option>`)
      .join('');
    const last = localStorage.getItem(LAST_EVENT_KEY);
    if (last && [...sel.options].some((o) => o.value === last)) {
      sel.value = last;
    } else {
      sel.value = events[0].id;
    }
    const opt = sel.selectedOptions?.[0];
    currentEventTitle = (opt?.textContent || '').replace(/\s*\(.*$/, '') || sel.value;
    setTimeout(() => {
      suppressEventChange = false;
    }, 0);
    restoreLastScan();
  }

  function rememberEvent() {
    const id = $('eventSelect')?.value;
    if (id) localStorage.setItem(LAST_EVENT_KEY, id);
  }

  function clearScanMatches(opts = {}) {
    currentMatches = [];
    lastCommittedMatches = [];
    renderMatches([]);
    if (opts.persist) persistLastScan([]);
  }

  function persistLastScan(matches) {
    try {
      const eventId = $('eventSelect')?.value || '';
      const list = matches || [];
      sessionStorage.setItem(
        LAST_SCAN_KEY,
        JSON.stringify({
          eventId,
          matches: list.map((m) => ({
            url: m.url,
            dist: m.dist,
            name: m.name,
            downloaded: !!m.downloaded,
            event_id: m.event_id || eventId,
          })),
          at: Date.now(),
        })
      );
    } catch (_) {}
  }

  function restoreLastScan() {
    try {
      const raw = sessionStorage.getItem(LAST_SCAN_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const eventId = $('eventSelect')?.value || '';
      if (!data?.matches?.length) return;
      if (data.eventId && eventId && String(data.eventId) !== String(eventId)) return;
      const list = data.matches.map((m) => ({
        ...m,
        url: absUrl(m.url),
      }));
      commitScanMatches(list, { quiet: true });
      setMsg('status', 'Last scan results kept. Scan again to update.', 'ok');
    } catch (_) {}
  }

  /** Final sticky results — only cleared by a new successful scan or explicit reset. */
  function commitScanMatches(matches, opts = {}) {
    const unique = dedupeMatches(matches);
    lastCommittedMatches = unique.map((m) => ({ ...m }));
    renderMatches(unique);
    persistLastScan(unique);
    // Pin on the DOM so we can detect accidental wipes
    const block = $('matchesBlock');
    if (block) block.dataset.pinnedCount = String(unique.length);
  }

  function ensureMatchesVisible() {
    if ((!currentMatches || !currentMatches.length) && lastCommittedMatches.length) {
      renderMatches(lastCommittedMatches);
    }
  }

  /** If something empties #results, put committed matches back. */
  function watchMatchesStability() {
    const results = $('results');
    if (!results || results._hsfWatching) return;
    results._hsfWatching = true;
    const obs = new MutationObserver(() => {
      if (lastCommittedMatches.length && !results.querySelector('.match-card')) {
        renderMatches(lastCommittedMatches);
      }
    });
    obs.observe(results, { childList: true });
  }

  function stopCamera() {
    scanAbort = true;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const video = $('video');
    if (video) video.srcObject = null;
  }

  function releaseCameraOnly() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const video = $('video');
    if (video) video.srcObject = null;
  }

  /** Quality gate — mode: 'camera' | 'upload' */
  function assessFace(det, frameW, frameH, mode = 'camera') {
    if (!det?.detection || !det?.landmarks || !det?.descriptor) {
      return { ok: false, guide: mode === 'upload' ? GUIDE.uploadNoFace : GUIDE.looking };
    }
    const score = det.detection.score ?? 0;
    const minScore = mode === 'upload' ? MIN_DET_SCORE_UPLOAD : MIN_DET_SCORE;
    if (score < minScore) {
      return { ok: false, guide: mode === 'upload' ? GUIDE.uploadBlur : GUIDE.light };
    }
    const box = det.detection.box;
    const area = (box.width * box.height) / Math.max(1, frameW * frameH);
    const minR = mode === 'upload' ? MIN_FACE_RATIO_UPLOAD : MIN_FACE_RATIO;
    const maxR = mode === 'upload' ? MAX_FACE_RATIO_UPLOAD : MAX_FACE_RATIO;
    if (area < minR) {
      return {
        ok: false,
        guide: mode === 'upload' ? GUIDE.uploadSmall : GUIDE.closer,
        ratio: area,
      };
    }
    if (area > maxR) {
      return {
        ok: false,
        guide: mode === 'upload' ? GUIDE.uploadNoFace : GUIDE.farther,
        ratio: area,
      };
    }
    if (mode === 'camera') {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const offX = Math.abs(cx / frameW - 0.5);
      const offY = Math.abs(cy / frameH - 0.5);
      if (offX > 0.28 || offY > 0.28) return { ok: false, guide: GUIDE.center, ratio: area };
      try {
        const positions = det.landmarks.positions;
        if (positions?.length >= 68) {
          const leftEye = positions[36];
          const rightEye = positions[45];
          const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
          if (eyeDist < box.width * 0.15) {
            return { ok: false, guide: GUIDE.fake, ratio: area };
          }
        }
      } catch (_) {}
    }
    return { ok: true, guide: GUIDE.hold, ratio: area, score };
  }

  /** Prefer largest clear face (ignore tiny/blurred foreground heads). */
  function pickBestFace(detections) {
    if (!detections?.length) return null;
    let best = null;
    let bestScore = -1;
    for (const d of detections) {
      if (!d?.descriptor || !d?.detection) continue;
      const box = d.detection.box;
      const area = Math.max(1, box.width * box.height);
      const score = (d.detection.score ?? 0) * Math.sqrt(area);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  function freezeVideoFrame(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function updateDownloadAllBtn() {
    const btn = $('btnDownloadAll');
    if (!btn) return;
    const n = currentMatches.length;
    btn.classList.toggle('hidden', n < 1);
    btn.disabled = n < 1;
    const label = btn.querySelector('.btn-dl-all-label');
    if (label) label.textContent = n > 1 ? `Download all (${n})` : 'Download photo';
  }

  async function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  }

  function renderMatches(matches) {
    const results = $('results');
    const hint = $('matchHint');
    const block = $('matchesBlock');
    if (!results) return;
    const unique = dedupeMatches(matches);
    currentMatches = unique;
    block?.classList.remove('hidden');
    if (!unique.length) {
      results.innerHTML = '';
      if (hint) hint.textContent = 'No matches yet';
      updateDownloadAllBtn();
      return;
    }
    if (hint) hint.textContent = `${unique.length} photo(s)`;
    results.innerHTML = unique
      .map((m, i) => `
      <figure class="match-card" data-idx="${i}">
        ${m.downloaded ? '<span class="match-tick" title="Downloaded"><i class="fa-solid fa-check"></i></span>' : ''}
        <img src="${m.url}" alt="Match" loading="lazy" onerror="this.classList.add('broken')">
        <div class="match-actions">
          <button type="button" class="match-btn preview btn-preview" data-idx="${i}">Preview</button>
          <button type="button" class="match-btn download btn-dl" data-idx="${i}">${m.downloaded ? 'Redownload' : 'Download'}</button>
        </div>
        <button type="button" class="match-ignore btn-ignore" data-idx="${i}" title="Incorrect match">Ignore</button>
      </figure>`)
      .join('');
    updateDownloadAllBtn();
  }

  function openPreview(item) {
    previewItem = item;
    $('previewImg').src = item.url;
    const label = $('previewDlLabel');
    if (label) label.textContent = item.downloaded ? 'Redownload' : 'Download';
    $('previewModal')?.classList.remove('hidden');
  }

  function closePreview() {
    previewItem = null;
    $('previewModal')?.classList.add('hidden');
    $('previewImg').src = '';
  }

  async function saveMatchesToMyPhotos(matches) {
    if (!matches.length) return;
    const eventId = $('eventSelect')?.value;
    try {
      await api('/face-photos/my-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photos: matches.map((m) => ({
            event_id: eventId,
            name: m.name,
            title: currentEventTitle || eventId,
            dist: m.dist,
            matched_at: new Date().toISOString(),
          })),
        }),
      });
    } catch (e) {
      console.warn('save my photos', e);
    }
  }

  async function ignoreMatch(item, idx) {
    const eventId = $('eventSelect')?.value;
    if (!eventId || !item) return;
    try {
      await api('/face-photos/my-photos/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, name: item.name }),
      });
    } catch (e) {
      console.warn(e);
    }
    currentMatches.splice(idx, 1);
    commitScanMatches(currentMatches);
    setMsg('status', 'Removed from matches.', 'ok');
  }

  async function downloadMatch(item) {
    if (!item) return;
    const eventId = $('eventSelect')?.value || item.event_id;
    if (!eventId) return;
    setMsg('status', 'Preparing download…');
    try {
      await api(
        `/face-photos/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(item.name)}/download`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      item.downloaded = true;
      commitScanMatches(currentMatches);
      if (previewItem === item) {
        const label = $('previewDlLabel');
        if (label) label.textContent = 'Redownload';
      }
    } catch (e) {
      console.warn(e);
    }
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = item.name || 'photo.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = item.name || 'photo.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setMsg('status', 'Download started.', 'ok');
  }

  async function downloadAllMatches() {
    const list = currentMatches.slice();
    if (!list.length) return;
    const btn = $('btnDownloadAll');
    if (btn) btn.disabled = true;
    setMsg('status', `Waa la soo dejinayaa dhammaan… / Downloading all ${list.length}…`);
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      setMsg('status', `Downloading ${i + 1}/${list.length}…`);
      try {
        await downloadMatch(list[i]);
        ok += 1;
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        console.warn(e);
      }
    }
    if (btn) btn.disabled = false;
    updateDownloadAllBtn();
    setMsg('status', `Downloaded ${ok}/${list.length}. / Waa la soo dejiyay.`, 'ok');
  }

  async function findMatches(opts = {}) {
    if (!myDescriptor) return;
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setMsg('status', 'Pick an event first.', 'error');
      showAnalysis(false);
      $('faceHero')?.classList.remove('hidden');
      ensureMatchesVisible();
      return;
    }
    // Use caller's runId if provided (avoids double-increment races)
    const runId = opts.runId != null ? opts.runId : ++matchRunId;
    const previousSnapshot =
      currentMatches.length > 0
        ? currentMatches.slice()
        : lastCommittedMatches.slice();
    rememberEvent();
    const opt = $('eventSelect')?.selectedOptions?.[0];
    currentEventTitle = (opt?.textContent || '').replace(/\s*\(.*$/, '') || eventId;

    if (!$('analysisPanel') || $('analysisPanel').classList.contains('hidden')) {
      showAnalysis(true, 'Waa la isbarbardhigayaa sawirada… / Matching event photos…');
    } else {
      const el = $('analysisSub');
      if (el) el.textContent = 'Waa la isbarbardhigayaa sawirada… / Matching event photos…';
    }
    setMsg('status', GUIDE.captured);
    await loadModels();
    if (runId !== matchRunId) {
      ensureMatchesVisible();
      return;
    }

    let data;
    try {
      data = await api(`/face-photos/events/${encodeURIComponent(eventId)}/photos`);
    } catch (e) {
      showAnalysis(false);
      $('faceHero')?.classList.remove('hidden');
      setMsg('status', e.message || 'Could not load photos.', 'error');
      ensureMatchesVisible();
      return;
    }
    if (runId !== matchRunId) {
      ensureMatchesVisible();
      return;
    }
    const photos = (data.photos || []).filter((p) => !p.ignored);
    if (!photos.length) {
      showAnalysis(false);
      $('faceHero')?.classList.remove('hidden');
      setMsg('status', 'This event has no photos yet.', 'error');
      ensureMatchesVisible();
      return;
    }

    const matches = [];
    let skipped = 0;
    const total = photos.length;
    const detectOpts = new faceapi.TinyFaceDetectorOptions(DETECT_MATCH);
    // Do NOT live-render during the loop — that "flash then empty" feels like a refresh.
    // Keep previous committed results visible the whole time.
    if (previousSnapshot.length) {
      renderMatches(previousSnapshot);
    }

    for (let i = 0; i < photos.length; i++) {
      if (runId !== matchRunId) {
        ensureMatchesVisible();
        return;
      }
      const p = photos[i];
      setAnalysisProgress(i + 1, total);
      const url = absUrl(p.url);
      try {
        const img = await loadImage(url);
        const detections = await faceapi
          .detectAllFaces(img, detectOpts)
          .withFaceLandmarks(true)
          .withFaceDescriptors();
        const dists = [];
        for (const d of detections) {
          const score = d.detection?.score ?? 0;
          if (score < 0.32 || !d.landmarks || !d.descriptor) continue;
          dists.push(faceapi.euclideanDistance(myDescriptor, d.descriptor));
        }
        dists.sort((a, b) => a - b);
        const best = dists[0] ?? Infinity;
        const second = dists[1] ?? Infinity;
        const clearWinner = dists.length < 2 || second - best >= MATCH_MARGIN;
        if (best <= MATCH_THRESHOLD && clearWinner) {
          matches.push({
            url,
            dist: best,
            name: p.name || p.id,
            downloaded: !!p.downloaded,
            event_id: eventId,
          });
        }
      } catch (e) {
        skipped += 1;
        console.warn('skip', p.name, e);
      }
    }

    if (runId !== matchRunId) {
      ensureMatchesVisible();
      return;
    }

    matches.sort((a, b) => a.dist - b.dist);
    const next = dedupeMatches(matches);

    if (matches.length) {
      try {
        await saveMatchesToMyPhotos(matches);
      } catch (_) {}
      // Even if runId changed during save, still commit these results
      setMsg(
        'status',
        `Found ${matches.length} photo(s) this scan. Saved to My Photos.${
          skipped ? ` (${skipped} skipped)` : ''
        }`,
        'ok'
      );
      showAnalysis(false);
      $('faceHero')?.classList.remove('hidden');
      commitScanMatches(next);
      $('matchesBlock')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    setMsg(
      'status',
      skipped === total
        ? 'Could not read event photos. Check your connection and try again.'
        : 'Done — no confident matches this scan. Previous results kept.',
      previousSnapshot.length ? 'ok' : 'error'
    );
    showAnalysis(false);
    $('faceHero')?.classList.remove('hidden');
    if (previousSnapshot.length) {
      commitScanMatches(previousSnapshot);
    } else {
      ensureMatchesVisible();
    }
  }

  async function autoScanAndMatch() {
    scanAbort = false;
    const runId = ++matchRunId;
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setMsg('status', 'Pick an event first.', 'error');
      return;
    }
    if (lastCommittedMatches.length || currentMatches.length) {
      const hint = $('matchHint');
      if (hint) {
        const n = currentMatches.length || lastCommittedMatches.length;
        hint.textContent = `Keeping ${n}…`;
      }
    }
    await loadModels();
    if (runId !== matchRunId) return;
    $('faceHero')?.classList.add('hidden');
    $('analysisPanel')?.classList.add('hidden');
    $('cameraPanel')?.classList.remove('hidden');
    setMsg('cameraStatus', GUIDE.looking);
    setMsg('status', GUIDE.looking);

    const video = $('video');
    try {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      $('cameraPanel')?.classList.add('hidden');
      $('faceHero')?.classList.remove('hidden');
      setMsg('status', e.message || 'Camera blocked', 'error');
      ensureMatchesVisible();
      return;
    }

    let stable = 0;
    let lastDet = null;
    const maxAttempts = 60; // ~12s
    for (let attempt = 0; attempt < maxAttempts && !scanAbort; attempt++) {
      await new Promise((r) => setTimeout(r, 200));
      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(DETECT_CAMERA))
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      const fw = video.videoWidth || 640;
      const fh = video.videoHeight || 480;
      if (!det) {
        stable = 0;
        setMsg('cameraStatus', GUIDE.looking);
        continue;
      }
      const q = assessFace(det, fw, fh);
      setMsg('cameraStatus', q.guide);
      setMsg('status', q.guide);
      try {
        const canvas = $('overlay');
        const dims = faceapi.matchDimensions(canvas, video, true);
        const resized = faceapi.resizeResults(det, dims);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        faceapi.draw.drawDetections(canvas, resized);
      } catch (_) {}
      if (!q.ok) {
        stable = 0;
        lastDet = null;
        continue;
      }
      // Consistency: descriptors must stay close across frames
      if (lastDet?.descriptor) {
        const dist = faceapi.euclideanDistance(lastDet.descriptor, det.descriptor);
        if (dist > 0.35) {
          stable = 1;
          lastDet = det;
          setMsg('cameraStatus', GUIDE.hold);
          continue;
        }
      }
      lastDet = det;
      stable += 1;
      setMsg('cameraStatus', `${GUIDE.hold} (${stable}/${STABLE_FRAMES})`);
      if (stable >= STABLE_FRAMES) break;
    }

    if (scanAbort) {
      releaseCameraOnly();
      $('cameraPanel')?.classList.add('hidden');
      $('faceHero')?.classList.remove('hidden');
      ensureMatchesVisible();
      return;
    }

    if (!lastDet || stable < STABLE_FRAMES) {
      releaseCameraOnly();
      $('cameraPanel')?.classList.add('hidden');
      $('faceHero')?.classList.remove('hidden');
      setMsg('cameraStatus', '');
      setMsg('status', GUIDE.none, 'error');
      ensureMatchesVisible();
      return;
    }

    if (runId !== matchRunId) {
      releaseCameraOnly();
      $('cameraPanel')?.classList.add('hidden');
      $('faceHero')?.classList.remove('hidden');
      ensureMatchesVisible();
      return;
    }

    // Freeze + show face while matching — user can look away
    const frozen = freezeVideoFrame(video);
    const previewUrl = cropFacePreview(frozen, lastDet);
    myDescriptor = lastDet.descriptor;
    setMsg('cameraStatus', GUIDE.captured);
    setMsg('status', GUIDE.captured, 'ok');
    releaseCameraOnly();
    $('cameraPanel')?.classList.add('hidden');
    showAnalysis(true, 'Waa la isbarbardhigayaa… / Reading & matching…');
    setCapturedFace(previewUrl);
    const title = $('analysisTitle');
    if (title) title.textContent = 'Waji waa la qabtay — waa la akhrinayaa…';
    await findMatches({ runId });
  }

  async function matchFromSelfieFile(file) {
    if (!file) return;
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setMsg('status', 'Pick an event first.', 'error');
      return;
    }
    const runId = ++matchRunId;
    showAnalysis(true, 'Akhrinaya sawirkaaga… / Reading your selfie…');
    setMsg('status', '');
    await loadModels();
    if (runId !== matchRunId) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions(DETECT_SELFIE))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
      const det = pickBestFace(detections);
      if (!det) {
        showAnalysis(false);
        $('faceHero')?.classList.remove('hidden');
        setMsg('status', GUIDE.uploadNoFace, 'error');
        ensureMatchesVisible();
        return;
      }
      const q = assessFace(det, img.width || 640, img.height || 480, 'upload');
      if (!q.ok) {
        showAnalysis(false);
        $('faceHero')?.classList.remove('hidden');
        setMsg('status', q.guide, 'error');
        ensureMatchesVisible();
        return;
      }
      if (runId !== matchRunId) {
        ensureMatchesVisible();
        return;
      }
      const previewUrl = await facePreviewFromImage(img, det);
      setCapturedFace(previewUrl);
      const title = $('analysisTitle');
      if (title) title.textContent = 'Waji waa la helay — waa la isbarbardhigayaa…';
      myDescriptor = det.descriptor;
      setMsg('status', GUIDE.captured, 'ok');
      await findMatches({ runId });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function doLogin() {
    const username = ($('loginUser')?.value || '').trim();
    const password = ($('loginPass')?.value || '').trim();
    if (!username || !password) {
      setMsg('loginStatus', 'Enter username and password.', 'error');
      return;
    }
    setMsg('loginStatus', 'Checking credentials…');
    try {
      const res = await fetch(`${apiBase()}/face-photos/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      pendingUser = data.user;
      pendingPass = password;
      showOtp(data.email_masked);
      setMsg('otpStatus', 'Code sent. Check your email.', 'ok');
      setMsg('loginStatus', '');
    } catch (e) {
      setMsg('loginStatus', e.message || 'Login failed', 'error');
    }
  }

  async function doVerifyOtp() {
    const username = ($('loginUser')?.value || pendingUser?.username || '').trim();
    const password = pendingPass || ($('loginPass')?.value || '').trim();
    const otp = ($('otpCode')?.value || '').trim();
    if (!otp) {
      setMsg('otpStatus', 'Enter the verification code.', 'error');
      return;
    }
    setMsg('otpStatus', 'Verifying…');
    try {
      const res = await fetch(`${apiBase()}/face-photos/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setFaceAuth({
        username: username.toLowerCase(),
        password,
        user: data.user,
        verifiedAt: Date.now(),
      });
      showApp({ reset: false });
      myDescriptor = null;
      await loadEvents();
    } catch (e) {
      setMsg('otpStatus', e.message || 'Verification failed', 'error');
    }
  }

  async function doResendOtp() {
    const username = ($('loginUser')?.value || pendingUser?.username || '').trim();
    const password = pendingPass || ($('loginPass')?.value || '').trim();
    try {
      const res = await fetch(`${apiBase()}/face-photos/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Resend failed');
      setMsg('otpStatus', `New code sent to ${data.email_masked || 'your email'}.`, 'ok');
    } catch (e) {
      setMsg('otpStatus', e.message || 'Resend failed', 'error');
    }
  }

  async function enterWithPortalSession(user) {
    if (!user?.username || !user?.password) return false;
    setFaceAuth({
      username: String(user.username).toLowerCase(),
      password: user.password,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        is_media_admin: user.role === 'Media Admin' || user.role === 'Main Leader',
      },
      verifiedAt: Date.now(),
      fromPortal: true,
    });
    try {
      await api('/face-photos/events');
      // Do not wipe persisted last-scan on every page open
      showApp({ reset: false });
      myDescriptor = null;
      await loadEvents();
      return true;
    } catch (e) {
      setFaceAuth(null);
      setMsg('status', e.message || 'Could not load photos.', 'error');
      return false;
    }
  }

  function resolveSidebarRole(role) {
    if (role === 'Main Leader' || role === 'main-leader') return 'Main Leader';
    if (role === 'Media Admin') return 'Media Admin';
    if (role === 'Payment Admin' || role === 'payment-admin' || role === 'payment-leader') return 'Payment Admin';
    if (role === 'Payment Sub Admin' || role === 'Leader' || role === 'convocation-leader') return role;
    return role || 'Student';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const currentUser = getPortalUser();
    if (!currentUser?.id) {
      window.location.href = '../../login.html';
      return;
    }

    Components.init({
      role: resolveSidebarRole(currentUser.role),
      activePage: 'find-photos',
      title: 'Find My Photos',
      userName: currentUser.name,
      userRoleLabel: currentUser.role,
    });

    if (currentUser.username) $('loginUser').value = currentUser.username;
    if (currentUser.password) $('loginPass').value = currentUser.password;

    $('togglePass')?.addEventListener('click', () => {
      const input = $('loginPass');
      const icon = $('togglePass')?.querySelector('i');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      if (icon) {
        icon.classList.toggle('fa-eye', !show);
        icon.classList.toggle('fa-eye-slash', show);
      }
    });

    $('btnLogin')?.addEventListener('click', () => doLogin());
    $('loginPass')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
    $('btnVerifyOtp')?.addEventListener('click', () => doVerifyOtp());
    $('otpCode')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doVerifyOtp();
    });
    $('btnResendOtp')?.addEventListener('click', () => doResendOtp());
    $('btnBackLogin')?.addEventListener('click', () => {
      $('otpStep')?.classList.add('hidden');
      $('loginStep')?.classList.remove('hidden');
    });

    $('btnScan')?.addEventListener('click', () =>
      autoScanAndMatch().catch((e) => {
        showAnalysis(false);
        $('faceHero')?.classList.remove('hidden');
        setMsg('status', e.message || 'Scan failed', 'error');
      })
    );
    $('btnStopCam')?.addEventListener('click', () => {
      stopCamera();
      $('cameraPanel')?.classList.add('hidden');
      $('faceHero')?.classList.remove('hidden');
      setMsg('status', 'Cancelled.');
      ensureMatchesVisible();
    });
    $('btnUploadSelfie')?.addEventListener('click', () => $('selfieFile')?.click());
    $('btnDownloadAll')?.addEventListener('click', () =>
      downloadAllMatches().catch((err) => setMsg('status', err.message, 'error'))
    );
    $('selfieFile')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      matchFromSelfieFile(file).catch((err) => {
        showAnalysis(false);
        $('faceHero')?.classList.remove('hidden');
        setMsg('status', err.message, 'error');
      });
      e.target.value = '';
    });
    $('eventSelect')?.addEventListener('change', () => {
      if (suppressEventChange) return;
      rememberEvent();
      const opt = $('eventSelect')?.selectedOptions?.[0];
      currentEventTitle = (opt?.textContent || '').replace(/\s*\(.*$/, '') || $('eventSelect')?.value;
      // Do NOT auto-rescan (that was wiping the grid). Keep last results for this event if any.
      restoreLastScan();
      if (!currentMatches.length) {
        setMsg('status', 'Event changed — scan or upload for matches. History is in My Photos.');
      } else {
        setMsg('status', 'Showing last results for this event. Scan again to update.', 'ok');
      }
      // Clear face descriptor so we don't silently rematch an old face on a new event
      myDescriptor = null;
    });

    $('results')?.addEventListener('click', (e) => {
      const ignoreBtn = e.target.closest('.btn-ignore');
      if (ignoreBtn) {
        const idx = parseInt(ignoreBtn.dataset.idx, 10);
        if (!Number.isNaN(idx) && currentMatches[idx]) {
          ignoreMatch(currentMatches[idx], idx);
        }
        return;
      }
      const previewBtn = e.target.closest('.btn-preview');
      const dlBtn = e.target.closest('.btn-dl');
      const idx = parseInt((previewBtn || dlBtn)?.dataset?.idx, 10);
      if (Number.isNaN(idx) || !currentMatches[idx]) return;
      e.preventDefault();
      if (dlBtn) downloadMatch(currentMatches[idx]).catch((err) => setMsg('status', err.message, 'error'));
      else if (previewBtn) openPreview(currentMatches[idx]);
    });

    $('previewBackdrop')?.addEventListener('click', closePreview);
    $('previewDownload')?.addEventListener('click', () => {
      downloadMatch(previewItem).catch((err) => setMsg('status', err.message, 'error'));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePreview();
    });
    window.addEventListener('beforeunload', stopCamera);

    if (currentUser.username && currentUser.password) {
      const ok = await enterWithPortalSession(currentUser);
      if (ok) {
        watchMatchesStability();
        return;
      }
    }
    showAuth();
    watchMatchesStability();
  });
})();

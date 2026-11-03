/**
 * Public web Find My Photos — always username/password + email OTP.
 * If already logged into portal, redirect to portal page (no OTP there).
 */
(function () {
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model';
  // Stricter — fewer false matches
  const MATCH_THRESHOLD = 0.5;
  const MATCH_MARGIN = 0.08;
  const FACE_AUTH_KEY = 'hsf_face_verified_web';
  const DETECT_MATCH = { inputSize: 608, scoreThreshold: 0.3 };
  const DETECT_SELFIE = { inputSize: 608, scoreThreshold: 0.2 };
  const DETECT_CAMERA = { inputSize: 416, scoreThreshold: 0.4 };
  const STABLE_FRAMES = 3;
  const MIN_FACE_RATIO = 0.18;
  const MAX_FACE_RATIO = 0.78;
  const MIN_FACE_RATIO_UPLOAD = 0.004;
  const MAX_FACE_RATIO_UPLOAD = 0.95;
  const MIN_DET_SCORE = 0.45;
  const MIN_DET_SCORE_UPLOAD = 0.25;
  const GUIDE = {
    looking: 'Raadinaya wajigaaga… / Looking for your face…',
    hold: 'Ha dhaqdhaqaaqin… / Hold still…',
    closer: 'Waji kaaga soo dhowaad kamaradda. / Move closer.',
    farther: 'Waxyar ka fogee. / Move a little farther.',
    center: 'Waji kaaga dhex dhig shaashadda. / Center your face.',
    light: 'Iftiin wanaagsan isticmaal. / Use better light.',
    captured: 'Waa la qabtay! Ha eegin shaashadda. / Captured — you can look away.',
    none: 'Waji lama helin. Soo dhowaad ama Upload. / No face found.',
    fake: 'Waji dhab ah lama hubin. Iska dhaqaaq. / Could not verify a real face.',
    uploadNoFace: 'Waji buuxan lama helin — isticmaal sawir waji cad. / Use a clear front selfie.',
    uploadSmall: 'Waji aad u yar — isticmaal sawir uu wajigaagu ku weyn yahay. / Face too small.',
    uploadBlur: 'Sawirka waa cadayn — isku day mid iftiin wanaagsan leh. / Try better light.',
  };

  const $ = (id) => document.getElementById(id);

  let modelsReady = false;
  let stream = null;
  let myDescriptor = null;
  let currentMatches = [];
  let previewItem = null;
  let pendingPass = '';
  let scanAbort = false;

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
      return { ok: false, guide: mode === 'upload' ? GUIDE.uploadSmall : GUIDE.closer };
    }
    if (area > maxR) {
      return { ok: false, guide: mode === 'upload' ? GUIDE.uploadNoFace : GUIDE.farther };
    }
    if (mode === 'camera') {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      if (Math.abs(cx / frameW - 0.5) > 0.28 || Math.abs(cy / frameH - 0.5) > 0.28) {
        return { ok: false, guide: GUIDE.center };
      }
    }
    return { ok: true, guide: GUIDE.hold };
  }

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

  function updateDownloadAllBtn() {
    const btn = $('btnDownloadAll');
    if (!btn) return;
    const n = currentMatches.length;
    btn.classList.toggle('hidden', n < 1);
    btn.disabled = n < 1;
    const label = btn.querySelector('.btn-dl-all-label');
    if (label) label.textContent = n > 1 ? `Download all (${n})` : 'Download';
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
    return {
      ...extra,
      'X-Username': (auth?.username || '').toLowerCase().trim(),
      'X-Password': (auth?.password || pendingPass || '').trim(),
    };
  }

  async function api(path, opts = {}) {
    const headers = authHeaders(opts.headers || {});
    const res = await fetch(`${FacePhotosAPI.apiBase()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setMsg(elId, msg, cls) {
    const el = $(elId);
    if (!el) return;
    el.textContent = msg || '';
    el.className = `status${cls ? ` ${cls}` : ''}`;
  }

  async function loadModels() {
    if (modelsReady) return;
    setMsg('status', 'Loading face models…');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
  }

  function showAuth() {
    $('authCard')?.classList.remove('hidden');
    $('appPanel')?.classList.add('hidden');
    $('loginStep')?.classList.remove('hidden');
    $('otpStep')?.classList.add('hidden');
  }
  function showOtp(emailMasked) {
    $('loginStep')?.classList.add('hidden');
    $('otpStep')?.classList.remove('hidden');
    const hint = $('otpHint');
    if (hint) {
      hint.textContent = emailMasked
        ? `Enter the code sent to ${emailMasked}.`
        : 'Enter the verification code sent to your registered email.';
    }
  }
  function showApp() {
    $('authCard')?.classList.add('hidden');
    $('appPanel')?.classList.remove('hidden');
    $('faceHero')?.classList.remove('hidden');
    $('cameraPanel')?.classList.add('hidden');
    stopCamera();
    myDescriptor = null;
    currentMatches = [];
    $('results').innerHTML = '';
    $('matchHint').textContent = 'No matches yet';
    setMsg('status', 'Choose Scan or Upload when ready.');
  }

  async function loadEvents() {
    const sel = $('eventSelect');
    const data = await api('/face-photos/events');
    const events = data.events || [];
    if (!events.length) {
      sel.innerHTML = '<option value="">No events yet</option>';
      return;
    }
    sel.innerHTML = events
      .map((e) => `<option value="${e.id}">${e.title} (${e.photo_count} photos)</option>`)
      .join('');
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const video = $('video');
    if (video) video.srcObject = null;
  }

  async function openCamera() {
    scanAbort = false;
    await loadModels();
    $('faceHero')?.classList.add('hidden');
    $('cameraPanel')?.classList.remove('hidden');
    const video = $('video');
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setMsg('status', GUIDE.looking);

    let stable = 0;
    let lastDet = null;
    for (let attempt = 0; attempt < 60 && !scanAbort; attempt++) {
      await new Promise((r) => setTimeout(r, 200));
      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(DETECT_CAMERA))
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      const fw = video.videoWidth || 640;
      const fh = video.videoHeight || 480;
      if (!det) {
        stable = 0;
        setMsg('status', GUIDE.looking);
        continue;
      }
      const q = assessFace(det, fw, fh);
      setMsg('status', q.guide);
      if (!q.ok) {
        stable = 0;
        lastDet = null;
        continue;
      }
      if (lastDet?.descriptor) {
        const dist = faceapi.euclideanDistance(lastDet.descriptor, det.descriptor);
        if (dist > 0.35) {
          stable = 1;
          lastDet = det;
          continue;
        }
      }
      lastDet = det;
      stable += 1;
      setMsg('status', `${GUIDE.hold} (${stable}/${STABLE_FRAMES})`);
      if (stable >= STABLE_FRAMES) break;
    }

    if (scanAbort) return;

    if (!lastDet || stable < STABLE_FRAMES) {
      stopCamera();
      $('cameraPanel')?.classList.add('hidden');
      $('faceHero')?.classList.remove('hidden');
      setMsg('status', GUIDE.none, 'error');
      return;
    }

    myDescriptor = lastDet.descriptor;
    setMsg('status', GUIDE.captured, 'ok');
    stopCamera();
    $('cameraPanel')?.classList.add('hidden');
    $('faceHero')?.classList.remove('hidden');
    await findMatches();
  }

  function cancelCamera() {
    scanAbort = true;
    stopCamera();
    $('cameraPanel')?.classList.add('hidden');
    $('faceHero')?.classList.remove('hidden');
    setMsg('status', 'Choose Scan or Upload when ready.');
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
    currentMatches = matches;
    const hint = $('matchHint');
    const results = $('results');
    if (!results) return;
    if (!matches.length) {
      results.innerHTML = '';
      if (hint) hint.textContent = 'No matches yet';
      updateDownloadAllBtn();
      return;
    }
    if (hint) hint.textContent = `${matches.length} photo(s)`;
    results.innerHTML = matches
      .map(
        (m, i) => `
      <figure class="match-card" data-idx="${i}">
        ${m.downloaded ? '<span class="match-tick"><i class="fa-solid fa-check"></i></span>' : ''}
        <img src="${m.url}" alt="" loading="lazy">
        <div class="match-actions">
          <button type="button" class="match-btn preview btn-preview" data-idx="${i}">Preview</button>
          <button type="button" class="match-btn download btn-dl" data-idx="${i}">Download</button>
        </div>
      </figure>`
      )
      .join('');
    updateDownloadAllBtn();
    requestAnimationFrame(() => {
      results.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function openPreview(item) {
    previewItem = item;
    $('previewImg').src = item.url;
    $('previewModal')?.classList.remove('hidden');
  }
  function closePreview() {
    previewItem = null;
    $('previewModal')?.classList.add('hidden');
    $('previewImg').src = '';
  }

  async function downloadMatch(item) {
    if (!item) return;
    const eventId = $('eventSelect')?.value;
    if (!eventId) return;
    try {
      await api(
        `/face-photos/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(item.name)}/download`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      item.downloaded = true;
      renderMatches(currentMatches);
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
    setMsg('status', `Waa la soo dejinayaa… / Downloading all ${list.length}…`);
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
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
    setMsg('status', `Downloaded ${ok}/${list.length}.`, 'ok');
  }

  async function findMatches() {
    if (!myDescriptor) return;
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setMsg('status', 'Pick an event first.', 'error');
      return;
    }
    await loadModels();
    setMsg('status', 'Loading event photos…');
    const data = await api(`/face-photos/events/${encodeURIComponent(eventId)}/photos`);
    const photos = data.photos || [];
    if (!photos.length) {
      setMsg('status', 'This event has no photos yet.', 'error');
      renderMatches([]);
      return;
    }
    const matches = [];
    let skipped = 0;
    const detectOpts = new faceapi.TinyFaceDetectorOptions(DETECT_MATCH);
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (i % 2 === 0) setMsg('status', `Matching… ${i + 1}/${photos.length}`);
      const url = FacePhotosAPI.absUrl(p.url);
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
          matches.push({ url, dist: best, name: p.name || p.id, downloaded: !!p.downloaded });
          renderMatches(matches.slice().sort((a, b) => a.dist - b.dist));
        }
      } catch (e) {
        skipped += 1;
        console.warn(e);
      }
    }
    matches.sort((a, b) => a.dist - b.dist);
    renderMatches(matches);
    if (matches.length) {
      setMsg('status', `Found ${matches.length} photo(s).`, 'ok');
    } else {
      setMsg(
        'status',
        skipped === photos.length
          ? 'Could not read event photos. Check your connection and try again.'
          : 'Done — no matches. Try better light or a clearer selfie.',
        'error'
      );
    }
  }

  async function captureFromVideo() {
    await loadModels();
    const video = $('video');
    if (!video?.srcObject) {
      await openCamera();
      return;
    }
    setMsg('status', 'Scanning face…');
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(DETECT_CAMERA))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!det) {
      setMsg('status', 'No face found. Try again.', 'error');
      return;
    }
    myDescriptor = det.descriptor;
    stopCamera();
    $('cameraPanel')?.classList.add('hidden');
    $('faceHero')?.classList.remove('hidden');
    setMsg('status', 'Face captured — searching…', 'ok');
    await findMatches();
  }

  async function matchFromSelfieFile(file) {
    if (!file) return;
    await loadModels();
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions(DETECT_SELFIE))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
      const det = pickBestFace(detections);
      if (!det) {
        setMsg('status', GUIDE.uploadNoFace, 'error');
        return;
      }
      const q = assessFace(det, img.width || 640, img.height || 480, 'upload');
      if (!q.ok) {
        setMsg('status', q.guide, 'error');
        return;
      }
      myDescriptor = det.descriptor;
      setMsg('status', GUIDE.captured, 'ok');
      await findMatches();
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
      const data = await FacePhotosAPI.api('/face-photos/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      pendingPass = password;
      showOtp(data.email_masked);
      setMsg('otpStatus', 'Code sent. Check your email.', 'ok');
      setMsg('loginStatus', '');
    } catch (e) {
      setMsg('loginStatus', e.message || 'Login failed', 'error');
    }
  }

  async function doVerifyOtp() {
    const username = ($('loginUser')?.value || '').trim();
    const password = pendingPass || ($('loginPass')?.value || '').trim();
    const otp = ($('otpCode')?.value || '').trim();
    if (!otp) {
      setMsg('otpStatus', 'Enter the verification code.', 'error');
      return;
    }
    setMsg('otpStatus', 'Verifying…');
    try {
      const data = await FacePhotosAPI.api('/face-photos/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, otp }),
      });
      setFaceAuth({
        username: username.toLowerCase(),
        password,
        user: data.user,
        verifiedAt: Date.now(),
      });
      showApp();
      await loadEvents();
    } catch (e) {
      setMsg('otpStatus', e.message || 'Verification failed', 'error');
    }
  }

  async function doResendOtp() {
    const username = ($('loginUser')?.value || '').trim();
    const password = pendingPass || ($('loginPass')?.value || '').trim();
    try {
      const data = await FacePhotosAPI.api('/face-photos/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      setMsg('otpStatus', `New code sent to ${data.email_masked || 'your email'}.`, 'ok');
    } catch (e) {
      setMsg('otpStatus', e.message || 'Resend failed', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Portal users → no OTP on web; send them to panel page
    try {
      const u = JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
      if (u.id && u.username && u.password) {
        location.replace('../portal/pages/student/find-my-photos.html');
        return;
      }
    } catch (e) {}

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
    $('btnFaceLogout')?.addEventListener('click', () => {
      setFaceAuth(null);
      pendingPass = '';
      stopCamera();
      showAuth();
    });
    $('btnScan')?.addEventListener('click', () =>
      openCamera().catch((e) => setMsg('status', e.message || 'Camera blocked', 'error'))
    );
    $('btnCapture')?.addEventListener('click', () =>
      captureFromVideo().catch((e) => setMsg('status', e.message || 'Scan failed', 'error'))
    );
    $('btnStopCam')?.addEventListener('click', cancelCamera);
    $('btnUploadSelfie')?.addEventListener('click', () => $('selfieFile')?.click());
    $('btnDownloadAll')?.addEventListener('click', () =>
      downloadAllMatches().catch((err) => setMsg('status', err.message, 'error'))
    );
    $('selfieFile')?.addEventListener('change', (e) => {
      matchFromSelfieFile(e.target.files?.[0]).catch((err) => setMsg('status', err.message, 'error'));
      e.target.value = '';
    });
    $('eventSelect')?.addEventListener('change', () => {
      if (myDescriptor) findMatches().catch((e) => setMsg('status', e.message, 'error'));
    });
    $('results')?.addEventListener('click', (e) => {
      const card = e.target.closest('.match-card');
      if (card && window.matchMedia('(hover: none)').matches) card.classList.add('is-touch');
      const previewBtn = e.target.closest('.btn-preview');
      const dlBtn = e.target.closest('.btn-dl');
      const idx = parseInt((previewBtn || dlBtn)?.dataset?.idx, 10);
      if (Number.isNaN(idx) || !currentMatches[idx]) return;
      if (dlBtn) downloadMatch(currentMatches[idx]).catch((err) => setMsg('status', err.message, 'error'));
      else if (previewBtn) openPreview(currentMatches[idx]);
    });
    $('previewClose')?.addEventListener('click', closePreview);
    $('previewCloseBtn')?.addEventListener('click', closePreview);
    $('previewBackdrop')?.addEventListener('click', closePreview);
    $('previewDownload')?.addEventListener('click', () =>
      downloadMatch(previewItem).catch((err) => setMsg('status', err.message, 'error'))
    );
    window.addEventListener('beforeunload', stopCamera);

    const auth = getFaceAuth();
    if (auth?.username && auth?.password && (!auth.verifiedAt || Date.now() - auth.verifiedAt < 4 * 3600 * 1000)) {
      try {
        await api('/face-photos/events');
        showApp();
        await loadEvents();
        return;
      } catch {
        setFaceAuth(null);
      }
    }
    showAuth();
  });
})();

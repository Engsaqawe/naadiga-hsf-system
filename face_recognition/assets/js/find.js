/**
 * Find my photos — member login, camera scan, preview + download.
 * Group photos: detectAllFaces matches any face in the image.
 */
(function () {
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model';
  const MATCH_THRESHOLD = 0.52;

  const $ = (id) => document.getElementById(id);
  const setStatus = (msg, cls) => {
    const el = $('status');
    if (!el) return;
    el.textContent = msg;
    el.className = `status${cls ? ` ${cls}` : ''}`;
  };
  const setLoginStatus = (msg, cls) => {
    const el = $('loginStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = `status${cls ? ` ${cls}` : ''}`;
  };

  let modelsReady = false;
  let stream = null;
  let myDescriptor = null;
  let currentMatches = [];
  let previewItem = null;

  async function loadModels() {
    if (modelsReady) return;
    setStatus('Loading face models…');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
  }

  function showApp(user) {
    $('loginCard')?.classList.add('hidden');
    $('appPanel')?.classList.remove('hidden');
    const chip = $('userChip');
    if (chip) {
      chip.textContent = user?.name || user?.username || 'Member';
      chip.classList.remove('hidden');
    }
    $('btnLogout')?.classList.remove('hidden');
  }

  function showLogin() {
    FacePhotosAPI.clearAuth();
    stopCamera();
    $('loginCard')?.classList.remove('hidden');
    $('appPanel')?.classList.add('hidden');
    $('userChip')?.classList.add('hidden');
    $('btnLogout')?.classList.add('hidden');
    myDescriptor = null;
    currentMatches = [];
  }

  async function loadEvents() {
    const sel = $('eventSelect');
    sel.innerHTML = '<option value="">Loading events…</option>';
    try {
      const data = await FacePhotosAPI.api('/face-photos/events');
      const events = data.events || [];
      if (!events.length) {
        sel.innerHTML = '<option value="">No events yet</option>';
        return;
      }
      sel.innerHTML = events.map((e) =>
        `<option value="${e.id}">${e.title} (${e.photo_count} photos)</option>`
      ).join('');
    } catch (err) {
      sel.innerHTML = '<option value="">Could not load events</option>';
      setStatus(err.message || 'Failed to load events', 'error');
      if (/login|401|invalid/i.test(err.message || '')) showLogin();
    }
  }

  async function startCamera() {
    await loadModels();
    const video = $('video');
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setStatus('Camera on — center your face, then tap Scan.', 'ok');
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const video = $('video');
    if (video) video.srcObject = null;
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
    currentMatches = matches;
    if (!matches.length) {
      results.innerHTML = '';
      if (hint) hint.textContent = 'No matching photos found. Try better light or another angle.';
      return;
    }
    if (hint) hint.textContent = `${matches.length} photo(s) — tap to preview, then download.`;
    results.innerHTML = matches.map((m, i) => `
      <figure class="match-card" data-idx="${i}">
        <img src="${m.url}" alt="Match" loading="lazy">
        <figcaption>
          <button type="button" class="btn btn-outline btn-sm btn-preview" data-idx="${i}">Preview</button>
          <button type="button" class="btn btn-primary btn-sm btn-dl" data-idx="${i}">Download</button>
        </figcaption>
      </figure>
    `).join('');
  }

  function openPreview(item) {
    previewItem = item;
    const modal = $('previewModal');
    const img = $('previewImg');
    if (img) img.src = item.url;
    modal?.classList.remove('hidden');
  }

  function closePreview() {
    previewItem = null;
    $('previewModal')?.classList.add('hidden');
    const img = $('previewImg');
    if (img) img.src = '';
  }

  async function downloadMatch(item) {
    if (!item) return;
    const eventId = $('eventSelect')?.value;
    if (!eventId) return;
    setStatus('Preparing download…');
    try {
      await FacePhotosAPI.api(
        `/face-photos/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(item.name)}/download`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
    } catch (e) {
      console.warn('download record', e);
    }
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name || 'photo.jpg';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('Download started.', 'ok');
  }

  async function findMatches() {
    if (!myDescriptor) return;
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setStatus('Pick an event first.', 'error');
      return;
    }
    await loadModels();
    setStatus('Loading event photos…');
    const data = await FacePhotosAPI.api(`/face-photos/events/${encodeURIComponent(eventId)}/photos`);
    const photos = data.photos || [];
    if (!photos.length) {
      setStatus('This event has no photos yet.', 'error');
      renderMatches([]);
      return;
    }

    const matches = [];
    const total = photos.length;
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (i % 3 === 0 || i === total - 1) setStatus(`Matching… ${i + 1}/${total}`);
      const url = FacePhotosAPI.absUrl(p.url);
      try {
        const img = await loadImage(url);
        const detections = await faceapi
          .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
          .withFaceLandmarks(true)
          .withFaceDescriptors();
        let best = Infinity;
        for (const d of detections) {
          const dist = faceapi.euclideanDistance(myDescriptor, d.descriptor);
          if (dist < best) best = dist;
        }
        if (best <= MATCH_THRESHOLD) {
          matches.push({ url, dist: best, name: p.name || p.id });
        }
      } catch (e) {
        console.warn('skip', p.name, e);
      }
    }
    matches.sort((a, b) => a.dist - b.dist);
    renderMatches(matches);
    setStatus(
      matches.length ? `Found ${matches.length} photo(s).` : 'Done — no matches.',
      matches.length ? 'ok' : 'error'
    );
  }

  async function scanFace() {
    await loadModels();
    const video = $('video');
    if (!video?.srcObject) {
      try {
        await startCamera();
      } catch (e) {
        setStatus(e.message || 'Camera blocked', 'error');
        return;
      }
    }
    setStatus('Scanning face…');
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!det) {
      setStatus('No face found. Face the camera in good light and try again.', 'error');
      myDescriptor = null;
      return;
    }
    myDescriptor = det.descriptor;
    const canvas = $('overlay');
    const dims = faceapi.matchDimensions(canvas, video, true);
    const resized = faceapi.resizeResults(det, dims);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resized);
    setStatus('Face captured — searching photos…', 'ok');
    await findMatches();
  }

  async function doLogin() {
    const username = ($('loginUser')?.value || '').trim();
    const password = ($('loginPass')?.value || '').trim();
    if (!username || !password) {
      setLoginStatus('Enter username and password.', 'error');
      return;
    }
    setLoginStatus('Signing in…');
    try {
      const user = await FacePhotosAPI.login(username, password);
      setLoginStatus('');
      showApp(user);
      await loadEvents();
      startCamera().catch((e) => setStatus(e.message || 'Camera blocked — tap Scan to retry.', 'error'));
    } catch (e) {
      setLoginStatus(e.message || 'Login failed', 'error');
    }
  }

  async function resumeSession() {
    const auth = FacePhotosAPI.getAuth();
    if (!auth?.username || !auth?.password) return false;
    try {
      const data = await FacePhotosAPI.api('/face-photos/events');
      showApp(data.user || auth.user);
      const events = data.events || [];
      const sel = $('eventSelect');
      if (!events.length) {
        sel.innerHTML = '<option value="">No events yet</option>';
      } else {
        sel.innerHTML = events.map((e) =>
          `<option value="${e.id}">${e.title} (${e.photo_count} photos)</option>`
        ).join('');
      }
      startCamera().catch((e) => setStatus(e.message || 'Camera blocked — tap Scan to retry.', 'error'));
      return true;
    } catch {
      showLogin();
      return false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnLogin')?.addEventListener('click', () => doLogin());
    $('loginPass')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
    $('btnLogout')?.addEventListener('click', () => {
      showLogin();
      setLoginStatus('Logged out.');
    });
    $('btnScan')?.addEventListener('click', () => scanFace().catch((e) => setStatus(e.message || 'Scan failed', 'error')));
    $('btnStop')?.addEventListener('click', () => {
      stopCamera();
      setStatus('Camera stopped.');
    });
    $('eventSelect')?.addEventListener('change', () => {
      if (myDescriptor) findMatches().catch((e) => setStatus(e.message, 'error'));
    });

    $('results')?.addEventListener('click', (e) => {
      const previewBtn = e.target.closest('.btn-preview');
      const dlBtn = e.target.closest('.btn-dl');
      const card = e.target.closest('.match-card');
      const idx = parseInt((previewBtn || dlBtn || card)?.dataset?.idx, 10);
      if (Number.isNaN(idx) || !currentMatches[idx]) return;
      if (dlBtn) {
        downloadMatch(currentMatches[idx]).catch((err) => setStatus(err.message, 'error'));
        return;
      }
      openPreview(currentMatches[idx]);
    });

    $('previewClose')?.addEventListener('click', closePreview);
    $('previewCloseBtn')?.addEventListener('click', closePreview);
    $('previewBackdrop')?.addEventListener('click', closePreview);
    $('previewDownload')?.addEventListener('click', () => {
      downloadMatch(previewItem).catch((err) => setStatus(err.message, 'error'));
    });

    window.addEventListener('beforeunload', stopCamera);
    resumeSession();
  });
})();

/**
 * Media Admin UI — login, events, upload/delete photos, download stats.
 */
(function () {
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

  function showApp(user) {
    $('loginCard')?.classList.add('hidden');
    $('appPanel')?.classList.remove('hidden');
    const chip = $('userChip');
    if (chip) {
      chip.textContent = `${user?.name || user?.username} · ${user?.role || 'Media Admin'}`;
      chip.classList.remove('hidden');
    }
    $('btnLogout')?.classList.remove('hidden');
  }

  function showLogin() {
    FacePhotosAPI.clearAuth();
    $('loginCard')?.classList.remove('hidden');
    $('appPanel')?.classList.add('hidden');
    $('userChip')?.classList.add('hidden');
    $('btnLogout')?.classList.add('hidden');
  }

  async function refreshEvents() {
    const sel = $('eventSelect');
    const data = await FacePhotosAPI.api('/face-photos/events');
    if (!data.user?.is_media_admin) {
      throw new Error('Media Admin only. Ask Main Leader to assign the Media Admin role.');
    }
    const events = data.events || [];
    if (!events.length) {
      sel.innerHTML = '<option value="">No events — create one</option>';
      $('photoGrid').innerHTML = '';
      $('downloadStats').innerHTML = '<p class="hint">No data yet.</p>';
      return;
    }
    const prev = sel.value;
    sel.innerHTML = events.map((e) =>
      `<option value="${e.id}">${e.title} (${e.photo_count}) · ${e.downloaders_count || 0} downloaders</option>`
    ).join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    await refreshEventDetails();
  }

  async function refreshEventDetails() {
    const eventId = $('eventSelect')?.value;
    const grid = $('photoGrid');
    const statsEl = $('downloadStats');
    if (!eventId) {
      grid.innerHTML = '';
      statsEl.innerHTML = '<p class="hint">Select an event.</p>';
      return;
    }
    grid.innerHTML = '<p class="hint">Loading photos…</p>';
    try {
      const [photosData, statsData] = await Promise.all([
        FacePhotosAPI.api(`/face-photos/events/${encodeURIComponent(eventId)}/photos`),
        FacePhotosAPI.api(`/face-photos/events/${encodeURIComponent(eventId)}/downloads`),
      ]);
      const photos = photosData.photos || [];
      if (!photos.length) {
        grid.innerHTML = '<p class="hint">No photos in this event.</p>';
      } else {
        grid.innerHTML = photos.map((p) => {
          const url = FacePhotosAPI.absUrl(p.url);
          return `
            <figure class="admin-photo" data-name="${p.name || p.id}">
              <img src="${url}" alt="" loading="lazy">
              <figcaption>
                <button type="button" class="btn btn-danger btn-sm btn-del-photo" data-name="${p.name || p.id}">Delete</button>
              </figcaption>
            </figure>`;
        }).join('');
      }
      const downloaders = statsData.downloaders || [];
      if (!downloaders.length) {
        statsEl.innerHTML = '<p class="hint">Nobody has downloaded from this event yet.</p>';
      } else {
        statsEl.innerHTML = `
          <p class="hint">${statsData.total_downloaders} member(s)</p>
          <ul class="dl-list">
            ${downloaders.map((d) => `
              <li>
                <strong>${d.name || d.username || 'Member'}</strong>
                <span>${d.photo_count} photo(s)</span>
                <span class="muted">${d.last_download_at ? new Date(d.last_download_at).toLocaleString() : ''}</span>
              </li>
            `).join('')}
          </ul>`;
      }
    } catch (err) {
      grid.innerHTML = '';
      statsEl.innerHTML = `<p class="status error">${err.message}</p>`;
    }
  }

  async function createEvent() {
    const title = ($('eventTitle')?.value || '').trim();
    setStatus('Creating event…');
    const data = await FacePhotosAPI.api('/face-photos/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || undefined }),
    });
    setStatus(`Event created: ${data.event?.title || data.event?.id}`, 'ok');
    $('eventTitle').value = '';
    await refreshEvents();
    if (data.event?.id) $('eventSelect').value = data.event.id;
    await refreshEventDetails();
  }

  async function deleteEvent() {
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setStatus('Select an event first.', 'error');
      return;
    }
    if (!confirm('Delete this event and all its photos?')) return;
    setStatus('Deleting event…');
    await FacePhotosAPI.api(`/face-photos/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    setStatus('Event deleted.', 'ok');
    await refreshEvents();
  }

  const UPLOAD_BATCH = 4;
  const MAX_EDGE = 1920;

  function compressImage(file) {
    if (!file?.type?.startsWith('image/') || file.type === 'image/gif') {
      return Promise.resolve(file);
    }
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width: w, height: h } = img;
        const edge = Math.max(w, h);
        if (edge <= MAX_EDGE && file.size < 1.2 * 1024 * 1024) {
          resolve(file);
          return;
        }
        const scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            const base = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
            resolve(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.82
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  async function uploadPhotos() {
    const eventId = $('eventSelect')?.value;
    const files = $('photos')?.files;
    if (!eventId) {
      setStatus('Select or create an event first.', 'error');
      return;
    }
    if (!files?.length) {
      setStatus('Choose photos to upload.', 'error');
      return;
    }
    const list = Array.from(files);
    setStatus(`Preparing ${list.length} photo(s)…`);
    const prepared = [];
    for (const f of list) prepared.push(await compressImage(f));
    let savedTotal = 0;
    const batches = Math.ceil(prepared.length / UPLOAD_BATCH);
    for (let b = 0; b < batches; b++) {
      const slice = prepared.slice(b * UPLOAD_BATCH, (b + 1) * UPLOAD_BATCH);
      const fd = new FormData();
      for (const f of slice) fd.append('photos', f);
      const isLast = b === batches - 1;
      setStatus(`Uploading ${b * UPLOAD_BATCH + 1}–${b * UPLOAD_BATCH + slice.length} of ${prepared.length}…`);
      const res = await fetch(
        `${FacePhotosAPI.apiBase()}/face-photos/events/${encodeURIComponent(eventId)}/upload?notify=${isLast ? '1' : '0'}`,
        { method: 'POST', headers: FacePhotosAPI.authHeaders(), body: fd }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      savedTotal += data.saved || 0;
    }
    setStatus(`Uploaded ${savedTotal} photo(s).`, 'ok');
    $('photos').value = '';
    await refreshEvents();
  }

  async function deletePhoto(name) {
    const eventId = $('eventSelect')?.value;
    if (!eventId || !name) return;
    if (!confirm('Delete this photo?')) return;
    await FacePhotosAPI.api(
      `/face-photos/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    );
    setStatus('Photo deleted.', 'ok');
    await refreshEvents();
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
      if (!user.is_media_admin) {
        FacePhotosAPI.clearAuth();
        setLoginStatus('Media Admin only. Ask Main Leader to assign the Media Admin role.', 'error');
        return;
      }
      setLoginStatus('');
      showApp(user);
      setStatus('Ready.');
      await refreshEvents();
    } catch (e) {
      setLoginStatus(e.message || 'Login failed', 'error');
    }
  }

  async function resumeSession() {
    const auth = FacePhotosAPI.getAuth();
    if (!auth?.username || !auth?.password) return;
    try {
      const data = await FacePhotosAPI.api('/face-photos/events');
      if (!data.user?.is_media_admin) {
        showLogin();
        setLoginStatus('Media Admin only.', 'error');
        return;
      }
      showApp(data.user);
      const events = data.events || [];
      const sel = $('eventSelect');
      if (!events.length) {
        sel.innerHTML = '<option value="">No events — create one</option>';
      } else {
        sel.innerHTML = events.map((e) =>
          `<option value="${e.id}">${e.title} (${e.photo_count}) · ${e.downloaders_count || 0} downloaders</option>`
        ).join('');
        await refreshEventDetails();
      }
    } catch {
      showLogin();
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
    $('btnCreate')?.addEventListener('click', () => createEvent().catch((e) => setStatus(e.message, 'error')));
    $('btnUpload')?.addEventListener('click', () => uploadPhotos().catch((e) => setStatus(e.message, 'error')));
    $('btnDeleteEvent')?.addEventListener('click', () => deleteEvent().catch((e) => setStatus(e.message, 'error')));
    $('btnRefresh')?.addEventListener('click', () => refreshEvents().catch((e) => setStatus(e.message, 'error')));
    $('eventSelect')?.addEventListener('change', () => refreshEventDetails().catch((e) => setStatus(e.message, 'error')));
    $('photoGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-del-photo');
      if (!btn) return;
      deletePhoto(btn.dataset.name).catch((err) => setStatus(err.message, 'error'));
    });
    resumeSession();
  });
})();

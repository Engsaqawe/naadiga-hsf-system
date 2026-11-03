/**
 * Media Admin portal — events, upload/delete, download stats.
 * Auth: portal hsf_current_user (username + password from login).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  let allPhotos = [];

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

  function creds() {
    const u = typeof getCurrentUser === 'function' ? getCurrentUser() : {};
    return {
      username: (u.username || '').toLowerCase().trim(),
      password: (u.password || '').trim(),
    };
  }

  function authHeaders(extra = {}) {
    const { username, password } = creds();
    return {
      ...extra,
      'X-Username': username,
      'X-Password': password,
    };
  }

  async function api(path, opts = {}) {
    const headers = authHeaders(opts.headers || {});
    const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setStatus(msg, cls) {
    const el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = `media-status${cls ? ` ${cls}` : ''}`;
  }

  function toast(msg, type) {
    if (window.Components?.showToast) Components.showToast(msg, type || 'success');
    else setStatus(msg, type === 'error' ? 'error' : 'ok');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function filteredSortedPhotos() {
    const filter = $('photoFilter')?.value || 'all';
    const sort = $('photoSort')?.value || 'newest';
    let list = allPhotos.slice();
    if (filter === 'downloaded') list = list.filter((p) => p.anyone_downloaded);
    else if (filter === 'undownloaded') list = list.filter((p) => !p.anyone_downloaded);

    list.sort((a, b) => {
      if (sort === 'oldest') {
        return (a.uploaded_at || '').localeCompare(b.uploaded_at || '');
      }
      if (sort === 'most_downloaded') {
        return (b.download_count || 0) - (a.download_count || 0);
      }
      if (sort === 'name') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      return (b.uploaded_at || '').localeCompare(a.uploaded_at || '');
    });
    return list;
  }

  function renderPhotoGrid() {
    const grid = $('photoGrid');
    if (!grid) return;
    const list = filteredSortedPhotos();
    const dlCount = allPhotos.filter((p) => p.anyone_downloaded).length;
    $('photoCount').textContent =
      `${allPhotos.length} photo${allPhotos.length === 1 ? '' : 's'}` +
      (dlCount ? ` · ${dlCount} downloaded` : '');

    if (!allPhotos.length) {
      grid.innerHTML = '<p class="media-empty">No photos in this event. Use Upload to add some.</p>';
      return;
    }
    if (!list.length) {
      grid.innerHTML = '<p class="media-empty">No photos match this filter.</p>';
      return;
    }
    grid.innerHTML = list
      .map((p) => {
        const name = p.name || p.id;
        const url = absUrl(p.url);
        const blurred = !!p.anyone_downloaded;
        const badge = blurred
          ? `<span class="media-dl-badge">${p.download_count || 1}× downloaded</span>`
          : '';
        return `
            <figure class="media-photo${blurred ? ' is-downloaded' : ''}" data-name="${escapeHtml(name)}">
              <img src="${url}" alt="" loading="lazy">
              ${badge}
              <div class="media-photo-actions">
                <button type="button" class="media-icon-btn view btn-preview-photo" data-url="${escapeHtml(url)}" title="Preview">
                  <i class="fa-solid fa-eye"></i> Preview
                </button>
                <button type="button" class="media-icon-btn delete btn-del-photo" data-name="${escapeHtml(name)}" title="Delete">
                  <i class="fa-solid fa-trash"></i> Delete
                </button>
              </div>
            </figure>`;
      })
      .join('');
  }

  async function refreshEvents() {
    const sel = $('eventSelect');
    const data = await api('/face-photos/events');
    if (!data.user?.is_media_admin) {
      throw new Error('Media Admin or Main Leader only.');
    }
    const events = data.events || [];
    if (!events.length) {
      sel.innerHTML = '<option value="">No events — create one</option>';
      allPhotos = [];
      renderPhotoGrid();
      $('downloaderCount').textContent = '0 members';
      $('downloadBody').innerHTML =
        '<tr><td colspan="4" class="media-empty-cell">Create an event and upload photos first.</td></tr>';
      return;
    }
    const prev = sel.value;
    sel.innerHTML = events
      .map(
        (e) =>
          `<option value="${e.id}">${escapeHtml(e.title)} (${e.photo_count}) · ${e.downloaders_count || 0} downloaders</option>`
      )
      .join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    await refreshEventDetails();
  }

  async function refreshEventDetails() {
    const eventId = $('eventSelect')?.value;
    const grid = $('photoGrid');
    if (!eventId) {
      allPhotos = [];
      grid.innerHTML = '<p class="media-empty">Select an event to view photos.</p>';
      return;
    }
    grid.innerHTML = '<p class="media-empty">Loading…</p>';
    const [photosData, statsData] = await Promise.all([
      api(`/face-photos/events/${encodeURIComponent(eventId)}/photos`),
      api(`/face-photos/events/${encodeURIComponent(eventId)}/downloads`),
    ]);
    allPhotos = photosData.photos || [];
    renderPhotoGrid();

    const downloaders = statsData.downloaders || [];
    $('downloaderCount').textContent =
      `${downloaders.length} member${downloaders.length === 1 ? '' : 's'}`;
    const body = $('downloadBody');
    if (!downloaders.length) {
      body.innerHTML =
        '<tr><td colspan="4" class="media-empty-cell">Nobody has downloaded from this event yet.</td></tr>';
    } else {
      body.innerHTML = downloaders
        .map((d) => {
          const count = d.photo_count || (d.photos || []).length || 0;
          return `
        <tr>
          <td>${escapeHtml(d.name || 'Member')}</td>
          <td>${escapeHtml(d.username || '—')}</td>
          <td class="dl-photos-cell"><span class="dl-photo-count">${count}</span></td>
          <td>${d.last_download_at ? new Date(d.last_download_at).toLocaleString() : '—'}</td>
        </tr>`;
        })
        .join('');
    }
  }

  async function createEvent() {
    const title = ($('eventTitle')?.value || '').trim();
    setStatus('Creating event…');
    const data = await api('/face-photos/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || undefined }),
    });
    $('eventTitle').value = '';
    toast(`Event created: ${data.event?.title || data.event?.id}`);
    setStatus('Event created.', 'ok');
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
    await api(`/face-photos/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    toast('Event deleted.', 'success');
    setStatus('Event deleted.', 'ok');
    await refreshEvents();
  }

  async function eraseAllPhotos() {
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setStatus('Select an event first.', 'error');
      return;
    }
    if (!allPhotos.length) {
      setStatus('No photos to erase.', 'error');
      return;
    }
    if (!confirm(`Erase all ${allPhotos.length} photo(s) in this event? This cannot be undone.`)) return;
    setStatus('Erasing all photos…');
    const data = await api(`/face-photos/events/${encodeURIComponent(eventId)}/photos`, {
      method: 'DELETE',
    });
    toast(`Erased ${data.removed || 0} photo(s).`);
    setStatus(`Erased ${data.removed || 0} photo(s).`, 'ok');
    await refreshEvents();
  }

  async function deleteDownloadedPhotos() {
    const eventId = $('eventSelect')?.value;
    if (!eventId) {
      setStatus('Select an event first.', 'error');
      return;
    }
    const dlCount = allPhotos.filter((p) => p.anyone_downloaded).length;
    if (!dlCount) {
      setStatus('No downloaded photos to delete.', 'error');
      return;
    }
    if (
      !confirm(
        `Delete ${dlCount} photo(s) that members already downloaded?\n\n` +
          '• Files are removed from the server (frees disk)\n' +
          '• Who downloaded history stays\n' +
          '• Photos leave members’ My Photos\n' +
          '• Those members get an email notice'
      )
    ) {
      return;
    }
    setStatus('Deleting downloaded photos…');
    const data = await api(`/face-photos/events/${encodeURIComponent(eventId)}/downloads`, {
      method: 'DELETE',
    });
    toast(`Deleted ${data.removed || 0} downloaded photo(s).`);
    setStatus(
      `Deleted ${data.removed || 0} photo(s)` +
        (data.notified ? ` · notified ${data.notified} member(s)` : '') +
        '. History kept.',
      'ok'
    );
    await refreshEvents();
  }

  const UPLOAD_BATCH = 4;
  const MAX_EDGE = 1920;
  const JPEG_Q = 0.82;

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
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
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
          JPEG_Q
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
    const btn = $('btnUpload');
    if (btn && Components.setLoading) Components.setLoading(btn, true);
    const label = $('fileLabel');
    let savedTotal = 0;
    try {
      setStatus(`Preparing ${list.length} photo(s)…`);
      if (label) label.textContent = `Preparing ${list.length} file(s)…`;
      const prepared = [];
      for (let i = 0; i < list.length; i++) {
        prepared.push(await compressImage(list[i]));
        if (label) label.textContent = `Prepared ${i + 1}/${list.length}…`;
      }
      const batches = Math.ceil(prepared.length / UPLOAD_BATCH);
      for (let b = 0; b < batches; b++) {
        const slice = prepared.slice(b * UPLOAD_BATCH, (b + 1) * UPLOAD_BATCH);
        const fd = new FormData();
        for (const f of slice) fd.append('photos', f);
        const isLast = b === batches - 1;
        setStatus(`Uploading ${b * UPLOAD_BATCH + 1}–${b * UPLOAD_BATCH + slice.length} of ${prepared.length}…`);
        if (label) {
          label.textContent = `Uploading batch ${b + 1}/${batches}…`;
        }
        const res = await fetch(
          `${apiBase()}/face-photos/events/${encodeURIComponent(eventId)}/upload?notify=${isLast ? '1' : '0'}`,
          { method: 'POST', headers: authHeaders(), body: fd }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        savedTotal += data.saved || 0;
      }
      toast(`Uploaded ${savedTotal} photo(s).`);
      setStatus(`Uploaded ${savedTotal} photo(s).`, 'ok');
      $('photos').value = '';
      if (label) label.textContent = 'Ready to upload';
      await refreshEvents();
    } finally {
      if (btn && Components.setLoading) Components.setLoading(btn, false);
    }
  }

  async function deletePhoto(name) {
    const eventId = $('eventSelect')?.value;
    if (!eventId || !name) return;
    if (!confirm('Delete this photo?')) return;
    await api(
      `/face-photos/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    );
    toast('Photo deleted.');
    setStatus('Photo deleted.', 'ok');
    await refreshEvents();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const currentUser = getCurrentUser();
    if (!currentUser?.id) {
      window.location.href = '../../login.html';
      return;
    }
    const role = currentUser.role;
    if (role !== 'Media Admin' && role !== 'Main Leader') {
      Components.showToast?.('Media Admin access only.', 'error');
      window.location.href = '../../login.html';
      return;
    }
    if (!currentUser.username || !currentUser.password) {
      Components.showToast?.(
        'Please log out and log in again so Media can authenticate.',
        'error'
      );
    }

    Components.init({
      role: role === 'Main Leader' ? 'Main Leader' : 'Media Admin',
      activePage: role === 'Main Leader' ? 'media' : 'dashboard',
      title: 'Media Gallery',
      userName: currentUser.name,
      userRoleLabel: currentUser.role,
    });

    $('btnCreate')?.addEventListener('click', () =>
      createEvent().catch((e) => {
        setStatus(e.message, 'error');
        toast(e.message, 'error');
      })
    );
    $('btnUpload')?.addEventListener('click', () => $('photos')?.click());
    $('photos')?.addEventListener('change', () => {
      const files = $('photos')?.files;
      const label = $('fileLabel');
      if (label) {
        label.textContent = files?.length ? `${files.length} file(s) selected — uploading…` : 'Ready to upload';
      }
      if (files?.length) {
        uploadPhotos().catch((e) => {
          setStatus(e.message, 'error');
          toast(e.message, 'error');
        });
      }
    });
    const zone = $('uploadZone');
    if (zone) {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const input = $('photos');
        if (!input || !e.dataTransfer?.files?.length) return;
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
      });
    }
    $('btnDeleteEvent')?.addEventListener('click', () =>
      deleteEvent().catch((e) => {
        setStatus(e.message, 'error');
        toast(e.message, 'error');
      })
    );
    $('btnEraseAll')?.addEventListener('click', () =>
      eraseAllPhotos().catch((e) => {
        setStatus(e.message, 'error');
        toast(e.message, 'error');
      })
    );
    $('btnClearDownloads')?.addEventListener('click', () =>
      deleteDownloadedPhotos().catch((e) => {
        setStatus(e.message, 'error');
        toast(e.message, 'error');
      })
    );
    $('btnRefresh')?.addEventListener('click', () =>
      refreshEvents().catch((e) => {
        setStatus(e.message, 'error');
        toast(e.message, 'error');
      })
    );
    $('eventSelect')?.addEventListener('change', () =>
      refreshEventDetails().catch((e) => setStatus(e.message, 'error'))
    );
    $('photoFilter')?.addEventListener('change', () => renderPhotoGrid());
    $('photoSort')?.addEventListener('change', () => renderPhotoGrid());
    $('photoGrid')?.addEventListener('click', (e) => {
      const preview = e.target.closest('.btn-preview-photo');
      if (preview) {
        const url = preview.dataset.url;
        const img = $('mediaPreviewImg');
        if (img) img.src = url;
        $('mediaPreviewModal')?.classList.remove('hidden');
        return;
      }
      const btn = e.target.closest('.btn-del-photo');
      if (!btn) return;
      deletePhoto(btn.dataset.name).catch((err) => {
        setStatus(err.message, 'error');
        toast(err.message, 'error');
      });
    });
    $('downloadBody')?.addEventListener('click', (e) => {
      const preview = e.target.closest('.btn-preview-photo');
      if (!preview) return;
      const url = preview.dataset.url;
      const img = $('mediaPreviewImg');
      if (img) img.src = url;
      $('mediaPreviewModal')?.classList.remove('hidden');
    });
    const closePreview = () => {
      $('mediaPreviewModal')?.classList.add('hidden');
      const img = $('mediaPreviewImg');
      if (img) img.src = '';
    };
    $('mediaPreviewCloseBtn')?.addEventListener('click', closePreview);
    $('mediaPreviewBackdrop')?.addEventListener('click', closePreview);

    try {
      await refreshEvents();
      setStatus('Ready.');
    } catch (e) {
      setStatus(e.message, 'error');
      toast(e.message, 'error');
    }
  });
})();

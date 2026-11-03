/**
 * My Photos — saved face matches for the logged-in member.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let photos = [];
  let previewItem = null;

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

  function authHeaders(extra = {}) {
    const u = getCurrentUser() || {};
    return {
      ...extra,
      'X-Username': (u.username || '').toLowerCase().trim(),
      'X-Password': (u.password || '').trim(),
    };
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${apiBase()}${path}`, {
      ...opts,
      headers: authHeaders(opts.headers || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setStatus(msg, cls) {
    const el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = `find-status${cls ? ` ${cls}` : ''}`;
  }

  function resolveSidebarRole(role) {
    if (role === 'Main Leader' || role === 'main-leader') return 'Main Leader';
    if (role === 'Media Admin') return 'Media Admin';
    if (role === 'Payment Admin' || role === 'payment-admin' || role === 'payment-leader') return 'Payment Admin';
    if (role === 'Payment Sub Admin' || role === 'Leader' || role === 'convocation-leader') return role;
    return role || 'Student';
  }

  function render() {
    const grid = $('results');
    $('photoCount').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
    if (!photos.length) {
      grid.innerHTML = '<p class="find-lead">No saved matches yet. Use Find My Photos to scan or upload.</p>';
      return;
    }
    grid.innerHTML = photos
      .map((p, i) => {
        const url = absUrl(p.url);
        return `
        <figure class="match-card" data-idx="${i}">
          ${p.downloaded ? '<span class="match-tick"><i class="fa-solid fa-check"></i></span>' : ''}
          <img src="${url}" alt="" loading="lazy">
          <div class="match-actions">
            <button type="button" class="match-btn preview btn-preview" data-idx="${i}">Preview</button>
            <button type="button" class="match-btn download btn-dl" data-idx="${i}">${p.downloaded ? 'Redownload' : 'Download'}</button>
          </div>
          <button type="button" class="match-ignore btn-ignore" data-idx="${i}">Ignore</button>
        </figure>`;
      })
      .join('');
  }

  function openPreview(item) {
    previewItem = item;
    $('previewImg').src = absUrl(item.url);
    $('previewDlLabel').textContent = item.downloaded ? 'Redownload' : 'Download';
    $('previewModal')?.classList.remove('hidden');
  }

  function closePreview() {
    previewItem = null;
    $('previewModal')?.classList.add('hidden');
    $('previewImg').src = '';
  }

  async function downloadItem(item) {
    try {
      await api(
        `/face-photos/events/${encodeURIComponent(item.event_id)}/photos/${encodeURIComponent(item.name)}/download`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      item.downloaded = true;
      render();
      if (previewItem === item) $('previewDlLabel').textContent = 'Redownload';
    } catch (e) {
      console.warn(e);
    }
    const url = absUrl(item.url);
    try {
      const res = await fetch(url);
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
      window.open(url, '_blank');
    }
    setStatus('Download started.', 'ok');
  }

  async function ignoreItem(item, idx) {
    await api('/face-photos/my-photos/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: item.event_id, name: item.name }),
    });
    photos.splice(idx, 1);
    render();
    setStatus('Removed.', 'ok');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const currentUser = getCurrentUser();
    if (!currentUser?.id) {
      window.location.href = '../../login.html';
      return;
    }
    if (!currentUser.username || !currentUser.password) {
      setStatus('Please log out and log in again.', 'error');
    }

    Components.init({
      role: resolveSidebarRole(currentUser.role),
      activePage: 'my-photos',
      title: 'My Photos',
      userName: currentUser.name,
      userRoleLabel: currentUser.role,
    });

    $('results')?.addEventListener('click', (e) => {
      const ignoreBtn = e.target.closest('.btn-ignore');
      if (ignoreBtn) {
        const idx = parseInt(ignoreBtn.dataset.idx, 10);
        if (!Number.isNaN(idx) && photos[idx]) {
          ignoreItem(photos[idx], idx).catch((err) => setStatus(err.message, 'error'));
        }
        return;
      }
      const previewBtn = e.target.closest('.btn-preview');
      const dlBtn = e.target.closest('.btn-dl');
      const idx = parseInt((previewBtn || dlBtn)?.dataset?.idx, 10);
      if (Number.isNaN(idx) || !photos[idx]) return;
      if (dlBtn) downloadItem(photos[idx]).catch((err) => setStatus(err.message, 'error'));
      else if (previewBtn) openPreview(photos[idx]);
    });

    $('previewBackdrop')?.addEventListener('click', closePreview);
    $('previewDownload')?.addEventListener('click', () => {
      if (previewItem) downloadItem(previewItem).catch((err) => setStatus(err.message, 'error'));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePreview();
    });

    try {
      const data = await api('/face-photos/my-photos');
      photos = (data.photos || []).map((p) => ({ ...p, url: absUrl(p.url) }));
      render();
    } catch (e) {
      setStatus(e.message, 'error');
    }
  });
})();

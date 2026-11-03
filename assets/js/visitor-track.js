/**
 * Homepage visit counter — one count per browser per calendar day.
 * Counts on localhost and production; skips visits opened from the admin panel.
 */
(function (global) {
  const STORAGE_PREFIX = 'hsf_homepage_visit_';

  function apiBase() {
    if (typeof global.API_BASE_URL === 'string' && global.API_BASE_URL) {
      return global.API_BASE_URL.replace(/\/$/, '');
    }
    const host = global.location?.hostname || '';
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5000';
    }
    return (global.location && global.location.origin) ? global.location.origin.replace(/\/$/, '') : '';
  }

  function isAdminReferrer() {
    const ref = (global.document?.referrer || '').toLowerCase();
    return (
      ref.includes('admin.html')
      || ref.includes('/admin')
      || ref.includes('\\admin')
    );
  }

  function todayStorageKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${STORAGE_PREFIX}${y}-${m}-${day}`;
  }

  function trackHomepageVisitIfNeeded() {
    if (isAdminReferrer()) {
      return;
    }
    const key = todayStorageKey();
    if (global.localStorage?.getItem(key) === '1') {
      return;
    }
    const base = apiBase();
    if (!base) {
      return;
    }
    fetch(`${base}/api/public/track-visitor`, { method: 'POST', credentials: 'omit' })
      .then((res) => {
        if (res.ok) {
          global.localStorage?.setItem(key, '1');
        }
      })
      .catch(() => {});
  }

  global.HSFTrackHomepageVisit = trackHomepageVisitIfNeeded;
})(typeof window !== 'undefined' ? window : globalThis);

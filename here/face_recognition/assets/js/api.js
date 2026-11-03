/**
 * Shared API helpers for face_recognition app (member / Media Admin auth).
 */
(function (global) {
  const AUTH_KEY = 'hsf_face_auth';

  function apiBase() {
    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5000/api';
    }
    if (window.location.port === '5000' || window.location.pathname.includes('/face_recognition')) {
      return `${window.location.origin}/api`;
    }
    return '/api';
  }

  function getAuth() {
    try {
      return JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function setAuth(auth) {
    if (!auth) {
      sessionStorage.removeItem(AUTH_KEY);
      return;
    }
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  }

  function clearAuth() {
    sessionStorage.removeItem(AUTH_KEY);
  }

  function authHeaders(extra = {}) {
    const auth = getAuth();
    const headers = { ...extra };
    if (auth?.username && auth?.password) {
      headers['X-Username'] = auth.username;
      headers['X-Password'] = auth.password;
    }
    return headers;
  }

  async function api(path, opts = {}) {
    const headers = authHeaders(opts.headers || {});
    const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function login(username, password) {
    const data = await api('/face-photos/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setAuth({
      username: username.toLowerCase().trim(),
      password,
      user: data.user,
    });
    return data.user;
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

  global.FacePhotosAPI = {
    apiBase,
    api,
    absUrl,
    login,
    getAuth,
    setAuth,
    clearAuth,
    authHeaders,
  };
})(window);

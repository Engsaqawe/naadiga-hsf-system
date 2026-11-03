/**
 * API base URL — local Live Server, phone on LAN, or production (Namecheap).
 */
(function (global) {
  const API_PORT = '5000';

  function isLoopbackHost(host) {
    return !host || /^localhost$|^127\.0\.0\.1$/i.test(host);
  }

  /** Private LAN IPs used for phone/local testing against Flask :5000 */
  function isPrivateLanHost(host) {
    return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host || '');
  }

  function resolveApiBaseUrl() {
    const host = window.location.hostname || '';
    const port = window.location.port || '';

    // Flask serving the site itself on :5000
    if (port === API_PORT) {
      return window.location.origin.replace(/\/$/, '');
    }

    // Live Server / local browser → backend on 127.0.0.1:5000
    if (isLoopbackHost(host)) {
      return `http://127.0.0.1:${API_PORT}`;
    }

    // Phone/tablet on same Wi‑Fi → computer LAN IP:5000
    if (isPrivateLanHost(host)) {
      const proto = window.location.protocol || 'http:';
      return `${proto}//${host}:${API_PORT}`;
    }

    // Production (Namecheap, etc.): same origin, no :5000
    return window.location.origin.replace(/\/$/, '');
  }

  function resolveApiRoot() {
    return `${resolveApiBaseUrl()}/api`;
  }

  global.resolveApiBaseUrl = resolveApiBaseUrl;
  global.resolveApiRoot = resolveApiRoot;
  global.API_BASE_URL = resolveApiBaseUrl();
  global.API_BASE = resolveApiRoot();
})(typeof window !== 'undefined' ? window : globalThis);

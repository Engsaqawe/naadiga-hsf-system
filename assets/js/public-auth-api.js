function getPublicApiBase() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:5000/api'
    : `${window.location.origin}/api`;
}

async function publicAuthFetch(path, options = {}) {
  const res = await fetch(`${getPublicApiBase()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  return res.json().catch(() => ({}));
}

(function () {
  const API = (() => {
    if (typeof PUBLIC_API_BASE !== 'undefined' && PUBLIC_API_BASE) return PUBLIC_API_BASE;
    if (typeof resolveApiBaseUrl === 'function') {
      return `${resolveApiBaseUrl()}/api/public`;
    }
    if (typeof API_BASE_URL === 'string' && API_BASE_URL) {
      return `${API_BASE_URL.replace(/\/$/, '')}/api/public`;
    }
    const host = window.location.hostname || '';
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5000/api/public';
    }
    return `${window.location.origin}/api/public`;
  })();

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function attrEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function photoSrc(url) {
    const u = (url || '').trim();
    if (!u) return 'portal/img/logo.svg';
    if (/^https?:\/\//i.test(u) || u.startsWith('/')) return u;
    return encodeURI(u);
  }

  function ensureCarouselStructure() {
    let section = document.querySelector('.team-carousel-section');
    if (!section) return null;

    let ring = document.getElementById('teamCarouselRing');
    if (!ring) {
      section.innerHTML = `
        <div class="team-carousel-wrap">
          <div class="team-carousel-stage">
            <div class="team-carousel-ring" id="teamCarouselRing" aria-hidden="true"></div>
          </div>
        </div>`;
      ring = document.getElementById('teamCarouselRing');
    }
    return ring;
  }

  function buildCarousel(members) {
    const section = document.querySelector('.team-carousel-section');
    if (!section) return;

    if (!members.length) {
      section.innerHTML = '<div class="team-carousel-wrap"><p class="team-carousel-empty">Team photos will appear here once added in admin or placed in <code>assets/team/</code>.</p></div>';
      return;
    }

    const ring = ensureCarouselStructure();
    if (!ring) return;

    const n = members.length;
    const radius = Math.max(280, Math.min(480, n * 46));
    const duration = Math.max(18, n * 3.5);
    ring.style.setProperty('--team-spin-duration', `${duration}s`);
    ring.style.animation = 'none';
    void ring.offsetHeight;
    ring.style.animation = '';

    ring.innerHTML = members.map((m, i) => {
      const angle = (360 / n) * i;
      return `
        <div class="team-carousel-item" style="transform: rotateY(${angle}deg) translateZ(${radius}px);">
          <img src="${attrEsc(photoSrc(m.photo_url))}" alt="${esc(m.name)}" loading="lazy" decoding="async">
        </div>
      `;
    }).join('');
  }

  function buildGrid(members) {
    const grid = document.getElementById('teamGrid');
    const countEl = document.getElementById('teamCount');
    if (!grid) return;

    if (countEl) {
      countEl.textContent = members.length
        ? `${members.length} team member${members.length === 1 ? '' : 's'}`
        : 'No members yet';
    }

    if (!members.length) {
      grid.innerHTML = '<p class="team-empty">Add team members in <strong>HSF SYSTEM → Team</strong>, or upload photos to <code>assets/team/</code>.</p>';
      return;
    }

    grid.innerHTML = members.map((m) => {
      const src = attrEsc(photoSrc(m.photo_url));
      return `
      <article class="team-card" role="listitem">
        <div class="team-card-photo">
          <img class="team-card-img-thumb" src="${src}" alt="" loading="lazy" decoding="async" aria-hidden="true">
          <img class="team-card-img-full" src="${src}" alt="${esc(m.name)}" loading="lazy" decoding="async">
        </div>
        <div class="team-card-body">
          <h3 class="team-card-name">${esc(m.name)}</h3>
          <p class="team-card-title">${esc(m.title || 'Team member')}</p>
        </div>
      </article>
    `;
    }).join('');
  }

  async function loadTeam() {
    try {
      const res = await fetch(`${API}/site-team`);
      if (!res.ok) throw new Error('API error');
      const members = await res.json();
      const list = Array.isArray(members) ? members : [];
      buildCarousel(list);
      buildGrid(list);
    } catch (e) {
      console.error('Team load failed', e);
      buildCarousel([]);
      const grid = document.getElementById('teamGrid');
      if (grid) grid.innerHTML = '<p class="team-empty">Could not load team. Is the backend running?</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', loadTeam);
})();

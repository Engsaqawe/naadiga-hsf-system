const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000'
  : window.location.origin;

const BOOKS_API = `${API_BASE}/api/books`;

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatViews(n) {
  return (n || 0).toLocaleString();
}

function mediaSrc(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function setHeroBackground(hero, bgEl, heroUrl) {
  const imgEl = document.getElementById('booksHeroImg');
  if (!hero || !bgEl || !heroUrl) return;
  hero.classList.add('has-custom-image');
  if (imgEl) {
    imgEl.hidden = false;
    imgEl.removeAttribute('hidden');
    imgEl.src = heroUrl;
    imgEl.alt = '';
    bgEl.style.backgroundImage = '';
  } else {
    bgEl.style.backgroundImage = `url('${heroUrl}')`;
  }
}

function buildCard(book) {
  const img = mediaSrc(book.cover_image_url);
  const initials = (book.title || 'B').slice(0, 2).toUpperCase();
  return `
    <article class="article-card book-card" onclick="window.location.href='book.html?slug=${encodeURIComponent(book.slug)}'">
      <div class="card-image-wrap">
        ${img
          ? `<img src="${escapeHtml(img)}" alt="" loading="lazy">`
          : `<div class="card-image-fallback">${escapeHtml(initials)}</div>`}
        <span class="category-pill">${escapeHtml(book.category)}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(book.title)}</h3>
        <p class="card-excerpt">${escapeHtml(book.excerpt)}</p>
        <div class="author-row">
          <div class="author-avatar">${escapeHtml((book.author_name || 'A').charAt(0).toUpperCase())}</div>
          <div><div class="author-name">${escapeHtml(book.author_name || 'NAHS Alumni')}</div></div>
        </div>
        <div class="card-footer">
          <span><i class="far fa-calendar"></i> ${formatDate(book.published_at || book.created_at)}</span>
          <span><i class="far fa-eye"></i> ${formatViews(book.views)}</span>
          <span><i class="fas fa-file-pdf"></i> PDF</span>
        </div>
      </div>
    </article>`;
}

function skeletonCards(count) {
  return Array(count).fill(0).map(() => `
    <div class="article-card skeleton-card">
      <div class="shimmer" style="height:200px;border-radius:8px 8px 0 0"></div>
      <div style="padding:16px">
        <div class="shimmer" style="height:20px;width:80%;margin-bottom:8px"></div>
        <div class="shimmer" style="height:14px;width:100%;margin-bottom:6px"></div>
      </div>
    </div>`).join('');
}

let currentPage = 1;
let currentCategory = 'all';
let currentSearch = '';
let allLoaded = false;
let totalBooks = 0;

async function loadBooksPageSettings() {
  try {
    const res = await fetch(`${BOOKS_API}/settings`);
    const s = await res.json();
    const hero = document.getElementById('booksHero');
    const bg = document.getElementById('booksHeroBg');
    if (document.getElementById('heroTitle') && s.hero_title) {
      document.getElementById('heroTitle').textContent = s.hero_title;
    }
    if (document.getElementById('heroSubtitle') && s.hero_subtitle) {
      document.getElementById('heroSubtitle').textContent = s.hero_subtitle;
    }
    const heroUrl = mediaSrc(s.hero_image_url);
    if (hero && bg && heroUrl) setHeroBackground(hero, bg, heroUrl);
  } catch (e) {
    console.warn('Could not load books page settings', e);
  }
}

async function loadBooks(reset = false) {
  const grid = document.getElementById('booksGrid');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const countEl = document.getElementById('booksCount');
  const showingEl = document.getElementById('showingText');
  if (!grid) return;

  if (reset) {
    currentPage = 1;
    allLoaded = false;
    grid.innerHTML = skeletonCards(6);
  }

  const params = new URLSearchParams({
    page: String(currentPage),
    limit: '9',
    search: currentSearch,
  });
  if (currentCategory !== 'all') params.set('category', currentCategory);

  try {
    const res = await fetch(`${BOOKS_API}?${params}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error (${res.status})`);
    }
    const data = await res.json();
    const books = data.books || [];
    totalBooks = data.pagination?.total || books.length;

    if (reset) grid.innerHTML = '';
    if (books.length === 0 && currentPage === 1) {
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:3rem;color:#7a9ab2">No books published yet. Check back soon.</p>`;
    } else {
      grid.insertAdjacentHTML('beforeend', books.map(buildCard).join(''));
    }

    const shown = grid.querySelectorAll('.book-card').length;
    if (countEl) countEl.textContent = `${totalBooks} book${totalBooks === 1 ? '' : 's'}`;
    if (showingEl) showingEl.textContent = `Showing ${shown} of ${totalBooks}`;

    allLoaded = currentPage >= (data.pagination?.total_pages || 1);
    if (loadMoreBtn) loadMoreBtn.style.display = allLoaded ? 'none' : 'inline-flex';
  } catch (e) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:3rem;color:#c0392b">Could not load books. Please try again.</p>`;
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBooksPageSettings();
  loadBooks(true);

  document.getElementById('filterPills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentCategory = pill.dataset.category || 'all';
    loadBooks(true);
  });

  let searchTimer;
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = e.target.value.trim();
      loadBooks(true);
    }, 350);
  });

  document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
    currentPage += 1;
    loadBooks(false);
  });
});

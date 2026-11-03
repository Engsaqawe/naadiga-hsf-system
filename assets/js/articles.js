const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000'
  : window.location.origin;

const ARTICLES_API = `${API_BASE}/api/articles`;

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatViews(n) {
  return (n || 0).toLocaleString();
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function calcReadTime(text) {
  const words = (text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200)) + ' min read';
}

function mediaSrc(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

function getClientId() {
  const key = 'hsf_article_client_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(key, id);
  }
  return id;
}

function setHeroBackground(hero, bgEl, heroUrl) {
  const imgEl = document.getElementById('articlesHeroImg');
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

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function renderAuthorBlock(author, size = '') {
  if (!author) {
    return `
      <div class="author-row">
        <div class="author-avatar ${size}">?</div>
        <div><div class="author-name">NAHS Member</div></div>
      </div>`;
  }
  const av = mediaSrc(author.avatar_url);
  const lg = size ? ` ${size}` : '';
  const avatarHtml = av
    ? `<img class="author-avatar-img${lg}" src="${escapeHtml(av)}" alt="${escapeHtml(author.full_name)}">`
    : `<div class="author-avatar${lg}">${escapeHtml(getInitials(author.full_name))}</div>`;
  return `
    <a href="articles.html?author=${author.id}" class="author-link" onclick="event.stopPropagation()" title="View articles by ${escapeHtml(author.full_name)}">
      ${avatarHtml}
      <div>
        <div class="author-name">${escapeHtml(author.full_name)}</div>
        <div class="author-title">${escapeHtml(author.title || '')}</div>
      </div>
    </a>`;
}

function buildCard(article) {
  const img = mediaSrc(article.thumbnail_url);
  const initials = getInitials(article.title);

  return `
    <article class="article-card" onclick="window.location.href='article.html?slug=${encodeURIComponent(article.slug)}'">
      <div class="card-image-wrap">
        ${img
          ? `<img src="${escapeHtml(img)}" alt="" loading="lazy">`
          : `<div class="card-image-fallback">${escapeHtml(initials.slice(0, 2))}</div>`}
        <span class="category-pill">${escapeHtml(article.category)}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(article.title)}</h3>
        <p class="card-excerpt">${escapeHtml(article.excerpt)}</p>
        ${renderAuthorBlock(article.author)}
        <div class="card-footer">
          <span><i class="far fa-calendar"></i> ${formatDate(article.published_at || article.created_at)}</span>
          <span><i class="far fa-eye"></i> ${formatViews(article.views)}</span>
          <span><i class="far fa-thumbs-up"></i> ${formatViews(article.likes)}</span>
        </div>
      </div>
    </article>
  `;
}

function skeletonCards(count) {
  return Array(count).fill(0).map(() => `
    <div class="article-card skeleton-card">
      <div class="shimmer" style="height:200px;border-radius:8px 8px 0 0"></div>
      <div style="padding:16px">
        <div class="shimmer" style="height:20px;width:80%;margin-bottom:8px"></div>
        <div class="shimmer" style="height:14px;width:100%;margin-bottom:6px"></div>
        <div class="shimmer" style="height:14px;width:60%"></div>
      </div>
    </div>
  `).join('');
}

let currentPage = 1;
let currentCategory = 'all';
let currentSearch = '';
let currentTag = '';
let currentAuthorId = '';
let allLoaded = false;
let totalArticles = 0;

async function loadArticlesPageSettings() {
  try {
    const res = await fetch(`${ARTICLES_API}/settings`);
    const s = await res.json();
    const hero = document.getElementById('articlesHero');
    const bg = document.getElementById('articlesHeroBg');
    const titleEl = document.getElementById('heroTitle');
    const subEl = document.getElementById('heroSubtitle');

    if (titleEl && s.hero_title) titleEl.textContent = s.hero_title;
    if (subEl && s.hero_subtitle) subEl.textContent = s.hero_subtitle;

    const heroUrl = mediaSrc(s.hero_image_url);
    if (hero && bg && heroUrl) {
      setHeroBackground(hero, bg, heroUrl);
    }
  } catch (e) {
    console.warn('Could not load articles page settings', e);
  }
}

async function showAuthorFilterBanner(authorId) {
  const banner = document.getElementById('authorFilterBanner');
  const text = document.getElementById('authorFilterText');
  if (!banner || !authorId) {
    if (banner) banner.style.display = 'none';
    return;
  }
  try {
    const res = await fetch(`${ARTICLES_API}/members/${authorId}`);
    if (!res.ok) throw new Error();
    const m = await res.json();
    text.innerHTML = `Showing articles by <strong>${escapeHtml(m.full_name)}</strong>${m.title ? ` · ${escapeHtml(m.title)}` : ''}`;
    banner.style.display = 'flex';
  } catch {
    text.textContent = 'Showing articles by selected author';
    banner.style.display = 'flex';
  }
}

async function loadArticles(reset = false) {
  const grid = document.getElementById('articlesGrid');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const countEl = document.getElementById('articlesCount');
  const showingEl = document.getElementById('showingText');
  if (!grid) return;

  if (reset) {
    currentPage = 1;
    allLoaded = false;
    grid.innerHTML = skeletonCards(6);
  }

  const params = new URLSearchParams({ page: currentPage, limit: 9 });
  if (currentCategory && currentCategory !== 'all') params.set('category', currentCategory);
  if (currentSearch) params.set('search', currentSearch);
  if (currentTag) params.set('tag', currentTag);
  if (currentAuthorId) params.set('author_id', currentAuthorId);

  try {
    const res = await fetch(`${ARTICLES_API}?${params}`);
    const data = await res.json();
    totalArticles = data.total || 0;

    if (countEl) countEl.textContent = `${totalArticles} article${totalArticles === 1 ? '' : 's'}`;
    if (showingEl) {
      const shown = reset ? data.articles.length : grid.querySelectorAll('.article-card:not(.skeleton-card)').length + data.articles.length;
      showingEl.textContent = `Showing ${Math.min(shown, totalArticles)} of ${totalArticles} articles`;
    }

    if (reset) {
      grid.innerHTML = data.articles.length ? data.articles.map(buildCard).join('') : renderEmpty();
    } else {
      grid.insertAdjacentHTML('beforeend', data.articles.map(buildCard).join(''));
    }

    allLoaded = currentPage >= (data.totalPages || 1);
    if (loadMoreBtn) loadMoreBtn.style.display = allLoaded || !data.articles.length ? 'none' : 'inline-block';
  } catch (err) {
    console.error(err);
    if (reset) grid.innerHTML = '<p class="empty-state">Could not load articles. Is the server running?</p>';
  }
}

function renderEmpty() {
  return `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">📄</div>
      <h3>No articles found</h3>
      <p>Try a different search term or category</p>
      <button type="button" class="btn-primary" onclick="clearFilters()">Clear filters</button>
    </div>
  `;
}

const CATEGORY_ICONS = {
  Research: 'fa-flask',
  Opinion: 'fa-comment-alt',
  Report: 'fa-file-alt',
  Story: 'fa-book-open',
  Education: 'fa-graduation-cap',
  Technology: 'fa-microchip',
  Health: 'fa-heartbeat',
  Interview: 'fa-microphone',
  Analysis: 'fa-chart-line',
  'Case Study': 'fa-briefcase',
};

function buildCategoryFilterPills() {
  const wrap = document.getElementById('filterPills');
  if (!wrap || !window.ARTICLE_CATEGORIES) return;

  const allBtn = '<button type="button" class="filter-pill active" data-category="all">All</button>';
  const pills = window.ARTICLE_CATEGORIES.map((cat) => {
    const icon = CATEGORY_ICONS[cat] || 'fa-tag';
    return `<button type="button" class="filter-pill" data-category="${escapeHtml(cat)}">
      <i class="fas ${icon}" style="margin-right:5px;font-size:.75rem"></i>${escapeHtml(cat)}
    </button>`;
  }).join('');
  wrap.innerHTML = allBtn + pills;
}

function clearFilters() {
  currentCategory = 'all';
  currentSearch = '';
  currentTag = '';
  currentAuthorId = '';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.category === 'all');
  });
  const banner = document.getElementById('authorFilterBanner');
  if (banner) banner.style.display = 'none';
  if (window.history.replaceState) {
    window.history.replaceState({}, '', 'articles.html');
  }
  loadArticles(true);
}

function bindFilterPills() {
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCategory = pill.dataset.category || 'all';
      loadArticles(true);
    });
  });
}

function initListingPage() {
  const params = new URLSearchParams(window.location.search);
  currentTag = params.get('tag') || '';
  currentAuthorId = params.get('author') || params.get('author_id') || '';

  buildCategoryFilterPills();
  loadArticlesPageSettings();
  if (currentAuthorId) showAuthorFilterBanner(currentAuthorId);

  bindFilterPills();

  const searchInput = document.getElementById('searchInput');
  let searchTimer;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentSearch = searchInput.value.trim();
        loadArticles(true);
      }, 400);
    });
  }

  document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
    currentPage += 1;
    loadArticles(false);
  });

  loadArticles(true);
}

async function initArticlePage() {
  const slug = new URLSearchParams(window.location.search).get('slug');
  const loading = document.getElementById('articleLoading');
  const content = document.getElementById('articleContent');
  const notFound = document.getElementById('articleNotFound');
  if (!slug) {
    if (loading) loading.style.display = 'none';
    if (notFound) notFound.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`${ARTICLES_API}/${encodeURIComponent(slug)}?client_id=${encodeURIComponent(getClientId())}`);
    if (!res.ok) throw new Error('not found');
    const article = await res.json();
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';
    renderArticleDetail(article);
    loadRelated(article);
  } catch {
    if (loading) loading.style.display = 'none';
    if (notFound) notFound.style.display = 'block';
  }
}

function renderArticleDetail(article) {
  document.title = `${article.title} | NAHS Foundation`;
  const img = mediaSrc(article.thumbnail_url);
  const heroEl = document.getElementById('heroImage');
  if (heroEl) {
    if (img) {
      heroEl.innerHTML = `<img src="${escapeHtml(img)}" alt=""><span class="category-pill hero-pill">${escapeHtml(article.category)}</span>`;
    } else {
      heroEl.innerHTML = `<div class="card-image-fallback hero-fallback">${escapeHtml(getInitials(article.title).slice(0, 2))}</div><span class="category-pill hero-pill">${escapeHtml(article.category)}</span>`;
    }
  }

  document.getElementById('breadcrumbTitle').textContent = article.title.length > 50 ? article.title.slice(0, 50) + '…' : article.title;
  document.getElementById('articleTitle').textContent = article.title;

  const authorWrap = document.getElementById('authorMeta');
  if (authorWrap) {
    authorWrap.innerHTML = renderAuthorBlock(article.author, 'author-avatar-lg');
  }

  document.getElementById('publishedDate').textContent = ' Published ' + formatDate(article.published_at || article.created_at);
  document.getElementById('readTime').textContent = ' ' + calcReadTime(article.content);
  document.getElementById('viewCount').textContent = ' ' + formatViews(article.views) + ' views';

  const body = document.getElementById('articleBody');
  if (body && window.marked) {
    body.innerHTML = marked.parse(article.content || '');
  }

  const tagsEl = document.getElementById('tagsList');
  if (tagsEl && article.tags) {
    tagsEl.innerHTML = article.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag =>
      `<a class="tag-pill" href="articles.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`
    ).join('');
  }

  const copyBtn = document.getElementById('copyLinkBtn');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      const origHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = '<i class="fas fa-check" style="margin-right:6px"></i>Copied!';
      copyBtn.style.background = '#145f40';
      setTimeout(() => { copyBtn.innerHTML = origHtml; copyBtn.style.background = ''; }, 2200);
    } catch {
      prompt('Copy this link:', window.location.href);
    }
  });

  document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const u = encodeURIComponent(window.location.href);
    const t = encodeURIComponent(article.title);
    window.open(`https://twitter.com/intent/tweet?text=${t}&url=${u}`, '_blank');
  });

  document.getElementById('shareWhatsapp')?.addEventListener('click', () => {
    const msg = encodeURIComponent(`${article.title}\n${window.location.href}`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  });

  setupArticleReactions(article);
  setupArticleComments(article);
}

function updateReactionUI(article, userReaction) {
  const likeBtn = document.getElementById('likeBtn');
  const dislikeBtn = document.getElementById('dislikeBtn');
  const likeCount = document.getElementById('likeCount');
  const dislikeCount = document.getElementById('dislikeCount');
  if (likeCount) likeCount.textContent = formatViews(article.likes);
  if (dislikeCount) dislikeCount.textContent = formatViews(article.dislikes);
  if (likeBtn) {
    likeBtn.classList.toggle('active', userReaction === 'like');
    likeBtn.setAttribute('aria-pressed', userReaction === 'like' ? 'true' : 'false');
  }
  if (dislikeBtn) {
    dislikeBtn.classList.toggle('active', userReaction === 'dislike');
    dislikeBtn.setAttribute('aria-pressed', userReaction === 'dislike' ? 'true' : 'false');
  }
}

async function submitReaction(slug, type, articleState) {
  const likeBtn = document.getElementById('likeBtn');
  const dislikeBtn = document.getElementById('dislikeBtn');
  [likeBtn, dislikeBtn].forEach(b => { if (b) b.disabled = true });
  try {
    const res = await fetch(`${ARTICLES_API}/${encodeURIComponent(slug)}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, client_id: getClientId() }),
    });
    if (!res.ok) throw new Error('Reaction failed');
    const data = await res.json();
    articleState.likes = data.likes;
    articleState.dislikes = data.dislikes;
    updateReactionUI(articleState, data.user_reaction);
  } catch (e) {
    console.warn(e);
  } finally {
    [likeBtn, dislikeBtn].forEach(b => { if (b) b.disabled = false });
  }
}

function setupArticleReactions(article) {
  updateReactionUI(article, article.user_reaction || null);
  const slug = article.slug;
  document.getElementById('likeBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitReaction(slug, 'like', article);
  });
  document.getElementById('dislikeBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitReaction(slug, 'dislike', article);
  });
}

function updateCommentCount(n) {
  const el = document.getElementById('commentCount');
  if (el) el.textContent = String(n || 0);
}

function renderCommentItem(comment) {
  return `
    <article class="comment-item" role="listitem">
      <div class="comment-item-header">
        <span class="comment-author">${escapeHtml(comment.author_name)}</span>
        <time class="comment-date" datetime="${escapeHtml(comment.created_at || '')}">${formatDate(comment.created_at)}</time>
      </div>
      <p class="comment-body">${escapeHtml(comment.body)}</p>
    </article>`;
}

function renderCommentsList(comments) {
  const list = document.getElementById('commentsList');
  const empty = document.getElementById('commentsEmpty');
  if (!list) return;
  updateCommentCount(comments.length);
  if (!comments.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = comments.map(renderCommentItem).join('');
}

async function loadArticleComments(slug) {
  try {
    const res = await fetch(`${ARTICLES_API}/${encodeURIComponent(slug)}/comments`);
    if (!res.ok) throw new Error('Failed to load comments');
    const data = await res.json();
    renderCommentsList(data.comments || []);
  } catch (e) {
    console.warn(e);
    renderCommentsList([]);
  }
}

function setCommentFormOpen(open) {
  const wrap = document.getElementById('commentFormWrap');
  const btn = document.getElementById('commentToggleBtn');
  if (!wrap || !btn) return;
  wrap.classList.toggle('is-open', open);
  wrap.setAttribute('aria-hidden', open ? 'false' : 'true');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.innerHTML = open
    ? '<i class="fas fa-times"></i> Cancel'
    : '<i class="far fa-comment-dots"></i> Leave a comment';
}

function setupCommentFormToggle() {
  const btn = document.getElementById('commentToggleBtn');
  const wrap = document.getElementById('commentFormWrap');
  if (!btn || !wrap) return;
  btn.addEventListener('click', () => {
    const willOpen = !wrap.classList.contains('is-open');
    setCommentFormOpen(willOpen);
    if (willOpen) {
      setTimeout(() => document.getElementById('commentAuthorName')?.focus(), 450);
    }
  });
}

function setupArticleComments(article) {
  const slug = article.slug;
  const savedName = localStorage.getItem('hsf_comment_author_name');
  const nameInput = document.getElementById('commentAuthorName');
  if (nameInput && savedName) nameInput.value = savedName;
  updateCommentCount(article.comment_count || 0);
  loadArticleComments(slug);
  setupCommentFormToggle();

  const form = document.getElementById('commentForm');
  const hint = document.getElementById('commentFormHint');
  const submitBtn = document.getElementById('commentSubmitBtn');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const author_name = document.getElementById('commentAuthorName')?.value?.trim() || '';
    const body = document.getElementById('commentBody')?.value?.trim() || '';
    if (author_name.length < 2) {
      if (hint) { hint.textContent = 'Please enter your name (at least 2 characters).'; hint.classList.add('error'); }
      return;
    }
    if (body.length < 3) {
      if (hint) { hint.textContent = 'Comment must be at least 3 characters.'; hint.classList.add('error'); }
      return;
    }
    if (hint) { hint.textContent = 'Posting…'; hint.classList.remove('error'); }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch(`${ARTICLES_API}/${encodeURIComponent(slug)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name, body, client_id: getClientId() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post comment');
      localStorage.setItem('hsf_comment_author_name', author_name);
      document.getElementById('commentBody').value = '';
      if (hint) hint.textContent = 'Comment posted — thank you!';
      setCommentFormOpen(true);
      await loadArticleComments(slug);
      setTimeout(() => {
        if (hint) hint.textContent = 'Comments are public and appear after you post.';
      }, 2500);
    } catch (err) {
      if (hint) { hint.textContent = err.message || 'Could not post comment.'; hint.classList.add('error'); }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

async function loadRelated(article) {
  const grid = document.getElementById('relatedGrid');
  if (!grid) return;
  try {
    const res = await fetch(`${ARTICLES_API}?category=${encodeURIComponent(article.category)}&limit=4`);
    const data = await res.json();
    const related = (data.articles || []).filter(a => a.slug !== article.slug).slice(0, 3);
    grid.innerHTML = related.length ? related.map(buildCard).join('') : '<p class="text-muted">No related articles yet.</p>';
  } catch {
    grid.innerHTML = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('articlesGrid')) initListingPage();
  if (document.getElementById('articlePage')) initArticlePage();
});

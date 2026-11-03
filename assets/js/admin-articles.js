const ADMIN_ARTICLES_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000/api/admin/articles'
  : `${window.location.origin}/api/admin/articles`;

let adminArticlesCache = [];
let editorInitialized = false;
window.editorTags = [];
window.editorThumbFile = null;
window.editorRemoveThumbnail = false;

function openHsModal(backdropId, modalId) {
  document.getElementById(backdropId)?.classList.add('is-open');
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  document.body.classList.add('hs-modal-open');
}

function closeHsModal(backdropId, modalId) {
  document.getElementById(backdropId)?.classList.remove('is-open');
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  if (!document.querySelector('.hs-modal.is-open')) {
    document.body.classList.remove('hs-modal-open');
  }
}

function updateHeroPreviewEl(el, url, title, subtitle) {
  if (!el) return;
  if (url) {
    el.style.backgroundImage = `url('${url}')`;
    el.innerHTML = '';
  } else {
    el.style.backgroundImage = '';
    el.innerHTML = '<span class="preview-placeholder">Gradient default</span>';
  }
}

function updateHeroSummary(title, subtitle) {
  const line = document.getElementById('heroSummaryLine');
  if (line) {
    line.textContent = `"${title || ''}" — ${subtitle || ''}`.slice(0, 120) + ((title?.length + subtitle?.length) > 120 ? '…' : '');
  }
}

function articleThumbSrc(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const base = ADMIN_ARTICLES_API.replace('/api/admin/articles', '');
  return base + url;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function escapeArt(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function getCategoryClass(cat) {
  const key = (cat || 'Research').toLowerCase().replace(/\s+/g, '-');
  return `cat-${key}`;
}

function categoryBadgeHtml(cat) {
  const c = cat || 'Research';
  return `<span class="preview-category-badge ${getCategoryClass(c)}">${escapeArt(c)}</span>`;
}

function syncPreviewCategory() {
  const cat = document.getElementById('categorySelect')?.value || 'Research';
  const el = document.getElementById('previewCategory');
  if (!el) return;
  el.textContent = cat;
  el.className = `preview-category-badge ${getCategoryClass(cat)}`;
}

function initTableScrollHint() {
  const wrap = document.querySelector('.articles-table-scroll-wrap');
  const inner = document.querySelector('.articles-table-wrap');
  if (!wrap || !inner) return;
  const check = () => {
    wrap.classList.toggle('can-scroll', inner.scrollWidth > inner.clientWidth + 4);
  };
  check();
  window.addEventListener('resize', check);
  inner.addEventListener('scroll', check);
}

function renderArticlesViz(topArticles) {
  const card = document.getElementById('articlesVizCard');
  const container = document.getElementById('articlesVizBars');
  if (!card || !container) return;

  if (!topArticles || !topArticles.length) {
    card.style.display = 'none';
    return;
  }

  const maxViews = Math.max(...topArticles.map(a => a.views || 0), 1);
  container.innerHTML = topArticles.map(a => {
    const pct = Math.round(((a.views || 0) / maxViews) * 100);
    return `
      <div class="viz-bar-row">
        <span class="viz-bar-label" title="${escapeArt(a.title)}">${escapeArt(a.title)}</span>
        <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${pct}%"></div></div>
        <span class="viz-bar-count">${(a.views || 0).toLocaleString()}</span>
      </div>
    `;
  }).join('');
  card.style.display = 'block';
}

async function loadArticleStats() {
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/stats`);
    const data = await res.json();
    const map = {
      'art-stat-total': data.total,
      'art-stat-published': data.published,
      'art-stat-drafts': data.drafts,
      'art-stat-views': data.total_views,
      'art-stat-authors': data.total_authors,
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (val ?? 0).toLocaleString();
    });
    renderArticlesViz(data.top_articles || []);
  } catch (e) {
    console.error('Article stats failed', e);
  }
}

async function loadAdminArticles() {
  const tbody = document.getElementById('articles-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-muted)">Loading articles…</td></tr>';

  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}?limit=100`);
    const data = await res.json();
    adminArticlesCache = data.articles || [];

    const statusFilter = document.getElementById('articleStatusFilter')?.value || 'all';
    const search = (document.getElementById('articleSearchInput')?.value || '').toLowerCase();

    let rows = adminArticlesCache;
    if (statusFilter === 'published') rows = rows.filter(a => a.is_published);
    if (statusFilter === 'draft') rows = rows.filter(a => !a.is_published);
    if (search) rows = rows.filter(a => (a.title || '').toLowerCase().includes(search));

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center">No articles yet. <button type="button" class="btn-new-article" onclick="openArticleEditorModal()" style="margin-top:12px">+ Create first article</button></td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(a => {
      const thumb = articleThumbSrc(a.thumbnail_url);
      const author = a.author?.full_name || '—';
      const status = a.is_published
        ? '<span class="art-badge published">Published</span>'
        : '<span class="art-badge draft">Draft</span>';
      const date = a.published_at || a.created_at;
      const pubClass = a.is_published ? 'publish unpublish' : 'publish';
      return `
        <tr data-id="${a.id}" class="article-row">
          <td class="thumb-cell">${thumb
            ? `<img src="${escapeArt(thumb)}" alt="">`
            : `<div class="thumb-placeholder">${getInitials(a.title)}</div>`}</td>
          <td class="cell-title">
            <strong title="${escapeArt(a.title)}">${escapeArt(a.title)}</strong>
            <span title="${escapeArt(a.excerpt)}">${escapeArt(a.excerpt)}</span>
          </td>
          <td>${escapeArt(author)}</td>
          <td>${categoryBadgeHtml(a.category)}</td>
          <td>${status}</td>
          <td><strong>${(a.views || 0).toLocaleString()}</strong></td>
          <td style="white-space:nowrap;color:var(--text-muted);font-size:13px">${date ? new Date(date).toLocaleDateString() : '—'}</td>
          <td class="cell-actions">
            <button type="button" class="art-btn edit" onclick="openArticleEditorModal(${a.id})" title="Edit"><i class="fas fa-pen"></i></button>
            <button type="button" class="art-btn ${pubClass}" onclick="toggleArticlePublish(${a.id}, this)" title="Toggle publish"><i class="fas fa-${a.is_published ? 'eye-slash' : 'paper-plane'}"></i></button>
            <button type="button" class="art-btn delete" onclick="deleteAdminArticle(${a.id}, this)" title="Delete"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
    requestAnimationFrame(initTableScrollHint);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:#ef4444">Failed to load articles. Is the backend running?</td></tr>';
  }
}

async function toggleArticlePublish(id, btn) {
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/${id}/publish`, { method: 'PATCH' });
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    const row = btn.closest('tr');
    const badgeCell = row?.querySelector('td:nth-child(5)');
    if (badgeCell) {
      badgeCell.innerHTML = data.is_published
        ? '<span class="art-badge published">Published</span>'
        : '<span class="art-badge draft">Draft</span>';
    }
    btn.className = 'art-btn publish' + (data.is_published ? ' unpublish' : '');
    btn.innerHTML = `<i class="fas fa-${data.is_published ? 'eye-slash' : 'paper-plane'}"></i>`;
    loadArticleStats();
  } catch {
    alert('Could not update publish status');
  }
}

async function deleteAdminArticle(id, btn) {
  if (!confirm('Delete this article permanently?')) return;
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('failed');
    const row = btn.closest('tr');
    if (row) {
      row.style.transition = 'opacity 0.3s';
      row.style.opacity = '0';
      setTimeout(() => {
        row.remove();
        loadArticleStats();
        loadAdminArticles();
      }, 300);
    }
  } catch {
    alert('Delete failed');
  }
}

function populateCategoryOptions() {
  const sel = document.getElementById('categorySelect');
  if (!sel || !window.ARTICLE_CATEGORIES) return;
  const current = sel.value;
  const options = window.ARTICLE_CATEGORIES.map(
    (c) => `<option value="${escapeArt(c)}">${escapeArt(c)}</option>`
  );
  if (current && !window.ARTICLE_CATEGORIES.includes(current)) {
    options.push(`<option value="${escapeArt(current)}">${escapeArt(current)}</option>`);
  }
  sel.innerHTML = options.join('');
  if (current) sel.value = current;
}

function initArticlesAdminSection() {
  populateCategoryOptions();
  document.getElementById('articleSearchInput')?.addEventListener('input', () => loadAdminArticles());
  document.getElementById('articleStatusFilter')?.addEventListener('change', () => loadAdminArticles());
  loadArticleStats();
  loadAdminArticles();
  loadArticlesPageSettingsAdmin();
  loadAuthorsGrid();
  ensureEditorInitialized();
  initTableScrollHint();
}

/* ——— Articles page hero settings ——— */
async function loadArticlesPageSettingsAdmin() {
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/settings`);
    const s = await res.json();
    const title = document.getElementById('settingsHeroTitle');
    const sub = document.getElementById('settingsHeroSubtitle');
    if (title) title.value = s.hero_title || '';
    if (sub) sub.value = s.hero_subtitle || '';
    const url = articleThumbSrc(s.hero_image_url);
    updateHeroPreviewEl(document.getElementById('articlesHeroPreview'), url);
    updateHeroPreviewEl(document.getElementById('articlesHeroPreviewModal'), url);
    updateHeroSummary(s.hero_title, s.hero_subtitle);
  } catch (e) {
    console.error('Settings load failed', e);
  }
}

function openHeroSettingsModal() {
  loadArticlesPageSettingsAdmin();
  const msg = document.getElementById('settingsSaveMsg');
  if (msg) msg.textContent = '';
  openHsModal('heroSettingsOverlay', 'heroSettingsModal');
}

function closeHeroSettingsModal() {
  closeHsModal('heroSettingsOverlay', 'heroSettingsModal');
}

async function saveArticlesPageSettings() {
  const msg = document.getElementById('settingsSaveMsg');
  const fd = new FormData();
  fd.append('hero_title', document.getElementById('settingsHeroTitle')?.value || '');
  fd.append('hero_subtitle', document.getElementById('settingsHeroSubtitle')?.value || '');
  const file = document.getElementById('settingsHeroFile')?.files?.[0];
  if (file) fd.append('hero_image', file);
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/settings`, { method: 'PUT', body: fd });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    if (msg) { msg.textContent = 'Page settings saved!'; msg.style.color = '#16a34a'; }
    document.getElementById('settingsHeroFile').value = '';
    loadArticlesPageSettingsAdmin();
    setTimeout(closeHeroSettingsModal, 600);
  } catch (e) {
    if (msg) { msg.textContent = e.message; msg.style.color = '#dc2626'; }
  }
}

async function removeArticlesHeroImage() {
  const fd = new FormData();
  fd.append('remove_hero_image', 'true');
  fd.append('hero_title', document.getElementById('settingsHeroTitle')?.value || '');
  fd.append('hero_subtitle', document.getElementById('settingsHeroSubtitle')?.value || '');
  try {
    await fetch(`${ADMIN_ARTICLES_API}/settings`, { method: 'PUT', body: fd });
    loadArticlesPageSettingsAdmin();
    const msg = document.getElementById('settingsSaveMsg');
    if (msg) msg.textContent = 'Hero image removed.';
  } catch {
    alert('Could not remove image');
  }
}

/* ——— Authors management ——— */
let authorRemoveAvatar = false;

async function loadAuthorsGrid() {
  const grid = document.getElementById('authorsGrid');
  if (!grid) return;
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/members`);
    const members = await res.json();
    if (!members.length) {
      grid.innerHTML = '<p style="color:var(--text-muted)">No authors yet. Add one to assign to articles.</p>';
      return;
    }
    grid.innerHTML = members.map(m => {
      const av = articleThumbSrc(m.avatar_url);
      return `
        <div class="author-admin-card">
          ${av
            ? `<img src="${av}" alt="">`
            : `<div class="author-preview-circle">${getInitials(m.full_name)}</div>`}
          <h4>${escapeArt(m.full_name)}</h4>
          <p>${escapeArt(m.title || '—')}</p>
          <div class="author-admin-actions">
            <button type="button" class="art-btn edit" onclick="openAuthorModal(${m.id})"><i class="fas fa-pen"></i> Edit</button>
            <button type="button" class="art-btn delete" onclick="deleteAuthor(${m.id})"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
    }).join('');
  } catch {
    grid.innerHTML = '<p style="color:#ef4444">Failed to load authors.</p>';
  }
}

function openAuthorModal(id) {
  authorRemoveAvatar = false;
  const stacking = document.getElementById('articleEditorModal')?.classList.contains('is-open');
  const overlay = document.getElementById('authorModalOverlay');
  const modal = document.getElementById('authorEditorModal');
  overlay?.classList.toggle('hs-modal-stack', stacking);
  modal?.classList.toggle('hs-modal-stack', stacking);

  document.getElementById('authorModalTitle').textContent = id ? 'Edit author' : 'Add author';
  document.getElementById('authorEditId').value = id || '';
  document.getElementById('authorFullName').value = '';
  document.getElementById('authorTitleField').value = '';
  document.getElementById('authorBio').value = '';
  document.getElementById('authorAvatarFile').value = '';
  document.getElementById('authorAvatarPreview').innerHTML = '?';

  if (id) {
    fetch(`${ADMIN_ARTICLES_API}/members`).then(r => r.json()).then(members => {
      const m = members.find(x => x.id === id);
      if (!m) return;
      document.getElementById('authorFullName').value = m.full_name || '';
      document.getElementById('authorTitleField').value = m.title || '';
      document.getElementById('authorBio').value = m.bio || '';
      const av = articleThumbSrc(m.avatar_url);
      const prev = document.getElementById('authorAvatarPreview');
      if (av) prev.innerHTML = `<img src="${av}" style="width:72px;height:72px;border-radius:50%;object-fit:cover">`;
      else prev.textContent = getInitials(m.full_name);
    });
  }

  openHsModal('authorModalOverlay', 'authorEditorModal');

  document.getElementById('authorAvatarFile').onchange = () => {
    const f = document.getElementById('authorAvatarFile').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('authorAvatarPreview').innerHTML =
        `<img src="${e.target.result}" style="width:72px;height:72px;border-radius:50%;object-fit:cover">`;
      authorRemoveAvatar = false;
    };
    reader.readAsDataURL(f);
  };
}

function closeAuthorModal() {
  document.getElementById('authorModalOverlay')?.classList.remove('hs-modal-stack');
  document.getElementById('authorEditorModal')?.classList.remove('hs-modal-stack');
  closeHsModal('authorModalOverlay', 'authorEditorModal');
}

function clearAuthorAvatar() {
  authorRemoveAvatar = true;
  document.getElementById('authorAvatarFile').value = '';
  document.getElementById('authorAvatarPreview').textContent = '?';
}

async function saveAuthor() {
  const id = document.getElementById('authorEditId').value;
  const fd = new FormData();
  fd.append('full_name', document.getElementById('authorFullName').value.trim());
  fd.append('title', document.getElementById('authorTitleField').value.trim());
  fd.append('bio', document.getElementById('authorBio').value.trim());
  if (authorRemoveAvatar) fd.append('remove_avatar', 'true');
  const file = document.getElementById('authorAvatarFile').files[0];
  if (file) fd.append('avatar', file);

  const url = id ? `${ADMIN_ARTICLES_API}/members/${id}` : `${ADMIN_ARTICLES_API}/members`;
  const method = id ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, { method, body: fd });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    closeAuthorModal();
    loadAuthorsGrid();
    loadMembersForEditor();
  } catch (e) {
    alert(e.message || 'Could not save author');
  }
}

async function deleteAuthor(id) {
  if (!confirm('Delete this author? Their articles will remain but show no author.')) return;
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/members/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    loadAuthorsGrid();
    loadMembersForEditor();
  } catch {
    alert('Delete failed');
  }
}

/* ——— Modal ——— */
function openArticleEditorModal(articleId) {
  ensureEditorInitialized();
  resetEditorForm();
  document.getElementById('articleModalTitle').textContent = articleId ? 'Edit Article' : 'New Article';
  openHsModal('articleModalOverlay', 'articleEditorModal');
  switchArticleModalTab('edit');

  loadMembersForEditor().then(async () => {
    if (articleId) await loadArticleForEditor(articleId);
    else syncPreviewCategory();
  });
}

function closeArticleEditorModal() {
  closeHsModal('articleModalOverlay', 'articleEditorModal');
}

function switchArticleModalTab(panel) {
  document.querySelectorAll('#articleModalTabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === panel);
  });
  const formCol = document.getElementById('articleFormPanel');
  const prevCol = document.getElementById('articlePreviewPanel');
  if (window.innerWidth <= 900) {
    formCol?.classList.toggle('hidden-panel', panel !== 'edit');
    prevCol?.classList.toggle('active-panel', panel === 'preview');
  }
}

function resetEditorForm() {
  const form = document.getElementById('articleEditorForm');
  if (!form) return;
  delete form.dataset.articleId;
  window.editorTags = [];
  window.editorThumbFile = null;
  window.editorRemoveThumbnail = false;
  document.getElementById('titleInput').value = '';
  document.getElementById('slugInput').value = '';
  document.getElementById('slugInput').dataset.manual = '';
  document.getElementById('excerptInput').value = '';
  document.getElementById('contentInput').value = '';
  document.getElementById('categorySelect').value = 'Research';
  document.getElementById('authorSelect').value = '';
  document.getElementById('tagsHidden').value = '';
  document.getElementById('tagsPills').innerHTML = '';
  document.getElementById('slugPreview').textContent = 'article.html?slug=';
  const badge = document.getElementById('editorStatusBadge');
  if (badge) { badge.textContent = 'Draft'; badge.className = 'art-badge draft'; }
  const zone = document.getElementById('thumbDropzone');
  if (zone) {
    zone.innerHTML = '<span>🖼️</span><p>Drag & drop or click to upload</p><p style="font-size:12px;color:var(--text-muted)">JPG, PNG, WebP · Max 5MB</p>';
    zone.dataset.hasNew = '';
  }
  ['err-title', 'err-author', 'err-excerpt', 'err-content', 'thumbError'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  syncPreviewCategory();
  updatePreview();
  updateExcerptCounter();
}

async function loadMembersForEditor() {
  const membersSelect = document.getElementById('authorSelect');
  if (!membersSelect) return;
  try {
    const res = await fetch(`${ADMIN_ARTICLES_API}/members`);
    const members = await res.json();
    membersSelect.innerHTML = '<option value="">— Select author —</option>' +
      members.map(m => `<option value="${m.id}">${escapeArt(m.full_name)}${m.title ? ' (' + escapeArt(m.title) + ')' : ''}</option>`).join('');
  } catch (e) {
    console.error('Members load failed', e);
  }
}

async function loadArticleForEditor(id) {
  const res = await fetch(`${ADMIN_ARTICLES_API}/${id}`);
  if (!res.ok) {
    alert('Article not found');
    closeArticleEditorModal();
    return;
  }
  const a = await res.json();
  document.getElementById('titleInput').value = a.title || '';
  const slugEl = document.getElementById('slugInput');
  slugEl.value = a.slug || '';
  slugEl.dataset.manual = '1';
  document.getElementById('slugPreview').textContent = `article.html?slug=${a.slug || ''}`;
  document.getElementById('excerptInput').value = a.excerpt || '';
  document.getElementById('contentInput').value = a.content || '';
  document.getElementById('categorySelect').value = a.category || 'Research';
  syncPreviewCategory();
  if (document.getElementById('authorSelect') && a.author) {
    document.getElementById('authorSelect').value = a.author.id;
  }
  document.getElementById('articleEditorForm').dataset.articleId = a.id;
  if (a.tags) {
    window.editorTags = a.tags.split(',').map(t => t.trim()).filter(Boolean);
    renderTagPills();
  }
  const badge = document.getElementById('editorStatusBadge');
  if (badge) {
    badge.textContent = a.is_published ? 'Published' : 'Draft';
    badge.className = 'art-badge ' + (a.is_published ? 'published' : 'draft');
  }
  if (a.thumbnail_url) showThumbPreview(articleThumbSrc(a.thumbnail_url), true);
  updatePreview();
  updateExcerptCounter();
}

function ensureEditorInitialized() {
  if (editorInitialized) return;
  editorInitialized = true;

  document.getElementById('heroSettingsOverlay')?.addEventListener('click', closeHeroSettingsModal);
  document.getElementById('authorModalOverlay')?.addEventListener('click', closeAuthorModal);
  document.getElementById('articleModalOverlay')?.addEventListener('click', closeArticleEditorModal);
  document.querySelectorAll('.hs-modal').forEach(el => {
    el.addEventListener('click', (e) => e.stopPropagation());
  });

  setupEditorToolbar();
  setupTagInput();
  setupThumbnailDropzone();
  setupSlugGeneration();
  document.getElementById('categorySelect')?.addEventListener('change', () => {
    syncPreviewCategory();
    updatePreview();
  });
  document.getElementById('excerptInput')?.addEventListener('input', () => {
    updateExcerptCounter();
    const ex = document.getElementById('excerptInput')?.value || '';
    const pe = document.getElementById('previewExcerpt');
    if (pe) pe.textContent = ex;
  });
  document.getElementById('saveDraftBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    saveEditorArticle(false);
  });
  document.getElementById('publishBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    saveEditorArticle(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('authorEditorModal')?.classList.contains('is-open')) {
      closeAuthorModal();
      return;
    }
    if (document.getElementById('heroSettingsModal')?.classList.contains('is-open')) {
      closeHeroSettingsModal();
      return;
    }
    if (document.getElementById('articleEditorModal')?.classList.contains('is-open')) {
      closeArticleEditorModal();
    }
  });
}

function generateSlug(title) {
  return title.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'article';
}

function setupSlugGeneration() {
  const titleInput = document.getElementById('titleInput');
  const slugInput = document.getElementById('slugInput');
  if (!titleInput || !slugInput) return;
  titleInput.addEventListener('input', () => {
    if (!slugInput.dataset.manual) {
      slugInput.value = generateSlug(titleInput.value);
      document.getElementById('slugPreview').textContent = `article.html?slug=${slugInput.value}`;
    }
    updatePreview();
  });
  slugInput.addEventListener('input', () => {
    slugInput.dataset.manual = '1';
    document.getElementById('slugPreview').textContent = `article.html?slug=${slugInput.value}`;
  });
}

function setupTagInput() {
  const input = document.getElementById('tagsInput');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = input.value.replace(',', '').trim();
      if (tag && !window.editorTags.includes(tag)) {
        window.editorTags.push(tag);
        renderTagPills();
      }
      input.value = '';
    }
  });
}

function renderTagPills() {
  const wrap = document.getElementById('tagsPills');
  if (!wrap) return;
  wrap.innerHTML = window.editorTags.map((t, i) =>
    `<span class="tag-pill-admin">${escapeArt(t)} <button type="button" onclick="removeEditorTag(${i})">×</button></span>`
  ).join('');
  document.getElementById('tagsHidden').value = window.editorTags.join(',');
}

function removeEditorTag(i) {
  window.editorTags.splice(i, 1);
  renderTagPills();
}

function setupThumbnailDropzone() {
  const zone = document.getElementById('thumbDropzone');
  const input = document.getElementById('thumbFile');
  if (!zone || !input) return;
  zone.addEventListener('click', (e) => {
    if (e.target.closest('#removeThumb, #replaceThumb')) return;
    if (zone.querySelector('img')) return;
    input.click();
  });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleThumbFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) handleThumbFile(input.files[0]);
  });
}

function handleThumbFile(file) {
  const err = document.getElementById('thumbError');
  if (err) err.textContent = '';
  const ok = ['image/jpeg', 'image/png', 'image/webp'];
  if (!ok.includes(file.type)) {
    if (err) err.textContent = 'Only JPG, PNG, WebP allowed';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    if (err) err.textContent = 'File too large (max 5MB)';
    return;
  }
  window.editorThumbFile = file;
  window.editorRemoveThumbnail = false;
  const reader = new FileReader();
  reader.onload = (e) => {
    showThumbPreview(e.target.result, false);
    updatePreview();
  };
  reader.readAsDataURL(file);
}

function showThumbPreview(src, existing) {
  const zone = document.getElementById('thumbDropzone');
  const input = document.getElementById('thumbFile');
  zone.innerHTML = `
    <img src="${src}" style="max-width:100%;max-height:200px;object-fit:cover;border-radius:10px">
    <br>
    <a href="#" id="replaceThumb" style="color:var(--primary);font-size:13px;margin-right:12px">Replace photo</a>
    <a href="#" id="removeThumb" style="color:#dc2626;font-size:13px">Remove image</a>
  `;
  if (!existing) zone.dataset.hasNew = '1';

  document.getElementById('replaceThumb')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    input?.click();
  });

  document.getElementById('removeThumb')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.editorThumbFile = null;
    window.editorRemoveThumbnail = true;
    if (input) input.value = '';
    zone.innerHTML = '<span>🖼️</span><p>Drag & drop or click to upload</p><p style="font-size:12px;color:var(--text-muted)">JPG, PNG, WebP · Max 5MB</p>';
    zone.dataset.hasNew = '';
    updatePreview();
  });
}

function setupEditorToolbar() {
  document.querySelectorAll('[data-md]').forEach(btn => {
    btn.addEventListener('click', () => {
      wrapSelection(document.getElementById('contentInput'), btn.dataset.md);
      updatePreview();
    });
  });
  document.getElementById('excerptInput')?.addEventListener('input', updateExcerptCounter);
  document.getElementById('contentInput')?.addEventListener('input', () => {
    clearTimeout(window.previewTimer);
    window.previewTimer = setTimeout(updatePreview, 300);
    const rt = document.getElementById('readTimePreview');
    if (rt) rt.textContent = calcReadTime(document.getElementById('contentInput').value);
  });
}

function calcReadTime(text) {
  const w = (text || '').split(/\s+/).filter(Boolean).length;
  return '~' + Math.max(1, Math.ceil(w / 200)) + ' min read';
}

function wrapSelection(ta, action) {
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.substring(start, end);
  const map = {
    bold: `**${sel || 'text'}**`,
    italic: `_${sel || 'text'}_`,
    h2: `\n## ${sel || 'Heading'}\n`,
    h3: `\n### ${sel || 'Heading'}\n`,
    quote: `\n> ${sel || 'quote'}\n`,
    link: `[${sel || 'link text'}](url)`,
    ul: `\n- ${sel || 'item'}\n`,
    ol: `\n1. ${sel || 'item'}\n`,
  };
  const insert = map[action] || sel;
  ta.value = ta.value.substring(0, start) + insert + ta.value.substring(end);
  ta.focus();
}

function updateExcerptCounter() {
  const ex = document.getElementById('excerptInput');
  const c = document.getElementById('excerptCounter');
  if (!ex || !c) return;
  const n = ex.value.length;
  c.textContent = `${n} / 200`;
  c.style.color = n > 200 ? '#dc2626' : '';
}

function updatePreview() {
  const title = document.getElementById('titleInput')?.value || 'Article title';
  const excerpt = document.getElementById('excerptInput')?.value || '';
  const content = document.getElementById('contentInput')?.value || '';
  const pt = document.getElementById('previewTitle');
  const pe = document.getElementById('previewExcerpt');
  if (pt) pt.textContent = title;
  if (pe) pe.textContent = excerpt;
  syncPreviewCategory();

  const thumbWrap = document.getElementById('previewThumbWrap');
  if (thumbWrap) {
    const zone = document.getElementById('thumbDropzone');
    const img = zone?.querySelector('img');
    if (img?.src) {
      thumbWrap.style.display = 'block';
      thumbWrap.innerHTML = `<img src="${img.src}" alt="">`;
    } else {
      thumbWrap.style.display = 'none';
      thumbWrap.innerHTML = '';
    }
  }

  const body = document.getElementById('previewBody');
  if (body) {
    if (!content.trim()) {
      body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px 0">Start writing to see preview…</p>';
    } else if (window.marked) {
      body.innerHTML = marked.parse(content);
    } else {
      body.textContent = content;
    }
  }
}

function validateEditor() {
  let ok = true;
  const setErr = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    ok = false;
  };
  ['err-title', 'err-author', 'err-excerpt', 'err-content'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  if (document.getElementById('titleInput').value.trim().length < 3) setErr('err-title', 'Title must be at least 3 characters');
  if (!document.getElementById('authorSelect').value) setErr('err-author', 'Please select an author');
  const excerpt = document.getElementById('excerptInput').value.trim();
  if (!excerpt) setErr('err-excerpt', 'Excerpt is required');
  if (excerpt.length > 200) setErr('err-excerpt', 'Max 200 characters');
  if (document.getElementById('contentInput').value.trim().length < 50) setErr('err-content', 'Content must be at least 50 characters');
  return ok;
}

async function saveEditorArticle(publish) {
  if (!validateEditor()) return;

  const form = document.getElementById('articleEditorForm');
  const id = form.dataset.articleId;
  const fd = new FormData();
  fd.append('title', document.getElementById('titleInput').value.trim());
  fd.append('slug', document.getElementById('slugInput').value.trim());
  fd.append('excerpt', document.getElementById('excerptInput').value.trim());
  fd.append('content', document.getElementById('contentInput').value.trim());
  fd.append('category', document.getElementById('categorySelect').value);
  fd.append('tags', document.getElementById('tagsHidden').value);
  fd.append('author_id', document.getElementById('authorSelect').value);
  fd.append('is_published', publish ? 'true' : 'false');
  if (window.editorThumbFile) fd.append('thumbnail', window.editorThumbFile);
  if (window.editorRemoveThumbnail && !window.editorThumbFile) {
    fd.append('remove_thumbnail', 'true');
  }

  const saveBtn = document.getElementById('saveDraftBtn');
  const pubBtn = document.getElementById('publishBtn');
  [saveBtn, pubBtn].forEach(b => { if (b) { b.disabled = true; b.dataset.orig = b.textContent; b.textContent = 'Saving…'; } });

  try {
    const url = id ? `${ADMIN_ARTICLES_API}/${id}` : `${ADMIN_ARTICLES_API}`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }
    closeArticleEditorModal();
    loadArticleStats();
    loadAdminArticles();
  } catch (e) {
    alert(e.message || 'Could not save article');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save as Draft'; }
    if (pubBtn) { pubBtn.disabled = false; pubBtn.textContent = 'Publish'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('articleEditorForm')) ensureEditorInitialized();
  if (sessionStorage.getItem('openArticles') === '1') {
    sessionStorage.removeItem('openArticles');
    switchSection('articles-manager');
  }
});

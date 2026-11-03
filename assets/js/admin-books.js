const ADMIN_BOOKS_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000/api/admin/books'
  : `${window.location.origin}/api/admin/books`;

let adminBooksCache = [];
let editingBookId = null;
let bookCoverFile = null;
let bookPdfFile = null;

function escapeBk(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function bookMediaSrc(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const base = ADMIN_BOOKS_API.replace('/api/admin/books', '');
  return base + url;
}

async function initBooksAdminSection() {
  await Promise.all([loadBooksStats(), loadBooksTable(), loadBooksHeroSummary()]);
  bindBooksAdminEvents();
}

async function loadBooksStats() {
  try {
    const res = await fetch(`${ADMIN_BOOKS_API}/stats`);
    const s = await res.json();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('book-stat-total', s.total || 0);
    set('book-stat-published', s.published || 0);
    set('book-stat-drafts', s.drafts || 0);
    set('book-stat-views', (s.views || 0).toLocaleString());
  } catch (e) {
    console.warn('Books stats failed', e);
  }
}

async function loadBooksHeroSummary() {
  try {
    const res = await fetch(`${ADMIN_BOOKS_API}/settings`);
    const s = await res.json();
    const line = document.getElementById('booksHeroSummaryLine');
    if (line) line.textContent = `"${s.hero_title || ''}" — ${s.hero_subtitle || ''}`.slice(0, 120);
    const preview = document.getElementById('booksHeroPreview');
    if (preview) {
      const url = bookMediaSrc(s.hero_image_url);
      if (url) {
        preview.style.backgroundImage = `url('${url}')`;
        preview.innerHTML = '';
      } else {
        preview.style.backgroundImage = '';
        preview.innerHTML = '<span class="preview-placeholder">Gradient default</span>';
      }
    }
    if (document.getElementById('booksSettingsHeroTitle')) {
      document.getElementById('booksSettingsHeroTitle').value = s.hero_title || '';
    }
    if (document.getElementById('booksSettingsHeroSubtitle')) {
      document.getElementById('booksSettingsHeroSubtitle').value = s.hero_subtitle || '';
    }
  } catch (e) {
    console.warn('Books settings failed', e);
  }
}

async function loadBooksTable() {
  const tbody = document.getElementById('books-table-body');
  if (!tbody) return;
  const status = document.getElementById('bookStatusFilter')?.value || 'all';
  const search = document.getElementById('bookSearchInput')?.value?.trim() || '';
  const params = new URLSearchParams({ status, search });
  try {
    const res = await fetch(`${ADMIN_BOOKS_API}?${params}`);
    adminBooksCache = await res.json();
    if (!adminBooksCache.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--text-muted)">No books yet. Click New Book to add one.</td></tr>';
      return;
    }
    tbody.innerHTML = adminBooksCache.map(b => {
      const thumb = bookMediaSrc(b.cover_image_url);
      const pubClass = b.is_published ? 'publish unpublish' : 'publish';
      return `<tr>
        <td>${thumb ? `<img src="${escapeBk(thumb)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px">` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td><strong>${escapeBk(b.title)}</strong><br><small style="color:var(--text-muted)">${escapeBk(b.slug)}</small></td>
        <td>${escapeBk(b.author_name || '—')}</td>
        <td>${escapeBk(b.category)}</td>
        <td><span class="status-pill ${b.is_published ? 'published' : 'draft'}">${b.is_published ? 'Published' : 'Draft'}</span></td>
        <td>${(b.views || 0).toLocaleString()}</td>
        <td class="cell-actions">
          <button type="button" class="art-btn edit" onclick="editBookAdmin(${b.id})" title="Edit"><i class="fas fa-pen"></i></button>
          <button type="button" class="art-btn ${pubClass}" onclick="toggleBookPublish(${b.id})" title="Toggle publish"><i class="fas fa-${b.is_published ? 'eye-slash' : 'paper-plane'}"></i></button>
          <button type="button" class="art-btn delete" onclick="deleteBookAdmin(${b.id})" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#c0392b">Failed to load books.</td></tr>';
  }
}

function bindBooksAdminEvents() {
  document.getElementById('bookSearchInput')?.addEventListener('input', () => loadBooksTable());
  document.getElementById('bookStatusFilter')?.addEventListener('change', () => loadBooksTable());
  document.getElementById('bookCoverInput')?.addEventListener('change', (e) => {
    bookCoverFile = e.target.files[0] || null;
    const prev = document.getElementById('bookCoverPreview');
    if (prev && bookCoverFile) {
      prev.src = URL.createObjectURL(bookCoverFile);
      prev.hidden = false;
    }
  });
  document.getElementById('bookPdfInput')?.addEventListener('change', (e) => {
    bookPdfFile = e.target.files[0] || null;
    const lbl = document.getElementById('bookPdfLabel');
    if (lbl) lbl.textContent = bookPdfFile ? bookPdfFile.name : 'No PDF selected';
  });
}

function openBookEditorModal(book) {
  editingBookId = book?.id || null;
  bookCoverFile = null;
  bookPdfFile = null;
  document.getElementById('bookEditorTitle').textContent = editingBookId ? 'Edit Book' : 'New Book';
  document.getElementById('bookTitleInput').value = book?.title || '';
  document.getElementById('bookExcerptInput').value = book?.excerpt || '';
  document.getElementById('bookCategorySelect').value = book?.category || 'Graduation';
  document.getElementById('bookPublishCheck').checked = !!book?.is_published;
  const prev = document.getElementById('bookCoverPreview');
  const cover = bookMediaSrc(book?.cover_image_url);
  if (prev) {
    if (cover) {
      prev.src = cover;
      prev.hidden = false;
    } else {
      prev.hidden = true;
      prev.removeAttribute('src');
    }
  }
  document.getElementById('bookPdfLabel').textContent = book?.pdf_url ? 'PDF uploaded (choose file to replace)' : 'No PDF selected';
  document.getElementById('bookEditorBackdrop').classList.add('is-open');
  document.getElementById('bookEditorModal').classList.add('is-open');
  document.body.classList.add('hs-modal-open');
}

function closeBookEditorModal() {
  document.getElementById('bookEditorBackdrop')?.classList.remove('is-open');
  document.getElementById('bookEditorModal')?.classList.remove('is-open');
  if (!document.querySelector('.hs-modal.is-open')) document.body.classList.remove('hs-modal-open');
}

function openBooksHeroModal() {
  document.getElementById('booksHeroBackdrop').classList.add('is-open');
  document.getElementById('booksHeroModal').classList.add('is-open');
  document.body.classList.add('hs-modal-open');
}

function closeBooksHeroModal() {
  document.getElementById('booksHeroBackdrop')?.classList.remove('is-open');
  document.getElementById('booksHeroModal')?.classList.remove('is-open');
  if (!document.querySelector('.hs-modal.is-open')) document.body.classList.remove('hs-modal-open');
}

async function saveBookAdmin(publishOverride) {
  const title = document.getElementById('bookTitleInput').value.trim();
  if (!title) { alert('Title is required'); return; }
  const fd = new FormData();
  fd.append('title', title);
  fd.append('excerpt', document.getElementById('bookExcerptInput').value.trim());
  fd.append('category', document.getElementById('bookCategorySelect').value);
  const publish = typeof publishOverride === 'boolean'
    ? publishOverride
    : document.getElementById('bookPublishCheck').checked;
  fd.append('is_published', publish ? 'true' : 'false');
  if (bookCoverFile) fd.append('cover_image', bookCoverFile);
  if (bookPdfFile) fd.append('pdf_file', bookPdfFile);

  const url = editingBookId ? `${ADMIN_BOOKS_API}/${editingBookId}` : `${ADMIN_BOOKS_API}`;
  const method = editingBookId ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, { method, body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    closeBookEditorModal();
    await loadBooksStats();
    await loadBooksTable();
  } catch (e) {
    alert(e.message || 'Could not save book');
  }
}

async function editBookAdmin(id) {
  const book = adminBooksCache.find(b => b.id === id);
  if (book) openBookEditorModal(book);
}

async function toggleBookPublish(id) {
  try {
    await fetch(`${ADMIN_BOOKS_API}/${id}/publish`, { method: 'PATCH' });
    await loadBooksStats();
    await loadBooksTable();
  } catch (e) {
    alert('Could not toggle publish status');
  }
}

async function deleteBookAdmin(id) {
  if (!confirm('Delete this book permanently?')) return;
  try {
    await fetch(`${ADMIN_BOOKS_API}/${id}`, { method: 'DELETE' });
    await loadBooksStats();
    await loadBooksTable();
  } catch (e) {
    alert('Could not delete book');
  }
}

async function saveBooksPageSettings() {
  const fd = new FormData();
  fd.append('hero_title', document.getElementById('booksSettingsHeroTitle').value.trim());
  fd.append('hero_subtitle', document.getElementById('booksSettingsHeroSubtitle').value.trim());
  const img = document.getElementById('booksSettingsHeroImage')?.files[0];
  if (img) fd.append('hero_image', img);
  try {
    const res = await fetch(`${ADMIN_BOOKS_API}/settings`, { method: 'PUT', body: fd });
    if (!res.ok) throw new Error('Save failed');
    closeBooksHeroModal();
    await loadBooksHeroSummary();
  } catch (e) {
    alert('Could not save books page settings');
  }
}

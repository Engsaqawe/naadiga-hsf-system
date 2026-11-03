const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000'
  : window.location.origin;

const BOOKS_API = `${API_BASE}/api/books`;

function mediaSrc(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function useMobilePdfFallback() {
  return window.matchMedia('(max-width: 768px)').matches
    || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function mountPdfViewer(pdfUrl) {
  const frame = document.getElementById('bookPdfFrame');
  const fallback = document.getElementById('bookPdfMobileFallback');
  const openBtn = document.getElementById('bookOpenPdfBtn');
  if (!frame) return;

  if (useMobilePdfFallback()) {
    frame.hidden = true;
    if (fallback) {
      fallback.hidden = false;
      fallback.removeAttribute('hidden');
    }
    if (openBtn) openBtn.href = pdfUrl;
  } else {
    frame.hidden = false;
    frame.removeAttribute('hidden');
    frame.src = pdfUrl;
    if (fallback) fallback.hidden = true;
  }
}

async function loadBook() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  const loading = document.getElementById('bookLoading');
  const notFound = document.getElementById('bookNotFound');
  const content = document.getElementById('bookContent');
  if (!slug) {
    loading.style.display = 'none';
    notFound.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`${BOOKS_API}/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error('not found');
    const book = await res.json();

    document.title = `${book.title} | NAHS Foundation`;
    document.getElementById('breadcrumbTitle').textContent = book.title;
    document.getElementById('bookCategory').textContent = book.category || 'Graduation';
    document.getElementById('bookTitle').textContent = book.title;
    document.getElementById('bookExcerpt').textContent = book.excerpt || '';
    document.getElementById('bookAuthor').innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(book.author_name || 'NAHS Alumni')}`;
    document.getElementById('bookDate').innerHTML = `<i class="far fa-calendar"></i> ${formatDate(book.published_at || book.created_at)}`;
    document.getElementById('bookViews').innerHTML = `<i class="far fa-eye"></i> ${(book.views || 0).toLocaleString()} views`;

    const coverWrap = document.getElementById('bookCoverWrap');
    const cover = mediaSrc(book.cover_image_url);
    coverWrap.innerHTML = cover
      ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(book.title)}">`
      : `<div class="book-cover-fallback">${escapeHtml((book.title || 'B').slice(0, 2).toUpperCase())}</div>`;

    const pdfUrl = mediaSrc(book.pdf_url);
    const pdfSection = document.getElementById('bookPdfSection');
    const noPdf = document.getElementById('bookNoPdf');
    if (pdfUrl) {
      pdfSection.style.display = 'block';
      if (noPdf) noPdf.style.display = 'none';
      mountPdfViewer(pdfUrl);
      const dl = document.getElementById('bookDownloadBtn');
      dl.href = pdfUrl;
      dl.setAttribute('download', `${book.slug || 'book'}.pdf`);
    } else {
      pdfSection.style.display = 'none';
      if (noPdf) noPdf.style.display = 'block';
    }

    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    notFound.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', loadBook);

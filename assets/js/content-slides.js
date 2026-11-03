/**
 * Homepage content — all categories, 5 rotating slides + per-slide text each.
 * Admin uses 3 groups; data stays per category id (7,8,9,11 / 1-5 / 6,14-17).
 */
(function (global) {
  const IMG = 'portal/public/assets/default-images/';
  const SLIDE_COUNT = 5;

  const CONTENT_DEFAULT_SLIDES = {
    1: ['Impact Activities one.jpg', 'Impact Activities one 1.jpg', 'Impact Activities one 2.jpg', 'Impact Activities one 3.jpg', 'Impact Activities one 4.jpg'],
    2: ['Impact Activities two.jpg', 'Impact Activities two 1.jpg', 'Impact Activities two 2.jpg', 'Impact Activities two 3.jpg', 'Impact Activities two 4.jpg'],
    3: ['Impact Activities three.jpg', 'Impact Activities three 1.jpg', 'Impact Activities three 2.jpg', 'Impact Activities three 3.jpg', 'Impact Activities three 4.jpg'],
    4: ['Impact Activities four.jpg', 'Impact Activities four 1.jpg', 'Impact Activities four 2.jpg', 'Impact Activities four 3.jpg', 'Impact Activities four 4.jpg'],
    5: ['Impact Activities five.jpg', 'Impact Activities five 1.jpg', 'Impact Activities five 2.jpg', 'Impact Activities five 3.jpg', 'Impact Activities five 4.jpg'],
    6: ['hero.jpg', 'hero1.jpg', 'hero2.jpg', 'hero3.jpg', 'hero4.jpg'],
    7: ['gallery slot one.jpg', 'gallery slot one 1.jpg', 'gallery slot one 2.jpg', 'gallery slot one 3.jpg', 'gallery slot one 4.jpg'],
    8: ['gallery slot two.jpg', 'gallery slot two 1.jpg', 'gallery slot two 2.jpg', 'gallery slot two 3.JPG', 'gallery slot two 4.jpg'],
    9: ['gallery slot three.jpg', 'gallery slot three 1.jpg', 'gallery slot three 2.jpg', 'gallery slot three 3.jpg', 'gallery slot three 4.jpg'],
    11: ['gallery slot four.jpg', 'gallery slot four 1.jpg', 'gallery slot four 2.jpg', 'gallery slot four 3.jpg', 'gallery slot four 4.jpg'],
    14: ['sharing joy on eid.jpg', 'sharing joy on eid 1.jpg', 'sharing joy on eid 2.jpg', 'sharing joy on eid 3.jpg', 'sharing joy on eid 4.jpg'],
    15: ['Feeding Hearts in Ramadan.jpg', 'Feeding Hearts in Ramadan 1.jpg', 'Feeding Hearts in Ramadan 2.jpg', 'Feeding Hearts in Ramadan 3.jpg', 'Feeding Hearts in Ramadan 4.jpg'],
    16: ['Monthly Meetings().jpg', 'Monthly Meetings() 1.jpg', 'Monthly Meetings() 2.jpg', 'Monthly Meetings() 3.jpg', 'Monthly Meetings() 4.jpg'],
    17: ['summer courses.jpg', 'summer courses 1.jpg', 'summer courses 2.jpg', 'summer courses 3.jpg', 'summer courses 4.jpg'],
  };

  const CONTENT_DEFAULT_TEXT = {
    6: { title: 'Giving Back with Purpose', description: 'Scholarship students united to serve, inspire, and transform our community.' },
    1: {
      title: '🏖️ Beach Cleaning',
      description: 'Volunteers restoring Liido Beach, removing plastic waste.',
      badge_text: 'Feb 2025',
    },
    2: { title: '🧥 Eid Clothing', description: 'New clothes for underprivileged and orphan children.', badge_text: 'Apr 2025' },
    3: { title: '🌙 Ramadan Program', description: 'Hot meals for families across Mogadishu.', badge_text: 'Mar 2025' },
    4: { title: '📚 Monthly Meetings', description: 'We empower young minds monthly workshops , we take actions monthly', badge_text: 'Monthly' },
    5: { title: '☀️ Summer Courses', description: 'hormuud salaam foundation organize workshops to the students.', badge_text: 'Jul 2025' },
    7: { caption: 'Liido Beach Action' },
    8: { caption: 'Eid Giving' },
    9: { caption: 'Ramadan Unity' },
    11: { caption: 'Summer Courses' },
    14: { title: 'Sharing Joy on Eid', description: 'We provide new clothing for underprivileged children, ensuring every child celebrates Eid with dignity and happiness. Over 400 children received gifts last year.' },
    15: { title: 'Feeding Hearts in Ramadan', description: 'During the holy month, we organize community iftars and distribute meals to hundreds of families. A moment of unity and compassion.' },
    16: { title: 'Monthly Meetings', description: 'We empower young minds through leadership workshops and mentorship programs. Knowledge shared is knowledge multiplied.' },
    17: { title: 'Summer Courses', description: 'We get free summer courses organized by hormuud salaam foundation for students, helping them prepare for a brighter future , these programs offer students essential skills and professional mentorship at no cost.' },
  };

  const CONTENT_CATEGORY_IDS = Object.keys(CONTENT_DEFAULT_SLIDES).map(Number);
  const carouselTimers = new WeakMap();
  const POLL_MS = 45000;
  let lastContentFingerprint = '';
  let autoRefreshTimer = null;
  let autoRefreshApiBase = '';

  function clearCarouselTimers(host) {
    const existing = carouselTimers.get(host);
    if (!existing) return;
    (Array.isArray(existing) ? existing : [existing]).forEach((id) => clearInterval(id));
    carouselTimers.delete(host);
  }

  function trackCarouselTimer(host, timerId) {
    const prev = carouselTimers.get(host);
    if (prev) {
      const list = Array.isArray(prev) ? prev : [prev];
      list.push(timerId);
      carouselTimers.set(host, list);
    } else {
      carouselTimers.set(host, timerId);
    }
  }

  function publicAssetUrl(filename) {
    return IMG + encodeURIComponent(filename).replace(/%2F/g, '/');
  }

  function withCacheBust(url, stamp) {
    if (!url || isDataUrl(url) || !stamp) return url;
    const cleaned = String(url).replace(/([?&])t=\d+/g, '$1').replace(/[?&]$/, '');
    const sep = cleaned.includes('?') ? '&' : '?';
    return `${cleaned}${sep}t=${stamp}`;
  }

  function contentFingerprint(payload) {
    try {
      return JSON.stringify(payload);
    } catch (e) {
      return '';
    }
  }

  function defaultSlidesFor(catId) {
    return (CONTENT_DEFAULT_SLIDES[catId] || []).map(publicAssetUrl);
  }

  function defaultTextFor(catId) {
    return { ...(CONTENT_DEFAULT_TEXT[catId] || {}) };
  }

  function defaultSlideTextsFor(catId) {
    const base = defaultTextFor(catId);
    return Array.from({ length: SLIDE_COUNT }, () => ({ ...base }));
  }

  function isDataUrl(src) {
    return typeof src === 'string' && (src.startsWith('data:') || src.length > 300);
  }

  function resolveSlideUrl(src) {
    if (!src) return '';
    if (isDataUrl(src)) return src;
    if (src.includes('/')) {
      return src.split('/').map((part, i, arr) => (i < arr.length - 1 ? part : encodeURIComponent(part))).join('/');
    }
    return publicAssetUrl(src);
  }

  function slidesFromApi(data, catId) {
    if (data.slides && data.slides.length) return data.slides.map(resolveSlideUrl);
    return defaultSlidesFor(catId);
  }

  function textFromApi(data, catId) {
    const all = slideTextsFromApi(data, catId);
    return all[0] || defaultTextFor(catId);
  }

  function slideTextsFromApi(data, catId) {
    if (data.slide_texts && Array.isArray(data.slide_texts) && data.slide_texts.length) {
      return data.slide_texts;
    }
    return defaultSlideTextsFor(catId);
  }

  function slideTextFromApi(data, catId, slideIndex) {
    const all = slideTextsFromApi(data, catId);
    return all[slideIndex] || defaultSlideTextsFor(catId)[slideIndex] || {};
  }

  function normalizeSlides(slides, catId) {
    const list = (slides || []).slice(0, SLIDE_COUNT);
    const defs = defaultSlidesFor(catId);
    while (list.length < SLIDE_COUNT && defs.length) list.push(defs[list.length] || defs[0]);
    return list;
  }

  function setTextEl(id, value) {
    const el = document.getElementById(id);
    if (el && value != null && String(value).trim()) el.textContent = value;
  }

  function applyCategoryText(catId, text) {
    if (!text) return;
    if (catId === 6) {
      setTextEl('cat_6_hero_title', text.title);
      setTextEl('cat_6_hero_desc', text.description);
      return;
    }
    if (text.caption) setTextEl(`cat_${catId}_caption`, text.caption);
    if (catId === 1) {
      const parallaxTitle = text.title || text.section_title;
      const parallaxDesc = text.description || text.section_description;
      if (parallaxTitle) setTextEl('cat_1_parallax_title', parallaxTitle);
      if (parallaxDesc) setTextEl('cat_1_parallax_desc', parallaxDesc);
    }
    if (text.title) {
      setTextEl(`cat_${catId}_section_title`, text.title);
      setTextEl(`cat_${catId}_card_title`, text.title);
    }
    if (text.description) {
      setTextEl(`cat_${catId}_section_desc`, text.description);
      setTextEl(`cat_${catId}_card_desc`, text.description);
    }
    if (text.badge_text) {
      const badge = document.getElementById(`cat_${catId}_badge`);
      if (badge) badge.innerHTML = `<i class="far fa-calendar-alt"></i> ${text.badge_text}`;
    }
  }

  function startImgCarousel(img, slides, slideTexts, catId, intervalMs) {
    if (!img || !slides.length) return;
    clearCarouselTimers(img);
    const list = normalizeSlides(slides, catId);
    const texts = slideTexts || defaultSlideTextsFor(catId);
    const applyAt = (i) => applyCategoryText(catId, texts[i] || texts[0] || defaultTextFor(catId));
    img.classList.add('hs-content-carousel-img');
    img.src = list[0];
    img.style.opacity = '1';
    applyAt(0);
    if (list.length < 2) return;
    let idx = 0;
    const timer = setInterval(() => {
      idx = (idx + 1) % list.length;
      img.style.opacity = '0';
      setTimeout(() => {
        img.src = list[idx];
        img.style.opacity = '1';
        applyAt(idx);
      }, 400);
    }, intervalMs || 5000);
    trackCarouselTimer(img, timer);
  }

  function startBgCarousel(host, slides, slideTexts, catId, gradientPrefix, intervalMs) {
    if (!host || !slides.length) return;
    clearCarouselTimers(host);
    const list = normalizeSlides(slides, catId);
    const texts = slideTexts || defaultSlideTextsFor(catId);
    const applyAt = (i) => applyCategoryText(catId, texts[i] || texts[0] || defaultTextFor(catId));
    const prefix = gradientPrefix || '';
    host.style.backgroundImage = 'none';
    host.classList.add('has-bg-carousel');
    let layer = host.querySelector('.bg-carousel-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'bg-carousel-layer';
      host.insertBefore(layer, host.firstChild);
    }
    layer.style.opacity = '1';
    const setBg = (url) => {
      layer.style.backgroundImage = `${prefix}url("${url.replace(/"/g, '%22')}")`;
    };
    setBg(list[0]);
    applyAt(0);
    if (list.length < 2) return;
    let idx = 0;
    const timer = setInterval(() => {
      idx = (idx + 1) % list.length;
      layer.style.opacity = '0';
      setTimeout(() => {
        setBg(list[idx]);
        layer.style.opacity = '1';
        applyAt(idx);
      }, 500);
    }, intervalMs || 5000);
    trackCarouselTimer(host, timer);
  }

  function initHeroCarousel(heroEl, slides, slideTexts, intervalMs) {
    if (!heroEl) return;
    clearCarouselTimers(heroEl);
    const list = normalizeSlides(slides, 6);
    const texts = slideTexts || defaultSlideTextsFor(6);
    const applyAt = (i) => applyCategoryText(6, texts[i] || texts[0] || defaultTextFor(6));
    heroEl.style.backgroundImage = 'none';
    let wrap = heroEl.querySelector('.hero-carousel');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'hero-carousel';
      wrap.setAttribute('aria-hidden', 'true');
      heroEl.insertBefore(wrap, heroEl.firstChild);
    }
    wrap.innerHTML = '';
    list.forEach((url, i) => {
      const slide = document.createElement('div');
      slide.className = 'hero-carousel-slide' + (i === 0 ? ' active' : '');
      slide.style.backgroundImage =
        `linear-gradient(rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.45)), url("${url.replace(/"/g, '%22')}")`;
      wrap.appendChild(slide);
    });
    applyAt(0);
    if (list.length < 2) return;
    const slideEls = wrap.querySelectorAll('.hero-carousel-slide');
    let idx = 0;
    const timer = setInterval(() => {
      slideEls[idx].classList.remove('active');
      idx = (idx + 1) % slideEls.length;
      slideEls[idx].classList.add('active');
      applyAt(idx);
    }, intervalMs || 6000);
    trackCarouselTimer(heroEl, timer);
  }

  function applyCategoryContent(catId, slides, slideTexts) {
    const texts = slideTexts || defaultSlideTextsFor(catId);
    if (catId === 6) {
      initHeroCarousel(document.getElementById('home'), slides, texts);
      return;
    }
    const parallax = document.getElementById(`cat_${catId}_parallax`);
    if (parallax) {
      startBgCarousel(parallax, slides, texts, catId, 'linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), ');
    }
    document.querySelectorAll(`img[id^="cat_${catId}_"]`).forEach((img) => {
      startImgCarousel(img, slides, texts, catId);
    });
  }

  async function fetchContentPayload(apiBase, categoryIds) {
    const ids = categoryIds || CONTENT_CATEGORY_IDS;
    const base = (apiBase || '').replace(/\/$/, '');
    const payload = {};
    await Promise.all(ids.map(async (catId) => {
      try {
        const res = await fetch(`${base}/api/public/content/${catId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        payload[String(catId)] = {
          slides: slidesFromApi(data, catId),
          texts: slideTextsFromApi(data, catId),
        };
      } catch (err) {
        console.error('Failed to load content for category', catId, err);
      }
    }));
    return payload;
  }

  function applyContentPayload(payload, stamp) {
    Object.keys(payload || {}).forEach((key) => {
      const catId = Number(key);
      const entry = payload[key];
      if (!entry) return;
      const slides = (entry.slides || []).map((url) => withCacheBust(url, stamp));
      applyCategoryContent(catId, slides, entry.texts);
    });
  }

  async function loadAll(apiBase, categoryIds) {
    const ids = categoryIds || CONTENT_CATEGORY_IDS;
    ids.forEach((catId) => {
      applyCategoryContent(catId, defaultSlidesFor(catId), defaultSlideTextsFor(catId));
    });
    const payload = await fetchContentPayload(apiBase, ids);
    const stamp = Date.now();
    lastContentFingerprint = contentFingerprint(payload);
    applyContentPayload(payload, stamp);
    return payload;
  }

  async function refreshIfChanged(apiBase) {
    if (document.hidden) return false;
    const payload = await fetchContentPayload(apiBase || autoRefreshApiBase, CONTENT_CATEGORY_IDS);
    const fp = contentFingerprint(payload);
    if (!fp || fp === lastContentFingerprint) return false;
    lastContentFingerprint = fp;
    applyContentPayload(payload, Date.now());
    return true;
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function startAutoRefresh(apiBase, intervalMs) {
    stopAutoRefresh();
    autoRefreshApiBase = apiBase || '';
    const ms = Math.max(20000, intervalMs || POLL_MS);
    autoRefreshTimer = setInterval(() => {
      refreshIfChanged(autoRefreshApiBase).catch(() => {});
    }, ms);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshIfChanged(autoRefreshApiBase).catch(() => {});
      }
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      CONTENT_CATEGORY_IDS.forEach((catId) => {
        applyCategoryContent(catId, defaultSlidesFor(catId), defaultSlideTextsFor(catId));
      });
    });
  }

  global.HSFContentSlides = {
    CONTENT_DEFAULT_SLIDES,
    CONTENT_DEFAULT_TEXT,
    CONTENT_CATEGORY_IDS,
    publicAssetUrl,
    defaultSlidesFor,
    defaultTextFor,
    defaultSlideTextsFor,
    textFromApi,
    slideTextsFromApi,
    slideTextFromApi,
    slidesFromApi,
    applyCategoryText,
    applyCategoryContent,
    loadAll,
    refreshIfChanged,
    startAutoRefresh,
    stopAutoRefresh,
  };
})(typeof window !== 'undefined' ? window : globalThis);

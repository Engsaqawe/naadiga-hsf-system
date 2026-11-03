(function () {
  const LOGO_SRC = 'portal/img/logo.svg';
  const RING_RADIUS = 28;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  if (document.querySelector('.hsf-floating-actions')) return;

  const wrap = document.createElement('div');
  wrap.className = 'hsf-floating-actions';
  wrap.setAttribute('aria-label', 'Scroll progress');
  wrap.innerHTML = `
    <button type="button" class="hsf-scroll-logo" id="hsfFabTop" aria-label="Back to top" title="Back to top">
      <svg class="hsf-scroll-ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="hsf-scroll-ring__track" cx="32" cy="32" r="${RING_RADIUS}"></circle>
        <circle class="hsf-scroll-ring__progress" cx="32" cy="32" r="${RING_RADIUS}"
          stroke-dasharray="${RING_CIRCUMFERENCE}"
          stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
      </svg>
      <span class="hsf-scroll-logo__inner">
        <img src="${LOGO_SRC}" alt="HSF logo">
      </span>
    </button>
  `;
  document.body.appendChild(wrap);

  const progressRing = wrap.querySelector('.hsf-scroll-ring__progress');
  const topBtn = document.getElementById('hsfFabTop');
  let ticking = false;

  function getScrollProgress() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / scrollable));
  }

  function updateRing() {
    if (!progressRing) return;
    const progress = getScrollProgress();
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    progressRing.style.strokeDashoffset = String(offset);
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateRing);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  updateRing();

  if (topBtn) {
    topBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
})();

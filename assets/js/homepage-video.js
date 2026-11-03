(function () {
  const INTRO_AUTO_DISMISS_MS = 5000;
  const FALLBACK_VIDEOS = [
    'portal/public/assets/default-images/hsf-impact-video-1.mp4',
    'portal/public/assets/default-images/hsf-impact-video-2.mp4',
    'portal/public/assets/default-images/hsf-impact-video-3.mp4',
  ];
  const DEFAULT_VIDEO_TEXTS = [
    {
      title: 'Our Impact in Motion',
      description:
        'Watch how Hormuud Salaam Foundation scholars turn opportunity into action — from beach cleanups to community programs across Mogadishu.',
    },
    {
      title: 'Service That Inspires',
      description:
        'Every month our members lead programs that strengthen families, protect the environment, and uplift the community.',
    },
    {
      title: 'Leaders in Action',
      description:
        'From Ramadan iftars to summer courses — see the moments that define who we are as HSF scholars.',
    },
  ];

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function getApiBase() {
    if (typeof API_BASE_URL === 'string' && API_BASE_URL) return API_BASE_URL;
    const host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:5000';
    return (window.location.origin || '').replace(/\/$/, '');
  }

  function updateScrubUi(video, fill, thumb, timeEl) {
    const duration = video.duration || 0;
    const current = video.currentTime || 0;
    const pct = duration > 0 ? (current / duration) * 100 : 0;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    timeEl.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  }

  function seekFromClientX(video, track, clientX) {
    const rect = track.getBoundingClientRect();
    if (!rect.width || !Number.isFinite(video.duration)) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = ratio * video.duration;
  }

  function defaultTextForIndex(index) {
    return DEFAULT_VIDEO_TEXTS[index] || DEFAULT_VIDEO_TEXTS[0];
  }

  async function initHomepageVideo() {
    const section = document.getElementById('hsf-video-showcase');
    const video = document.getElementById('hsfShowcaseVideo');
    if (!section || !video) return;

    const intro = document.getElementById('hsfVideoIntro');
    const introTitle = document.getElementById('hsfVideoIntroTitle');
    const introDesc = document.getElementById('hsfVideoIntroDesc');
    const introSkip = document.getElementById('hsfVideoIntroSkip');
    const centerPlay = document.getElementById('hsfVideoCenterPlay');
    const prevBtn = document.getElementById('hsfVideoPrev');
    const nextBtn = document.getElementById('hsfVideoNext');
    const muteBtn = document.getElementById('hsfVideoMuteBtn');
    const scrub = document.getElementById('hsfVideoScrub');
    const track = document.getElementById('hsfVideoScrubTrack');
    const fill = document.getElementById('hsfVideoScrubFill');
    const thumb = document.getElementById('hsfVideoScrubThumb');
    const timeEl = document.getElementById('hsfVideoTime');
    const counterEl = document.getElementById('hsfVideoCounter');

    let videos = FALLBACK_VIDEOS.map((url, index) => ({
      index,
      video_url: url,
      ...defaultTextForIndex(index),
    }));
    let currentIndex = 0;
    let introActive = false;
    let introTimer = null;
    let isScrubbing = false;
    let isHoverScrubbing = false;
    let lastScrubX = null;
    let lastHoverX = null;
    let wasPlayingBeforeScrub = false;

    function currentVideo() {
      return videos[currentIndex] || videos[0];
    }

    function updateCounter() {
      if (counterEl) counterEl.textContent = `${currentIndex + 1} / ${videos.length}`;
    }

    function updateIntroText() {
      const item = currentVideo();
      const defaults = defaultTextForIndex(currentIndex);
      if (introTitle) introTitle.textContent = (item.title || '').trim() || defaults.title;
      if (introDesc) introDesc.textContent = (item.description || '').trim() || defaults.description;
    }

    function setCenterPlayIcon() {
      if (!centerPlay) return;
      const icon = centerPlay.querySelector('i');
      if (!icon) return;
      icon.className = video.paused ? 'fas fa-play' : 'fas fa-pause';
    }

    function setPlayingState() {
      if (video.paused || introActive) section.classList.remove('is-playing');
      else section.classList.add('is-playing');
      setCenterPlayIcon();
    }

    function setMuteIcon() {
      if (!muteBtn) return;
      const icon = muteBtn.querySelector('i');
      if (!icon) return;
      icon.className = video.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
    }

    function clearIntroTimer() {
      if (introTimer) {
        window.clearTimeout(introTimer);
        introTimer = null;
      }
    }

    function dismissIntro() {
      if (!introActive) return;
      clearIntroTimer();
      introActive = false;
      section.classList.remove('is-blurred', 'is-intro-active');
      if (intro) {
        intro.classList.remove('is-visible');
        intro.classList.add('is-hiding');
        window.setTimeout(() => {
          intro.hidden = true;
          intro.classList.remove('is-hiding');
        }, 700);
      }
      video.play().catch(() => {});
      setPlayingState();
    }

    function showVideoIntro() {
      clearIntroTimer();
      updateIntroText();
      introActive = true;
      section.classList.add('is-blurred', 'is-intro-active');
      section.classList.remove('is-playing');

      if (intro) {
        intro.hidden = false;
        intro.classList.remove('is-hiding', 'is-visible');
        window.requestAnimationFrame(() => {
          intro.classList.add('is-visible');
        });
      }

      video.currentTime = 0;
      video.play().catch(() => {});
      setPlayingState();
      introTimer = window.setTimeout(dismissIntro, INTRO_AUTO_DISMISS_MS);
    }

    function sourcesMatch(path) {
      if (!path) return false;
      const normalized = path.replace(/\\/g, '/');
      return (video.currentSrc || video.src || '').replace(/\\/g, '/').includes(normalized);
    }

    function loadVideoAt(index, showIntro) {
      currentIndex = (index + videos.length) % videos.length;
      const item = currentVideo();
      updateCounter();

      const begin = () => {
        if (showIntro) showVideoIntro();
        else {
          video.play().catch(() => {});
          setPlayingState();
        }
      };

      if (sourcesMatch(item.video_url)) {
        video.currentTime = 0;
        begin();
        return;
      }

      video.src = item.video_url;
      video.addEventListener('loadeddata', begin, { once: true });
    }

    introSkip?.addEventListener('click', dismissIntro);

    function togglePlay() {
      if (introActive) {
        dismissIntro();
        return;
      }
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      setPlayingState();
    }

    centerPlay?.addEventListener('click', togglePlay);

    muteBtn?.addEventListener('click', () => {
      video.muted = !video.muted;
      setMuteIcon();
    });

    prevBtn?.addEventListener('click', () => {
      loadVideoAt(currentIndex - 1, true);
    });

    nextBtn?.addEventListener('click', () => {
      loadVideoAt(currentIndex + 1, true);
    });

    video.addEventListener('ended', () => {
      loadVideoAt(currentIndex + 1, true);
    });

    section.addEventListener('mouseenter', () => {
      if (video.paused && !introActive) {
        video.play().catch(() => {});
        setPlayingState();
      }
    });

    video.addEventListener('play', setPlayingState);
    video.addEventListener('pause', setPlayingState);
    video.addEventListener('timeupdate', () => updateScrubUi(video, fill, thumb, timeEl));
    video.addEventListener('loadedmetadata', () => updateScrubUi(video, fill, thumb, timeEl));

    function onScrubMove(clientX, fromHover) {
      if (!Number.isFinite(video.duration)) return;
      const rect = track.getBoundingClientRect();
      if (!rect.width) return;

      if (fromHover && lastHoverX != null) {
        const deltaX = clientX - lastHoverX;
        const scrubSpeed = 2.4;
        const deltaTime = (deltaX / rect.width) * video.duration * scrubSpeed;
        video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + deltaTime));
      } else if (lastScrubX == null) {
        seekFromClientX(video, track, clientX);
      } else {
        const deltaX = clientX - lastScrubX;
        const scrubSpeed = 2.4;
        const deltaTime = (deltaX / rect.width) * video.duration * scrubSpeed;
        video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + deltaTime));
      }

      if (fromHover) lastHoverX = clientX;
      else lastScrubX = clientX;
      updateScrubUi(video, fill, thumb, timeEl);
    }

    function startScrub(clientX) {
      if (introActive) return;
      isScrubbing = true;
      scrub?.classList.add('is-scrubbing');
      wasPlayingBeforeScrub = !video.paused;
      video.pause();
      lastScrubX = null;
      onScrubMove(clientX, false);
    }

    function endScrub() {
      if (!isScrubbing) return;
      isScrubbing = false;
      scrub?.classList.remove('is-scrubbing');
      lastScrubX = null;
      if (wasPlayingBeforeScrub && !introActive) video.play().catch(() => {});
      setPlayingState();
    }

    track?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startScrub(e.clientX);
    });

    track?.addEventListener('mouseenter', () => {
      isHoverScrubbing = true;
      scrub?.classList.add('is-hover-scrub');
      lastHoverX = null;
    });

    track?.addEventListener('mouseleave', () => {
      isHoverScrubbing = false;
      scrub?.classList.remove('is-hover-scrub');
      lastHoverX = null;
    });

    track?.addEventListener('mousemove', (e) => {
      if (!isHoverScrubbing || isScrubbing || introActive) return;
      onScrubMove(e.clientX, true);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isScrubbing) return;
      onScrubMove(e.clientX, false);
    });

    window.addEventListener('mouseup', endScrub);

    track?.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      startScrub(touch.clientX);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isScrubbing) return;
      const touch = e.touches[0];
      if (touch) onScrubMove(touch.clientX, false);
    }, { passive: true });

    window.addEventListener('touchend', endScrub);

    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/public/homepage-video`);
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      if (Array.isArray(data.videos) && data.videos.length) {
        videos = data.videos.map((item, index) => {
          const defaults = defaultTextForIndex(index);
          return {
            ...item,
            title: (item.title || '').trim() || defaults.title,
            description: (item.description || '').trim() || defaults.description,
          };
        });
      }
    } catch (_) {
      /* use fallbacks with default text */
    }

    video.muted = true;
    setMuteIcon();
    loadVideoAt(0, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHomepageVideo);
  } else {
    initHomepageVideo();
  }
})();

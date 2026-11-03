/**
 * Member forms: check open/closed → username/password → email OTP → registration form.
 */
(function (global) {
  function resolveApiBase() {
    if (typeof global.resolveApiBaseUrl === 'function') {
      return global.resolveApiBaseUrl();
    }
    const fromConfig = (global.API_BASE_URL || '').replace(/\/$/, '');
    if (fromConfig) return fromConfig;
    const host = window.location.hostname || '';
    const port = window.location.port || '';
    if (port === '5000') return window.location.origin.replace(/\/$/, '');
    if (!host || /^localhost$|^127\.0\.0\.1$/i.test(host)) {
      return 'http://127.0.0.1:5000';
    }
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return `${window.location.protocol}//${host}:5000`;
    }
    return window.location.origin.replace(/\/$/, '');
  }

  const API_BASE = resolveApiBase();

  function friendlyFetchError(err) {
    if (!err || !err.message) return 'Something went wrong. Please try again.';
    if (err.message === 'Failed to fetch') {
      const host = window.location.hostname || '';
      const hint = /^localhost$|^127\.0\.0\.1$/i.test(host)
        ? 'Make sure the backend is running: python backend/app.py'
        : `Make sure the backend is running and open http://${host}:5000/summer-course.html on the same Wi-Fi.`;
      return `Could not reach the server. ${hint}`;
    }
    return err.message;
  }

  const MEMBER_ROLES = new Set(['Student', 'Leader', 'Payment Sub Admin', 'Payment Admin', 'Main Leader', 'Media Admin']);
  const CLOSED_LABEL = 'Closed';
  const QURAN_CLOSED_DEFAULT = 'Quran contest registration is closed now. Please check back when registration opens.';
  const SUMMER_CLOSED_DEFAULT = 'Summer course registration is closed now. Please check back when registration opens.';
  const OFFICIAL_ORG_NAME = 'Naadiga Ardayda Deeqda Waxbarasho HSF';
  const LEGACY_ORG_NAMES = new Set([
    'Naadiga Ardayda HSF',
    'Naadiga Arday Deeqda Waxbarasho HSF',
    'Hormuud Salaam Foundation',
    'Naadiga Ardayda Hormuud Salaam Foundation',
  ]);

  function normalizeSubtitle(text) {
    const t = (text || '').trim();
    return !t || LEGACY_ORG_NAMES.has(t) ? OFFICIAL_ORG_NAME : t;
  }

  let pendingUserId = null;
  let accessToken = null;
  let verifiedUser = null;
  let formType = '';
  let formStatusKey = '';
  let lastFormStatus = null;

  function statusKeyFor(form) {
    if (form === 'quran-contest') return 'quran_contest';
    if (form === 'summer-course') return 'summer_course';
    return 'help';
  }

  async function loadFormStatus(type) {
    const res = await fetch(`${API_BASE}/api/public/applications/form-status`);
    const data = await res.json();
    const key = statusKeyFor(type);
    return data[key] || { open: true, closed_message: '' };
  }

  async function loadConvocationOptions(selectEl) {
    if (!selectEl) return;
    try {
      const res = await fetch(`${API_BASE}/api/public/applications/convocation-options`);
      const options = await res.json();
      const current = selectEl.value;
      selectEl.innerHTML = '<option value="">— Dooro dufcad —</option>';
      options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        selectEl.appendChild(o);
      });
      if (current) selectEl.value = current;
    } catch (e) {
      console.error('Could not load dufcads', e);
    }
  }

  function dufcadFromUser(user) {
    if (!user?.convocation) return '';
    const m = String(user.convocation).match(/(\d+)/);
    return m ? `${m[1]}aad` : user.convocation;
  }

  function dufcadDisplayFromUser(user) {
    if (!user?.convocation) return '';
    const m = String(user.convocation).match(/(\d+)/);
    return m ? `Dufcadda ${m[1]}` : user.convocation;
  }

  function dufcadDisplayFromConvocation(convocation) {
    if (!convocation) return '';
    const m = String(convocation).match(/(\d+)/);
    return m ? `Dufcadda ${m[1]}` : convocation;
  }

  function dufcadKey(value) {
    const m = String(value || '').match(/(\d+)/);
    return m ? m[1] : String(value || '').trim().toLowerCase();
  }

  function validateMemberDufcad(user, selectedConvocation) {
    if (!user?.convocation || !selectedConvocation) return '';
    if (/^al-?nuur$/i.test(String(user.convocation).trim())) {
      if (!/^al-?nuur$/i.test(String(selectedConvocation).trim())) {
        return `You are ${dufcadDisplayFromUser(user)}. You cannot register as ${dufcadDisplayFromConvocation(selectedConvocation)}.`;
      }
      return '';
    }
    if (/^al-?nuur$/i.test(String(selectedConvocation).trim())) {
      return `You are ${dufcadDisplayFromUser(user)}. Alnuur registration is handled by admin — contact HSF.`;
    }
    const actual = dufcadKey(user.convocation);
    const selected = dufcadKey(selectedConvocation);
    if (actual && selected && actual !== selected) {
      return `You are ${dufcadDisplayFromUser(user)}. You cannot register as ${dufcadDisplayFromConvocation(selectedConvocation)}.`;
    }
    return '';
  }

  function normalizeDeadlineText(text) {
    return (text || '').trim().replace(/^F\.G\.?\s*:?\s*/i, '');
  }

  function normalizeClosedMessage(text, form) {
    const t = (text || '').trim();
    if (!t || /^(open|closed)$/i.test(t)) {
      if (form === 'quran-contest') return QURAN_CLOSED_DEFAULT;
      if (form === 'summer-course') return SUMMER_CLOSED_DEFAULT;
      return 'Registration is closed now.';
    }
    return t;
  }

  function applyFormMeta(status, isOpen) {
    const open = isOpen !== undefined ? isOpen : !!status.open;
    const headlineEl = document.getElementById('formHeadline');
    if (headlineEl && status.headline) headlineEl.textContent = status.headline;
    const subtitleEl = document.getElementById('formSubtitle');
    if (subtitleEl && status.subtitle) subtitleEl.textContent = normalizeSubtitle(status.subtitle);

    // helpMeetingDate is filled from /help/absence-context after member login

    const deadlineText = normalizeDeadlineText(status.deadline_message || status.deadline || '');
    const fgTextEl = document.getElementById('quranDeadlineFgText');
    const fgEl = document.getElementById('quranDeadlineFg');
    if (fgTextEl && fgEl) {
      if (open && deadlineText) {
        fgTextEl.textContent = deadlineText;
        fgEl.hidden = false;
      } else {
        fgTextEl.textContent = '';
        fgEl.hidden = true;
      }
    }

    const deadlineEl = document.getElementById('formDeadlineNotice');
    if (deadlineEl) {
      if (fgEl) {
        deadlineEl.textContent = '';
        deadlineEl.hidden = true;
      } else if (open && deadlineText) {
        deadlineEl.textContent = deadlineText;
        deadlineEl.hidden = false;
      } else {
        deadlineEl.textContent = '';
        deadlineEl.hidden = true;
      }
    }
  }

  function showClosed(message) {
    const card = document.querySelector('.member-form-card');
    const closedEl = document.getElementById('formClosedNotice');
    const interactive = document.getElementById('formInteractive');
    const deadlineEl = document.getElementById('formDeadlineNotice');
    const fgEl = document.getElementById('quranDeadlineFg');
    const text = normalizeClosedMessage(message, formType);
    if (card) card.classList.add('is-closed');
    if (deadlineEl) deadlineEl.hidden = true;
    if (fgEl) fgEl.hidden = true;
    if (closedEl) {
      closedEl.innerHTML = `<i class="fas fa-lock"></i>${text}`;
      closedEl.hidden = false;
    }
    if (interactive) interactive.hidden = true;
  }

  function showLoginGate() {
    const card = document.querySelector('.member-form-card');
    if (card) card.classList.remove('is-closed');
    document.getElementById('formClosedNotice').hidden = true;
    const interactive = document.getElementById('formInteractive');
    if (interactive) interactive.hidden = false;
    if (lastFormStatus) applyFormMeta(lastFormStatus, true);
    document.getElementById('memberGate').hidden = false;
    document.getElementById('memberOtpGate').hidden = true;
    document.getElementById('memberFormWrap').hidden = true;
  }

  function showOtpGate() {
    document.getElementById('memberGate').hidden = true;
    const otpEl = document.getElementById('memberOtpGate');
    otpEl.hidden = false;
    const hint = document.getElementById('otpEmailHint');
    if (hint) hint.textContent = 'Enter the verification code sent to your registered address.';
  }

  function showForm(user) {
    document.getElementById('memberGate').hidden = true;
    document.getElementById('memberOtpGate').hidden = true;
    document.getElementById('memberFormWrap').hidden = false;
    document.getElementById('memberBar').hidden = false;
    const nameEl = document.getElementById('memberBarName');
    if (nameEl) nameEl.textContent = user.name || user.username;
    if (lastFormStatus) applyFormMeta(lastFormStatus, true);
  }

  function setButtonLoading(btn, loading, loadingLabel) {
    if (!btn) return;
    if (loading) {
      if (loadingLabel && !btn.dataset.originalLabel) {
        btn.dataset.originalLabel = btn.textContent.trim();
        btn.textContent = loadingLabel;
      }
      btn.classList.add('is-loading');
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.originalLabel) {
        btn.textContent = btn.dataset.originalLabel;
        delete btn.dataset.originalLabel;
      }
      btn.classList.remove('is-loading');
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  function resetSession() {
    pendingUserId = null;
    accessToken = null;
    verifiedUser = null;
    document.getElementById('memberGateForm')?.reset();
    document.getElementById('memberOtpForm')?.reset();
  }

  function initPasswordToggles() {
    document.querySelectorAll('.member-password-wrap').forEach((wrap) => {
      const input = wrap.querySelector('input');
      const btn = wrap.querySelector('.member-password-toggle');
      if (!input || !btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-eye', !show);
          icon.classList.toggle('fa-eye-slash', show);
        }
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }

  async function initGate(config) {
    formType = config.formType || 'help';
    formStatusKey = statusKeyFor(formType);

    const gateForm = document.getElementById('memberGateForm');
    const otpForm = document.getElementById('memberOtpForm');
    const gateError = document.getElementById('memberGateError');
    const otpError = document.getElementById('memberOtpError');
    const logoutBtn = document.getElementById('memberLogoutBtn');
    const resendBtn = document.getElementById('resendOtpBtn');

    const status = await loadFormStatus(formType);
    lastFormStatus = status;
    applyFormMeta(status, status.open);
    if (!status.open) {
      showClosed(status.closed_message);
      return;
    }
    showLoginGate();
    initPasswordToggles();

    gateForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('gateUsername')?.value || '';
      const password = document.getElementById('gatePassword')?.value || '';
      const submitBtn = gateForm.querySelector('button[type="submit"]');
      if (gateError) { gateError.hidden = true; gateError.textContent = ''; }
      setButtonLoading(submitBtn, true);
      try {
        const res = await fetch(`${API_BASE}/api/public/applications/verify-member`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, form_type: formType }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.closed) showClosed(data.error);
          throw new Error(data.error || 'Access denied.');
        }
        pendingUserId = data.user_id;
        showOtpGate();
      } catch (err) {
        if (gateError) {
          gateError.textContent = friendlyFetchError(err);
          gateError.hidden = false;
        }
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });

    otpForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = document.getElementById('gateOtp')?.value?.trim() || '';
      const submitBtn = otpForm.querySelector('button[type="submit"]');
      if (otpError) { otpError.hidden = true; otpError.textContent = ''; }
      setButtonLoading(submitBtn, true);
      try {
        const res = await fetch(`${API_BASE}/api/public/applications/verify-email-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: pendingUserId, otp, form_type: formType }),
        });
        let data = {};
        try {
          data = await res.json();
        } catch (parseErr) {
          if (!res.ok) throw new Error(`Server error (${res.status}). Try again or resend the code.`);
          throw parseErr;
        }
        if (!res.ok) {
          if (data.closed) showClosed(data.error);
          throw new Error(data.error || 'Invalid code.');
        }
        accessToken = data.access_token;
        verifiedUser = data.user;
        showForm(verifiedUser);
        if (typeof config.onAuthenticated === 'function') config.onAuthenticated(verifiedUser);
      } catch (err) {
        if (otpError) {
          otpError.textContent = friendlyFetchError(err);
          otpError.hidden = false;
        }
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });

    resendBtn?.addEventListener('click', async () => {
      const username = document.getElementById('gateUsername')?.value || '';
      const password = document.getElementById('gatePassword')?.value || '';
      if (!username || !password || resendBtn.disabled) return;
      if (otpError) { otpError.hidden = true; otpError.textContent = ''; }
      setButtonLoading(resendBtn, true, 'Sending…');
      try {
        const res = await fetch(`${API_BASE}/api/public/applications/verify-member`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, form_type: formType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not resend.');
        const hint = document.getElementById('otpEmailHint');
        if (hint) hint.textContent = 'A new verification code was sent to your registered address.';
      } catch (err) {
        if (otpError) {
          otpError.textContent = friendlyFetchError(err);
          otpError.hidden = false;
        } else {
          alert(err.message);
        }
      } finally {
        setButtonLoading(resendBtn, false);
      }
    });

    logoutBtn?.addEventListener('click', () => {
      resetSession();
      showLoginGate();
    });
  }

  async function submitApplication(endpoint, payload) {
    if (!verifiedUser || !accessToken) throw new Error('Please complete member verification first.');
    const status = await loadFormStatus(formType);
    if (!status.open) {
      showClosed(status.closed_message);
      throw new Error(normalizeClosedMessage(status.closed_message, formType));
    }
    const res = await fetch(`${API_BASE}/api/public/applications/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        user_id: verifiedUser.id,
        username: verifiedUser.username,
        access_token: accessToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.closed) throw new Error(normalizeClosedMessage(data.error, formType));
      if (data.already_registered) throw new Error(data.error || 'You are already registered this year.');
      throw new Error(data.error || 'Submission failed.');
    }
    return data;
  }

  function getAccessToken() {
    return accessToken;
  }

  global.HSFMemberGate = {
    loadConvocationOptions,
    dufcadFromUser,
    dufcadDisplayFromUser,
    dufcadDisplayFromConvocation,
    dufcadKey,
    validateMemberDufcad,
    initGate,
    submitApplication,
    getAccessToken,
    API_BASE,
  };
})(typeof window !== 'undefined' ? window : globalThis);

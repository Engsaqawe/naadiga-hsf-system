/** Save / restore contact form when user must log in or register first. */
(function (global) {
  const DRAFT_KEY = 'hsf_contact_draft';
  const RETURN_KEY = 'hsf_post_auth_return';
  const DEFAULT_RETURN = 'index.html#contact';

  function saveContactDraft(name, email, message) {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: name || '',
      email: email || '',
      message: message || '',
    }));
    sessionStorage.setItem(RETURN_KEY, DEFAULT_RETURN);
  }

  function getPostAuthReturn(fallback) {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('return');
    if (fromUrl) {
      sessionStorage.setItem(RETURN_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(RETURN_KEY) || fallback || DEFAULT_RETURN;
  }

  function buildLoginUrl(returnTo) {
    const ret = returnTo || getPostAuthReturn();
    return `admin_login.html?return=${encodeURIComponent(ret)}`;
  }

  function buildRegisterUrl(returnTo) {
    const ret = returnTo || getPostAuthReturn();
    return `portal/register.html?return=${encodeURIComponent(ret)}`;
  }

  function restoreContactDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      const nameEl = document.getElementById('contactName');
      const emailEl = document.getElementById('contactEmail');
      const msgEl = document.getElementById('contactMsg');
      if (nameEl && draft.name) nameEl.value = draft.name;
      if (emailEl && draft.email) emailEl.value = draft.email;
      if (msgEl && draft.message) msgEl.value = draft.message;
      return !!(draft.name || draft.email || draft.message);
    } catch {
      return false;
    }
  }

  function clearContactDraft() {
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  }

  function scrollToContactSection() {
    const el = document.getElementById('contact');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function redirectToLoginForContact() {
    const name = document.getElementById('contactName')?.value?.trim() || '';
    const email = document.getElementById('contactEmail')?.value?.trim() || '';
    const message = document.getElementById('contactMsg')?.value?.trim() || '';
    saveContactDraft(name, email, message);
    window.location.href = buildLoginUrl();
  }

  function initContactRestoreOnHomepage() {
    const hasDraft = restoreContactDraft();
    const hash = window.location.hash;
    const shouldScroll = hasDraft || hash === '#contact' || sessionStorage.getItem(RETURN_KEY);
    if (shouldScroll) {
      setTimeout(scrollToContactSection, 150);
    }
  }

  global.HSFContactReturn = {
    saveContactDraft,
    getPostAuthReturn,
    buildLoginUrl,
    buildRegisterUrl,
    restoreContactDraft,
    clearContactDraft,
    scrollToContactSection,
    redirectToLoginForContact,
    initContactRestoreOnHomepage,
  };
})(window);

/**
 * Shared Quran Contest admin UI (portal page + Reports tab).
 */
(function (global) {
  const CURRENT_YEAR = new Date().getFullYear();
  let apps = [];
  let history = [];
  let eventsBound = false;
  let selectedContestYear = null;
  let registrationOpen = true;
  let registrationClosedMessage = '';
  /** Mirrors backend quran_allow_same_section_retry_below_30 (default off). */
  let allowSameSectionRetryBelow30 = false;

  const HSF_ORG_NAME = 'Naadiga Ardayda Deeqda Waxbarasho HSF';
  const HSF_LOGO = '../../img/logo.png';
  const QURAN_CLOSED_DEFAULT = 'Quran contest registration is closed now. Please check back when registration opens.';

  function getApi() {
    const base = (typeof API_BASE !== 'undefined' && API_BASE)
      ? API_BASE.replace(/\/api\/?$/, '')
      : 'http://127.0.0.1:5000';
    return `${base}/api/applications`;
  }

  function qEl(id) {
    const tab = document.getElementById('quran-tab-content');
    if (tab) {
      const scoped = tab.querySelector(`[id="${id}"]`);
      if (scoped) return scoped;
    }
    return document.getElementById(id);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function formatPrevSection(a) {
    if (a.participated_before === 'Maya') return '—';
    return esc(a.previous_section) || '—';
  }

  function formatWonBefore(a) {
    if (a.participated_before === 'Maya') return '—';
    return esc(a.won_before) || '—';
  }

  function reportPreviousSection(r) {
    if (r.participated_before !== 'Haa') return '';
    return esc(r.previous_section) || '';
  }

  function reportWonBeforePlace(r) {
    if (r.participated_before !== 'Haa') return 'None';
    const w = (r.won_before || '').trim();
    if (w === 'Kaalinta 1aad') return '1';
    if (w === 'Kaalinta 2aad') return '2';
    if (w === 'Kaalinta 3aad') return '3';
    return 'None';
  }

  function juzLevel(label) {
    if (!label || label === 'Midna') return 0;
    const m = String(label).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  const QURAN_SECTION_OPTIONS = [
    { value: 'Qeybta 10-ka Jus', level: 10 },
    { value: 'Qeybta 20-ka Jus', level: 20 },
    { value: 'Qeybta 30-ka Jus', level: 30 },
  ];

  const QURAN_REG_MSG = {
    wonSame: '❌ You cannot register for this category because you previously won 1st, 2nd, or 3rd place in this category.',
    participatedSame: '❌ You cannot register for a category that you have already participated in before.',
    lowerSection: '❌ You cannot register for a section lower than one you have already competed in before.',
    juz30First: '❌ Previous 1st place winners of the 30 Juz category are not eligible to participate again.',
    notEligible: '❌ You are not eligible to register for the selected section.',
    fieldTamper: '❌ Cannot change profile data loaded from the member account. Only the name may be edited.',
    success: 'Registration submitted successfully.',
  };

  let addCompetitorPrefill = null;
  let regEditPrefill = null;
  let regEditIsAlnuur = false;
  let addCompetitorEmailResolvedFor = '';
  let addCompetitorEmailLookupTimer = null;
  let addCompetitorEmailLookupBusy = false;

  async function fetchQuranEligibility(userId, excludeAppId) {
    if (!userId) return null;
    try {
      const body = { user_id: userId };
      if (excludeAppId != null) body.exclude_app_id = excludeAppId;
      const res = await fetchJson('/quran-contest/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.prefill || null;
    } catch (e) {
      console.error('Quran eligibility fetch failed', e);
      return null;
    }
  }

  async function fetchQuranEligibilityByEmail(email) {
    const normalized = (email || '').trim();
    if (!normalized || !normalized.includes('@')) return null;
    try {
      const res = await fetchJson('/quran-contest/eligibility-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('Quran eligibility-by-email failed', e);
      return null;
    }
  }

  function hasContestHistoryPrefill(prefill) {
    if (!prefill) return false;
    return prefill.participated_before === 'Haa' || (prefill.highest_past_level || 0) > 0;
  }

  function setParticipatedRadio(value) {
    const v = value === 'Haa' ? 'Haa' : 'Maya';
    document.querySelectorAll('input[name="addCompetitorParticipated"]').forEach((r) => {
      r.checked = r.value === v;
    });
  }

  function setInputLocked(el, locked) {
    if (!el) return;
    el.readOnly = locked;
    if (el.tagName === 'SELECT') el.disabled = locked;
    if (el.type === 'radio') el.disabled = locked;
    el.classList.toggle('input-locked', locked);
    el.style.background = '';
    el.style.color = '';
    el.style.cursor = locked ? 'not-allowed' : '';
  }

  function isAddCompetitorHsfLocked() {
    const userId = document.getElementById('addCompetitorUserId')?.value;
    const conv = document.getElementById('addCompetitorDufcad')?.value || '';
    return !!userId && !isAlnuurDufcad(conv);
  }

  function isAddCompetitorPastLocked() {
    if (isAddCompetitorHsfLocked()) return true;
    if (hasContestHistoryPrefill(addCompetitorPrefill)) return true;
    return isAddCompetitorAlnuurEmailPending();
  }

  function isAddCompetitorAlnuurEmailPending() {
    const conv = document.getElementById('addCompetitorDufcad')?.value || '';
    if (!isAlnuurDufcad(conv)) return false;
    if (document.getElementById('addCompetitorUserId')?.value) return false;
    const email = (document.getElementById('addCompetitorEmail')?.value || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return false;
    if (addCompetitorEmailLookupBusy) return true;
    return email !== addCompetitorEmailResolvedFor;
  }

  function setAddCompetitorEmailStatus(text, isError) {
    const selEl = document.getElementById('addCompetitorSelected');
    if (!selEl) return;
    if (!text) {
      if (!hasContestHistoryPrefill(addCompetitorPrefill)) {
        selEl.hidden = true;
        selEl.textContent = '';
      }
      return;
    }
    selEl.textContent = text;
    selEl.hidden = false;
    selEl.style.color = isError ? '#dc2626' : 'var(--text-muted)';
  }

  function isRegEditPastLocked() {
    return !regEditIsAlnuur && !!regEditPrefill;
  }

  function setAddCompetitorPastBlockVisible(visible) {
    const block = document.getElementById('addCompetitorPastBlock');
    if (block) block.hidden = !visible;
  }

  function memberRegisteredForYear(userId, year) {
    if (!userId || year == null) return null;
    return apps.find((a) => a.user_id === userId && appContestYear(a) === year) || null;
  }

  function lockAddCompetitorPastFields(locked) {
    document.querySelectorAll('input[name="addCompetitorParticipated"]').forEach((el) => {
      el.disabled = locked;
    });
    setInputLocked(document.getElementById('addCompetitorPrevSection'), locked);
    setInputLocked(document.getElementById('addCompetitorWonBefore'), locked);
  }

  function lockAddCompetitorHsfFields(locked) {
    [
      'addCompetitorWhatsapp',
      'addCompetitorTelephone',
      'addCompetitorDufcad',
      'addCompetitorUniversity',
      'addCompetitorFaculty',
      'addCompetitorSemester',
      'addCompetitorEmail',
    ].forEach((id) => setInputLocked(document.getElementById(id), locked));
    lockAddCompetitorPastFields(locked || isAddCompetitorPastLocked());
  }

  function lockRegEditHsfFields(locked) {
    [
      'regEditWhatsapp',
      'regEditTelephone',
      'regEditDufcad',
    ].forEach((id) => setInputLocked(document.getElementById(id), locked));
    setInputLocked(document.getElementById('regEditParticipated'), locked);
    setInputLocked(document.getElementById('regEditPrevSection'), locked);
    setInputLocked(document.getElementById('regEditWonBefore'), locked);
  }

  function applyPrefillToAddCompetitor(prefill) {
    addCompetitorPrefill = prefill;
    if (!prefill) return;
    document.getElementById('addCompetitorWhatsapp').value = prefill.whatsapp || '';
    document.getElementById('addCompetitorTelephone').value = prefill.telephone || '';
    document.getElementById('addCompetitorEmail').value = prefill.email || '';
    document.getElementById('addCompetitorUniversity').value = prefill.university || '';
    document.getElementById('addCompetitorFaculty').value = prefill.faculty || '';
    document.getElementById('addCompetitorSemester').value = prefill.semester || '';
    const dufSel = document.getElementById('addCompetitorDufcad');
    if (dufSel && prefill.convocation && !isAlnuurDufcad(dufSel.value)) {
      if (![...dufSel.options].some((o) => o.value === prefill.convocation)) {
        dufSel.add(new Option(prefill.convocation, prefill.convocation));
      }
      dufSel.value = prefill.convocation;
    }
    const participated = prefill.participated_before || 'Maya';
    setParticipatedRadio(participated);
    if (participated === 'Haa') {
      document.getElementById('addCompetitorPrevSection').value = prefill.previous_section || '';
      document.getElementById('addCompetitorWonBefore').value = prefill.won_before || 'Midna';
    }
    syncAddCompetitorPastFields();
    lockAddCompetitorPastFields(isAddCompetitorPastLocked());
  }

  function validateQuranCategoryRules(participated, prevSection, wonBefore, sectionThisYear) {
    const cur = juzLevel(sectionThisYear);
    if (participated !== 'Haa' || !prevSection || prevSection === 'Midna') return '';
    const prev = juzLevel(prevSection);
    if (wonBefore === 'Kaalinta 1aad' && prev >= 30) return QURAN_REG_MSG.juz30First;
                if (cur < prev) return QURAN_REG_MSG.lowerSection;
    if (cur === prev) {
      if (prev >= 30) return '';
      if (allowSameSectionRetryBelow30) {
        if (wonBefore === 'Kaalinta 1aad') return QURAN_REG_MSG.wonSame;
        return '';
      }
      if (wonBefore === 'Kaalinta 1aad' || wonBefore === 'Kaalinta 2aad' || wonBefore === 'Kaalinta 3aad') {
        return QURAN_REG_MSG.wonSame;
      }
      return QURAN_REG_MSG.participatedSame;
    }
    return '';
  }

  function showQuranFlash(message, type) {
    let el = document.getElementById('quranAdminFlash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'quranAdminFlash';
      el.className = 'quran-admin-flash';
      const host = document.querySelector('.dashboard-content');
      if (host) host.prepend(el);
    }
    el.textContent = message;
    el.className = `quran-admin-flash quran-admin-flash--${type || 'success'}`;
    el.hidden = false;
    clearTimeout(showQuranFlash._timer);
    showQuranFlash._timer = setTimeout(() => { el.hidden = true; }, 8000);
  }

  function allowedSectionsForPast(participated, prevSection, wonBefore, prefill) {
    if (prefill && Array.isArray(prefill.allowed_sections)) {
      return prefill.allowed_sections.map((value) => ({
        value,
        level: juzLevel(value),
      }));
    }
    if (participated !== 'Haa' || !prevSection || prevSection === 'Midna') return QURAN_SECTION_OPTIONS;
    const prev = juzLevel(prevSection);
    if (wonBefore === 'Kaalinta 1aad' && prev >= 30) return [];
    if (allowSameSectionRetryBelow30 && prev < 30) {
      if (wonBefore === 'Kaalinta 1aad') {
        return QURAN_SECTION_OPTIONS.filter((s) => s.level > prev);
      }
      return QURAN_SECTION_OPTIONS.filter((s) => s.level >= prev);
    }
    const filtered = QURAN_SECTION_OPTIONS.filter((s) => s.level > prev);
    if (prev >= 30) {
      return QURAN_SECTION_OPTIONS.filter((s) => s.level === 30);
    }
    return filtered;
  }

  function sectionEligibilityHint(participated, prevSection, wonBefore, prefill) {
    if (prefill?.eligibility_hint) return prefill.eligibility_hint;
    if (prefill?.permanently_ineligible) {
      if (prefill.juz30_first_winner_year) {
        return `${QURAN_REG_MSG.juz30First} (winner record: ${prefill.juz30_first_winner_year}).`;
      }
      return QURAN_REG_MSG.juz30First;
    }
    if (prefill && Array.isArray(prefill.allowed_sections) && !prefill.allowed_sections.length) {
      return QURAN_REG_MSG.notEligible;
    }
    if (participated !== 'Haa' || !prevSection || prevSection === 'Midna') return '';
    if (wonBefore === 'Kaalinta 1aad' && juzLevel(prevSection) >= 30) {
      return QURAN_REG_MSG.juz30First;
    }
    const allowed = allowedSectionsForPast(participated, prevSection, wonBefore, prefill);
    if (!allowed.length) return QURAN_REG_MSG.notEligible;
    const prev = juzLevel(prevSection);
    if (prev >= 30) {
      return 'Previously at 30 Juz — may register for 30 Juz again unless they won 1st place.';
    }
    if (allowSameSectionRetryBelow30) {
      if (wonBefore === 'Kaalinta 1aad') {
        return `Won 1st place at ${prevSection} — choose a higher section only (same or lower is not allowed).`;
      }
      return `Previously in ${prevSection} — may register the same section again, or a higher one. Lower sections are not allowed.`;
    }
    return `Previously in ${prevSection} — choose a higher section only (same or lower is not allowed).`;
  }

  function syncSectionSelect(selectId, hintId, participated, prevSection, wonBefore, prefill) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const current = sel.value;
    const allowed = allowedSectionsForPast(participated, prevSection, wonBefore, prefill);
    const placeholder = selectId === 'addCompetitorSection'
      ? '<option value="">— Dooro —</option>'
      : '';
    if (!allowed.length) {
      sel.innerHTML = `${placeholder}<option value="">— Not eligible —</option>`;
      sel.value = '';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = placeholder + allowed.map((s) =>
        `<option value="${esc(s.value)}">${esc(s.value)}</option>`
      ).join('');
      if (current && allowed.some((s) => s.value === current)) sel.value = current;
      else if (allowed.length === 1) sel.value = allowed[0].value;
      else if (!allowed.some((s) => s.value === current)) sel.value = allowed[0]?.value || '';
    }
    const hint = hintId ? document.getElementById(hintId) : null;
    if (hint) {
      const text = sectionEligibilityHint(participated, prevSection, wonBefore, prefill);
      hint.textContent = text;
      hint.hidden = !text;
      hint.style.color = allowed.length ? 'var(--text-muted)' : '#dc2626';
    }
  }

  function bindPastSectionListeners(onChange) {
    onChange.forEach(({ id, handler }) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.qcPastBound === '1') return;
      el.dataset.qcPastBound = '1';
      el.addEventListener('change', handler);
    });
  }

  function syncRegEditPastFields() {
    const locked = isRegEditPastLocked();
    let participated = document.getElementById('regEditParticipated')?.value || 'Maya';
    if (locked && regEditPrefill) {
      participated = regEditPrefill.participated_before || 'Maya';
      document.getElementById('regEditParticipated').value = participated;
    }
    const show = participated === 'Haa';
    const prevWrap = document.getElementById('regEditPrevSectionWrap');
    const wonWrap = document.getElementById('regEditWonBeforeWrap');
    if (prevWrap) prevWrap.hidden = !show;
    if (wonWrap) wonWrap.hidden = !show;
    if (show && locked && regEditPrefill) {
      document.getElementById('regEditPrevSection').value = regEditPrefill.previous_section || '';
      document.getElementById('regEditWonBefore').value = regEditPrefill.won_before || 'Midna';
    } else if (!show && !locked) {
      const prev = document.getElementById('regEditPrevSection');
      const won = document.getElementById('regEditWonBefore');
      if (prev) prev.value = '';
      if (won) won.value = '';
    }
    const prevSection = show ? (document.getElementById('regEditPrevSection')?.value || '') : '';
    const wonBefore = show ? (document.getElementById('regEditWonBefore')?.value || '') : '';
    syncSectionSelect('regEditSection', 'regEditSectionHint', participated, prevSection, wonBefore, regEditPrefill);
  }

  function regEditPayload() {
    const showPast = (regEditPrefill?.participated_before || document.getElementById('regEditParticipated').value) === 'Haa';
    const participated = isRegEditPastLocked() && regEditPrefill
      ? (regEditPrefill.participated_before || 'Maya')
      : document.getElementById('regEditParticipated').value;
    const previousSection = showPast
      ? ((isRegEditPastLocked() && regEditPrefill)
        ? (regEditPrefill.previous_section || null)
        : (document.getElementById('regEditPrevSection').value || null))
      : null;
    const wonBefore = showPast
      ? ((isRegEditPastLocked() && regEditPrefill)
        ? (regEditPrefill.won_before || null)
        : (document.getElementById('regEditWonBefore').value || null))
      : null;
    return {
      full_name: document.getElementById('regEditName').value.trim(),
      whatsapp: document.getElementById('regEditWhatsapp').value.trim(),
      telephone: document.getElementById('regEditTelephone').value.trim(),
      convocation: document.getElementById('regEditDufcad').value.trim(),
      participated_before: participated,
      previous_section: previousSection,
      won_before: wonBefore,
      section_this_year: document.getElementById('regEditSection').value,
    };
  }

  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString() : '—';
  }

  function emptyLabel() {
    return '—';
  }

  function programDateDisplay(data) {
    if (data?.contest_date) return fmtDate(data.contest_date);
    if (data?.created_at) return fmtDate(data.created_at);
    return emptyLabel();
  }

  function currentContestRegistrations() {
    if (selectedContestYear == null || !history.length) return 0;
    return appsLinkedToAdminPrograms(false).filter((a) => appContestYear(a) === selectedContestYear).length;
  }

  function regDateKey(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getGlobalMonth() {
    return qEl('globalMonthPicker')?.value || '';
  }

  function monthToRange(monthVal) {
    if (!monthVal) return { from: '', to: '' };
    const [y, m] = monthVal.split('-').map((n) => parseInt(n, 10));
    const lastDay = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    return {
      from: `${y}-${mm}-01`,
      to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  function isReportsPage() {
    return !!document.getElementById('quran-tab-content');
  }

  function contestLabel(year) {
    const row = history.find((h) => h.year === year);
    if (row?.title) return row.title;
    return `${year} Quran Contest`;
  }

  function contestTitleFromHistory(year) {
    return history.find((h) => h.year === year)?.title || '';
  }

  function appContestYear(a) {
    return a.created_at ? new Date(a.created_at).getFullYear() : null;
  }

  function adminContestYears() {
    return new Set(history.map((h) => h.year));
  }

  function appsLinkedToAdminPrograms(useDateFilter = true) {
    const years = adminContestYears();
    const base = useDateFilter ? getDateFilteredApps() : apps;
    return base.filter((a) => {
      const y = appContestYear(a);
      return y != null && years.has(y);
    });
  }

  function getContestYearApps() {
    if (!isReportsPage() && !history.length) return [];
    const useDateFilter = isReportsPage() || selectedContestYear == null;
    const linked = appsLinkedToAdminPrograms(useDateFilter);
    if (isReportsPage() || selectedContestYear == null) return linked;
    return linked.filter((a) => appContestYear(a) === selectedContestYear);
  }

  function setContestModalHeadVisible(showTitle) {
    const head = document.getElementById('contestModalHead');
    const title = document.getElementById('contestModalTitle');
    const card = document.querySelector('#contestModal .portal-modal-card');
    if (title) title.style.display = showTitle ? '' : 'none';
    if (head) head.classList.toggle('portal-modal-head--view-only', !showTitle);
    if (card) card.classList.toggle('portal-modal-card--no-inner-scroll', !showTitle);
  }

  function contestModalBrandHtml(year, subtitle) {
    return `
      <div class="hsf-program-modal-brand">
        <img src="${HSF_LOGO}" alt="" class="hsf-program-modal-logo" width="52" height="52">
        <div class="hsf-program-modal-brand-text">
          <p class="hsf-program-modal-org">${esc(HSF_ORG_NAME)}</p>
          <h4 class="hsf-program-modal-year">${esc(contestLabel(year))}</h4>
          ${subtitle ? `<p class="hsf-program-modal-sub">${esc(subtitle)}</p>` : ''}
        </div>
      </div>`;
  }

  function contestNameCell(year) {
    if (isReportsPage()) return esc(contestLabel(year));
    return `<button type="button" class="hsf-program-link" onclick="QuranContestAdmin.selectContestYear(${year})">${esc(contestLabel(year))}</button>`;
  }

  function updateRegistrationsTitle() {
    const btn = qEl('regYearTitleBtn');
    const span = qEl('reg-year-title');
    if (!span) return;
    if (selectedContestYear != null && !isReportsPage()) {
      span.textContent = contestLabel(selectedContestYear);
      btn?.setAttribute('title', 'View contest details');
      btn?.classList.add('is-active');
    } else {
      span.textContent = 'Registrations';
      btn?.removeAttribute('title');
      btn?.classList.remove('is-active');
    }
  }

  function selectContestYear(year) {
    if (!history.some((h) => h.year === year)) return;
    selectedContestYear = year;
    updateRegistrationsTitle();
    populateDufcadFilter();
    renderStats();
    renderApps();
    qEl('reg-year-title')?.closest('.card-table')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function getGlobalDateRange() {
    const monthRange = monthToRange(getGlobalMonth());
    if (!isReportsPage()) return monthRange;
    const fromEl = document.getElementById('quranDateFrom');
    const toEl = document.getElementById('quranDateTo');
    const from = fromEl?.value || '';
    const to = toEl?.value || '';
    if (!from && !to) return monthRange;
    let f = from;
    let t = to;
    if (f && t && f > t) {
      const swap = f;
      f = t;
      t = swap;
    }
    return { from: f, to: t };
  }

  function syncMonthFromDateRange() {
    if (!isReportsPage()) return;
    const fromEl = document.getElementById('quranDateFrom');
    const toEl = document.getElementById('quranDateTo');
    const monthPicker = qEl('globalMonthPicker');
    if (!fromEl || !toEl || !monthPicker) return;
    const from = fromEl.value || '';
    const to = toEl.value || '';
    if (from && to && from.slice(0, 7) === to.slice(0, 7)) {
      monthPicker.value = from.slice(0, 7);
      return;
    }
    if (from && !to) {
      monthPicker.value = from.slice(0, 7);
    }
  }

  function syncReportsBetweenDatesFromMonth() {
    if (!isReportsPage()) return;
    const fromEl = document.getElementById('quranDateFrom');
    const toEl = document.getElementById('quranDateTo');
    if (!fromEl || !toEl) return;
    const { from, to } = monthToRange(getGlobalMonth());
    fromEl.value = from;
    toEl.value = to;
  }

  function setupMonthFilter() {
    const monthPicker = qEl('globalMonthPicker');
    if (!monthPicker) return;
    // Leave empty by default so Contest History shows all; filter only when user picks a month.
    monthPicker.value = '';
    if (monthPicker.dataset.quranBound !== '1') {
      monthPicker.dataset.quranBound = '1';
      monthPicker.addEventListener('change', () => {
        if (isReportsPage()) syncReportsBetweenDatesFromMonth();
        applyGlobalFilters();
      });
    }
  }

  function setupReportsDateFilter() {
    if (!isReportsPage()) return;
    const fromEl = document.getElementById('quranDateFrom');
    const toEl = document.getElementById('quranDateTo');
    if (!fromEl || !toEl) return;
    syncReportsBetweenDatesFromMonth();
    [fromEl, toEl].forEach((el) => {
      if (el.dataset.quranBound === '1') return;
      el.dataset.quranBound = '1';
      el.addEventListener('change', () => {
        syncMonthFromDateRange();
        applyGlobalFilters();
      });
      el.addEventListener('input', () => {
        syncMonthFromDateRange();
        applyGlobalFilters();
      });
    });
  }

  function inDateRange(dateKey, from, to) {
    if (!from && !to) return true;
    if (!dateKey) return false;
    if (from && dateKey < from) return false;
    if (to && dateKey > to) return false;
    return true;
  }

  function historyMatchesDate(h, from, to) {
    if (!from && !to) return true;
    if (h.contest_date) return inDateRange(h.contest_date.slice(0, 10), from, to);
    const yearStart = `${h.year}-01-01`;
    const yearEnd = `${h.year}-12-31`;
    if (from && yearEnd < from) return false;
    if (to && yearStart > to) return false;
    return true;
  }

  function getDateFilteredHistory() {
    const { from, to } = getGlobalDateRange();
    return history.filter((h) => historyMatchesDate(h, from, to));
  }

  function getDateFilteredApps() {
    const { from, to } = getGlobalDateRange();
    return apps.filter((a) => inDateRange(regDateKey(a.created_at), from, to));
  }

  function winnerSelectOptions(regs, selected, sectionLabel) {
    const pool = sectionLabel
      ? (regs || []).filter((r) => r.section_this_year === sectionLabel)
      : (regs || []);
    const names = [...new Set(pool.map((r) => r.full_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    let html = '<option value="">— Select member —</option>';
    names.forEach((name) => {
      html += `<option value="${esc(name)}"${name === selected ? ' selected' : ''}>${esc(name)}</option>`;
    });
    return html;
  }

  const QURAN_SECTION_10 = 'Qeybta 10-ka Jus';
  const QURAN_SECTION_20 = 'Qeybta 20-ka Jus';
  const QURAN_SECTION_30 = 'Qeybta 30-ka Jus';

  function regColCount() {
    return isReportsPage() ? 7 : 8;
  }

  function regFacultyDisplay(a) {
    if (isAlnuurDufcad(a?.convocation)) return emptyLabel();
    const t = (a?.faculty || '').trim();
    return t ? esc(t) : emptyLabel();
  }

  function regSemesterDisplay(a) {
    if (isAlnuurDufcad(a?.convocation)) return emptyLabel();
    const t = (a?.semester || '').trim();
    return t ? esc(t) : emptyLabel();
  }

  function histColCount() {
    return 4;
  }

  function memberAcademicLines(a) {
    if (isAlnuurDufcad(a.convocation)) return '';
    return `
      <p><strong>University:</strong> ${esc(a.university) || '—'}</p>
      <p><strong>Faculty:</strong> ${esc(a.faculty) || '—'}</p>
      <p><strong>Semester:</strong> ${esc(a.semester) || '—'}</p>
    `;
  }

  function detailValue(v) {
    const t = (v || '').trim();
    return t ? esc(t) : '—';
  }

  function renderRegistrationDetailHtml(a) {
    return `
      <div class="qc-reg-detail">
        <p><strong>Full name:</strong> ${detailValue(a.full_name)}</p>
        <p><strong>Email:</strong> ${detailValue(a.email)}</p>
        <p><strong>WhatsApp:</strong> ${detailValue(a.whatsapp)}</p>
        <p><strong>Telephone:</strong> ${detailValue(a.telephone)}</p>
        <p><strong>Dufcad:</strong> ${detailValue(a.convocation)}</p>
        <p><strong>Participated before:</strong> ${detailValue(a.participated_before)}</p>
        <p><strong>Previous section:</strong> ${formatPrevSection(a)}</p>
        <p><strong>Won before:</strong> ${formatWonBefore(a)}</p>
        <p><strong>Section this year:</strong> ${detailValue(a.section_this_year)}</p>
        ${memberAcademicLines(a)}
        <p><strong>Username:</strong> ${detailValue(a.username)}</p>
      </div>`;
  }

  function isAlnuurDufcad(value) {
    return /^al-?nuur$/i.test((value || '').trim());
  }

  function dufcadLabelFromUser(convocation) {
    if (!convocation) return '';
    const m = String(convocation).match(/(\d+)/);
    return m ? `${m[1]}aad` : convocation;
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

  function validateMemberDufcad(memberConvocation, submittedConvocation) {
    if (!memberConvocation || !submittedConvocation) return '';
    const actualLabel = dufcadDisplayFromConvocation(memberConvocation);
    const submittedLabel = dufcadDisplayFromConvocation(submittedConvocation);
    if (isAlnuurDufcad(memberConvocation)) {
      if (!isAlnuurDufcad(submittedConvocation)) {
        return `You are ${actualLabel}. You cannot register as ${submittedLabel}.`;
      }
      return '';
    }
    if (isAlnuurDufcad(submittedConvocation)) {
      return `You are ${actualLabel}. Alnuur registration is handled by admin — contact HSF.`;
    }
    const actual = dufcadKey(memberConvocation);
    const selected = dufcadKey(submittedConvocation);
    if (actual && selected && actual !== selected) {
      return `You are ${actualLabel}. You cannot register as ${submittedLabel}.`;
    }
    return '';
  }

  let addCompetitorMemberConv = '';

  function ensureAddContestYearModal() {
    if (document.getElementById('quranAddYearModal')) return;
    const el = document.createElement('div');
    el.id = 'quranAddYearModal';
    el.className = 'portal-modal-overlay';
    el.innerHTML = `
      <div class="portal-modal-card portal-modal-card--sm">
        <div class="portal-modal-head">
          <h3>Add contest year</h3>
          <button type="button" class="portal-modal-close" id="quranAddYearClose" aria-label="Close">&times;</button>
        </div>
        <p style="font-size:.88rem;color:var(--text-muted);margin:0 0 12px;">Enter contest year or full title (e.g. 2026 or Tartanka Quranka Kareemka ee 2026).</p>
        <div class="filter-group" style="margin-bottom:10px;">
          <label for="quranAddYearInput">Year or title</label>
          <input type="text" id="quranAddYearInput" class="filter-select" style="width:100%" placeholder="2026">
        </div>
        <p id="quranAddYearMsg" style="font-size:.82rem;color:#dc2626;margin:0 0 10px;"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" class="btn btn-outline" id="quranAddYearCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="quranAddYearOk">Add contest</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    const close = () => {
      el.classList.remove('is-open');
      document.getElementById('quranAddYearMsg').textContent = '';
    };
    el.querySelector('#quranAddYearClose')?.addEventListener('click', close);
    el.querySelector('#quranAddYearCancel')?.addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('#quranAddYearOk')?.addEventListener('click', () => el._submit?.());
    el.querySelector('#quranAddYearInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el._submit?.(); }
    });
  }

  async function loadAdminConvocationOptions() {
    const sel = document.getElementById('addCompetitorDufcad');
    if (!sel) return;
    const current = sel.value;
    try {
      const res = await fetchJson('/convocation-options?include_extra=1');
      const options = await res.json();
      sel.innerHTML = '<option value="">— Dooro dufcad —</option>' + (Array.isArray(options) ? options : []).map((o) =>
        `<option value="${esc(o.value)}">${esc(o.label)}</option>`
      ).join('');
      if (current) sel.value = current;
    } catch (e) {
      console.error('Could not load dufcad options', e);
    }
  }

  function syncAddCompetitorPastFields() {
    const pastLocked = isAddCompetitorPastLocked();
    let participated;
    if (pastLocked && addCompetitorPrefill) {
      participated = addCompetitorPrefill.participated_before || 'Maya';
      setParticipatedRadio(participated);
    } else {
      participated = document.querySelector('input[name="addCompetitorParticipated"]:checked')?.value || 'Maya';
    }
    const show = participated === 'Haa';
    const prevWrap = document.getElementById('addCompetitorPrevSectionWrap');
    const wonWrap = document.getElementById('addCompetitorWonBeforeWrap');
    if (prevWrap) prevWrap.hidden = !show;
    if (wonWrap) wonWrap.hidden = !show;
    if (show && pastLocked && addCompetitorPrefill) {
      const prev = document.getElementById('addCompetitorPrevSection');
      const won = document.getElementById('addCompetitorWonBefore');
      if (prev) prev.value = addCompetitorPrefill.previous_section || '';
      if (won) won.value = addCompetitorPrefill.won_before || 'Midna';
    } else if (!show && !pastLocked) {
      const prev = document.getElementById('addCompetitorPrevSection');
      const won = document.getElementById('addCompetitorWonBefore');
      if (prev) prev.value = '';
      if (won) won.value = '';
    }
    const prevSection = show ? (document.getElementById('addCompetitorPrevSection')?.value || '') : '';
    const wonBefore = show ? (document.getElementById('addCompetitorWonBefore')?.value || '') : '';
    syncSectionSelect('addCompetitorSection', 'addCompetitorSectionHint', participated, prevSection, wonBefore, addCompetitorPrefill);
    lockAddCompetitorPastFields(pastLocked);
  }

  function scheduleAddCompetitorEmailLookup() {
    clearTimeout(addCompetitorEmailLookupTimer);
    const convocation = document.getElementById('addCompetitorDufcad')?.value || '';
    if (!isAlnuurDufcad(convocation)) return;

    const email = (document.getElementById('addCompetitorEmail')?.value || '').trim();
    if (!email || !email.includes('@')) {
      addCompetitorEmailResolvedFor = '';
      if (!hasContestHistoryPrefill(addCompetitorPrefill)) {
        addCompetitorPrefill = null;
      }
      setAddCompetitorEmailStatus('', false);
      syncAddCompetitorPastFields();
      return;
    }

    addCompetitorEmailLookupTimer = setTimeout(() => {
      onAddCompetitorEmailLookup();
    }, 400);
  }

  async function onAddCompetitorEmailLookup() {
    const convocation = document.getElementById('addCompetitorDufcad')?.value || '';
    if (!isAlnuurDufcad(convocation)) return;
    if (document.getElementById('addCompetitorUserId')?.value) return;

    const email = (document.getElementById('addCompetitorEmail')?.value || '').trim();
    const emailKey = email.toLowerCase();
    const msgEl = document.getElementById('addCompetitorMsg');
    if (!email || !email.includes('@')) {
      addCompetitorEmailResolvedFor = '';
      return;
    }

    if (emailKey === addCompetitorEmailResolvedFor && !addCompetitorEmailLookupBusy) {
      return;
    }

    addCompetitorEmailLookupBusy = true;
    setAddCompetitorEmailStatus('Checking contest records…', false);
    lockAddCompetitorPastFields(true);

    try {
      const data = await fetchQuranEligibilityByEmail(email);
      addCompetitorEmailResolvedFor = emailKey;

      if (!data || !data.found) {
        if (!hasContestHistoryPrefill(addCompetitorPrefill)) {
          addCompetitorPrefill = null;
        }
        setAddCompetitorEmailStatus(
          'No prior contest records for this email — enter past participation manually.',
          false,
        );
        return;
      }

      if (data.is_hsf_member) {
        if (msgEl) {
          msgEl.style.color = '#dc2626';
          msgEl.textContent = 'This email belongs to an HSF member — search and select them (use their dufcad, not Alnuur).';
        }
        addCompetitorPrefill = null;
        setAddCompetitorEmailStatus('', false);
        return;
      }

      if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.color = '';
      }

      if (data.prefill) {
        applyPrefillToAddCompetitor(data.prefill);
        if (data.user_name && !document.getElementById('addCompetitorName')?.value.trim()) {
          document.getElementById('addCompetitorName').value = data.user_name;
        }
        if (data.has_contest_history) {
          setAddCompetitorEmailStatus(
            `Past participation loaded from records (${email}).`,
            false,
          );
        } else {
          setAddCompetitorEmailStatus(
            'Known email — no prior contest history; enter participation manually.',
            false,
          );
        }
      }
    } finally {
      addCompetitorEmailLookupBusy = false;
      syncAddCompetitorPastFields();
    }
  }

  function syncAddCompetitorAlnuurMode() {
    const convocation = document.getElementById('addCompetitorDufcad')?.value || '';
    const isAlnuur = isAlnuurDufcad(convocation);
    const userId = document.getElementById('addCompetitorUserId')?.value || '';
    const academic = document.getElementById('addCompetitorAcademicFields');
    const searchBlock = document.getElementById('addCompetitorSearchBlock');
    const selEl = document.getElementById('addCompetitorSelected');
    if (academic) academic.hidden = isAlnuur;
    if (searchBlock) searchBlock.hidden = isAlnuur;
    setAddCompetitorPastBlockVisible(isAlnuur || !!userId);
    if (isAlnuur) {
      document.getElementById('addCompetitorUserId').value = '';
      if (!hasContestHistoryPrefill(addCompetitorPrefill)) {
        addCompetitorPrefill = null;
      }
      if (selEl && !hasContestHistoryPrefill(addCompetitorPrefill) && !isAddCompetitorAlnuurEmailPending()) {
        selEl.textContent = 'Alnuur — enter name, email, phone; records load automatically from email.';
        selEl.hidden = false;
        selEl.style.color = 'var(--text-muted)';
      }
      lockAddCompetitorHsfFields(false);
      scheduleAddCompetitorEmailLookup();
    } else {
      lockAddCompetitorHsfFields(!!userId);
      if (selEl && !userId) {
        selEl.hidden = true;
        selEl.textContent = '';
        if (!hasContestHistoryPrefill(addCompetitorPrefill)) {
          addCompetitorPrefill = null;
        }
        lockAddCompetitorPastFields(false);
        setAddCompetitorPastBlockVisible(false);
      }
    }
    syncAddCompetitorPastFields();
  }

  function addCompetitorTargetYear() {
    return selectedContestYear ?? history[0]?.year ?? null;
  }

  function formatRegistrationClosesAt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function contestHistoryRow(year) {
    return history.find((h) => h.year === year);
  }

  function isContestRegistrationClosed(year) {
    return !!contestHistoryRow(year)?.is_ended;
  }

  function quranRegistrationStatusHtml(data, year) {
    if (!data) return '';
    if (data.is_in_grace_period) {
      const when = formatRegistrationClosesAt(data.registration_closes_at);
      return `<p class="summer-program-grace-badge" style="margin-top:1rem;color:var(--warning);">
        <i class="fa-solid fa-clock"></i> All 9 places set — full contest lock ${when ? `at ${esc(when)}` : 'in 6 hours'} (places can still be edited).</p>`;
    }
    if (data.is_ended) {
      return `<p class="summer-program-ended-badge" style="margin-top:1rem;"><i class="fa-solid fa-flag-checkered"></i> Contest ended — registration and winner edits are closed.</p>`;
    }
    return '';
  }

  function updateAddCompetitorYearHint() {
    const el = document.getElementById('addCompetitorYearHint');
    if (!el) return;
    const year = addCompetitorTargetYear();
    if (!year) {
      el.textContent = 'Add a contest in Program History before registering anyone.';
      el.style.color = '#dc2626';
      return;
    }
    el.style.color = '';
    el.textContent = `Registering for ${contestLabel(year)}.`;
  }

  function fillAddCompetitorFromMember(u) {
    const year = addCompetitorTargetYear();
    const existing = memberRegisteredForYear(u.id, year);
    const msgEl = document.getElementById('addCompetitorMsg');
    if (existing) {
      if (msgEl) {
        msgEl.style.color = '#dc2626';
        msgEl.textContent = `${u.name || u.username} is already registered for ${year}.`;
      }
      document.getElementById('addCompetitorUserId').value = '';
      document.getElementById('addCompetitorSelected').hidden = true;
      setAddCompetitorPastBlockVisible(false);
      lockAddCompetitorHsfFields(false);
      return;
    }
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.style.color = '';
    }
    addCompetitorMemberConv = u.convocation || '';
    addCompetitorPrefill = null;
    document.getElementById('addCompetitorUserId').value = u.id || '';
    document.getElementById('addCompetitorName').value = u.name || '';
    document.getElementById('addCompetitorUsername').value = u.username || u.id || '';
    const selEl = document.getElementById('addCompetitorSelected');
    if (selEl) {
      selEl.textContent = `Selected: ${u.name || u.username} (@${u.username || u.id})`;
      selEl.hidden = false;
    }
    lockAddCompetitorHsfFields(false);
    fetchQuranEligibility(u.id).then((prefill) => {
      if (prefill) {
        applyPrefillToAddCompetitor(prefill);
      } else {
        document.getElementById('addCompetitorEmail').value = u.email || '';
        document.getElementById('addCompetitorWhatsapp').value = u.phone || '';
        document.getElementById('addCompetitorTelephone').value = u.phone || '';
        const dufcad = dufcadLabelFromUser(u.convocation);
        const dufSel = document.getElementById('addCompetitorDufcad');
        if (dufSel && dufcad) {
          if (![...dufSel.options].some((o) => o.value === dufcad)) {
            dufSel.add(new Option(dufcad, dufcad));
          }
          dufSel.value = dufcad;
        }
        document.getElementById('addCompetitorUniversity').value = u.university || '';
        document.getElementById('addCompetitorFaculty').value = u.faculty || '';
        document.getElementById('addCompetitorSemester').value = u.isGraduated
          ? 'Graduated'
          : (u.semester || '');
        syncAddCompetitorPastFields();
      }
      lockAddCompetitorHsfFields(true);
      setAddCompetitorPastBlockVisible(true);
    });
    syncAddCompetitorAlnuurMode();
  }

  function fillWinnerSelects(regs, data) {
    const d = data || {};
    const w = d.winners || {};
    const pairs = [
      ['editW10_1', QURAN_SECTION_10, d.winner_juz10_first || w.juz10?.first],
      ['editW10_2', QURAN_SECTION_10, d.winner_juz10_second || w.juz10?.second],
      ['editW10_3', QURAN_SECTION_10, d.winner_juz10_third || w.juz10?.third],
      ['editW20_1', QURAN_SECTION_20, d.winner_juz20_first || w.juz20?.first],
      ['editW20_2', QURAN_SECTION_20, d.winner_juz20_second || w.juz20?.second],
      ['editW20_3', QURAN_SECTION_20, d.winner_juz20_third || w.juz20?.third],
      ['editW30_1', QURAN_SECTION_30, d.winner_juz30_first || w.juz30?.first],
      ['editW30_2', QURAN_SECTION_30, d.winner_juz30_second || w.juz30?.second],
      ['editW30_3', QURAN_SECTION_30, d.winner_juz30_third || w.juz30?.third],
    ];
    pairs.forEach(([id, section, selected]) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = winnerSelectOptions(regs, selected || '', section);
    });
    // Legacy 3-select fallback (reports embed)
    const e1 = document.getElementById('editW1');
    if (e1) {
      e1.innerHTML = winnerSelectOptions(regs, d.winner_juz10_first || d.winner_first || '', QURAN_SECTION_10);
      document.getElementById('editW2').innerHTML = winnerSelectOptions(regs, d.winner_juz10_second || d.winner_second || '', QURAN_SECTION_10);
      document.getElementById('editW3').innerHTML = winnerSelectOptions(regs, d.winner_juz10_third || d.winner_third || '', QURAN_SECTION_10);
    }
  }

  function winnerBlockHtml(title, first, second, third) {
    const slot = (name) => {
      const v = (name || '').trim();
      return v ? esc(v) : emptyLabel();
    };
    return `
      <div class="hsf-program-winners-block">
        <p class="hsf-program-meta-label">${title}</p>
        <div class="hsf-program-winners-grid">
          <div><span>1st</span><strong>${slot(first)}</strong></div>
          <div><span>2nd</span><strong>${slot(second)}</strong></div>
          <div><span>3rd</span><strong>${slot(third)}</strong></div>
        </div>
      </div>
    `;
  }

  function renderContestViewPanel(data, year) {
    const place = (data.place || '').trim();
    return `
      <div class="hsf-program-modal-body">
        ${contestModalBrandHtml(year)}
        <div class="hsf-program-place-card">
          <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
          <div>
            <span class="hsf-program-meta-label">Place</span>
            <strong class="hsf-program-place-name">${place ? esc(place) : emptyLabel()}</strong>
          </div>
        </div>
        <div class="hsf-program-meta-grid">
          <div class="hsf-program-meta-item">
            <span class="hsf-program-meta-label">Contest date</span>
            <strong>${programDateDisplay(data)}</strong>
          </div>
          <div class="hsf-program-meta-item">
            <span class="hsf-program-meta-label">Registrations</span>
            <strong>${data.registration_count ?? data.total_competitors ?? 0}</strong>
          </div>
        </div>
        ${winnerBlockHtml('10 Juz', data.winner_juz10_first || data.winner_first, data.winner_juz10_second, data.winner_juz10_third)}
        ${winnerBlockHtml('20 Juz', data.winner_juz20_first || data.winner_second, data.winner_juz20_second, data.winner_juz20_third)}
        ${winnerBlockHtml('30 Juz', data.winner_juz30_first || data.winner_third, data.winner_juz30_second, data.winner_juz30_third)}
        ${quranRegistrationStatusHtml(data, year)}
      </div>`;
  }

  function getReportExportDateLabel() {
    if (!isReportsPage()) return '';
    const { from, to } = getGlobalDateRange();
    if (from && to && from !== to) return `${fmtDate(from)} – ${fmtDate(to)}`;
    if (from) return fmtDate(from);
    const month = getGlobalMonth();
    if (!month) return '';
    const d = new Date(`${month}-01T12:00:00`);
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  function contestRowExportHtml(year) {
    return `
      <div class="export-dropdown contest-row-export">
        <button type="button" class="btn btn-outline btn-sm export-btn" title="Export full contest report">
          <i class="fa-solid fa-file-export"></i> Export
        </button>
        <div class="export-options">
          <div class="export-item" data-export-action="print" data-contest-year="${year}"><i class="fa-solid fa-print"></i> Print</div>
          <div class="export-item" data-export-action="image" data-contest-year="${year}"><i class="fa-solid fa-image"></i> Download Image</div>
          <div class="export-item" data-export-action="pdf" data-contest-year="${year}"><i class="fa-solid fa-file-pdf"></i> Preview PDF</div>
        </div>
      </div>`;
  }

  function bindContestRowExports() {
    if (!isReportsPage() || typeof ReportExport === 'undefined') return;
    document.querySelectorAll('#historyBody .contest-row-export').forEach((wrap) => {
      const toggle = wrap.querySelector('.export-btn');
      const menu = wrap.querySelector('.export-options');
      if (!toggle || !menu || wrap.dataset.exportBound === '1') return;
      wrap.dataset.exportBound = '1';
      ReportExport.initDropdown(toggle, menu);
      menu.querySelectorAll('.export-item').forEach((item) => {
        item.addEventListener('click', async () => {
          if (typeof ReportExport.closeAllDropdowns === 'function') {
            ReportExport.closeAllDropdowns();
          } else {
            menu.classList.remove('active');
          }
          const action = item.dataset.exportAction;
          const year = parseInt(item.dataset.contestYear, 10);
          if (year) await exportContest(year, action);
        });
      });
    });
  }

  function contestActionBtns(year) {
    if (isReportsPage()) {
      return `<div class="contest-history-actions">${contestRowExportHtml(year)}</div>`;
    }
    return `<div class="contest-history-actions">
      <button type="button" class="contest-icon-btn view" title="View" onclick="QuranContestAdmin.viewContest(${year})"><i class="fa-solid fa-eye"></i></button>
      <button type="button" class="contest-icon-btn edit" title="Edit" onclick="QuranContestAdmin.editContest(${year})"><i class="fa-solid fa-pen"></i></button>
      <button type="button" class="contest-icon-btn danger" title="Delete" onclick="QuranContestAdmin.deleteContest(${year})"><i class="fa-solid fa-trash"></i></button>
    </div>`;
  }

  function regActionBtns(id) {
    if (isReportsPage()) return '';
    return `<div class="contest-history-actions">
      <button type="button" class="contest-icon-btn view" title="View" onclick="QuranContestAdmin.showDetail(${id})"><i class="fa-solid fa-eye"></i></button>
      <button type="button" class="contest-icon-btn edit" title="Edit" onclick="QuranContestAdmin.editRegistration(${id})"><i class="fa-solid fa-pen"></i></button>
      <button type="button" class="contest-icon-btn danger" title="Delete" onclick="QuranContestAdmin.deleteRegistration(${id})"><i class="fa-solid fa-trash"></i></button>
    </div>`;
  }

  function syncRegActionColumnVisibility() {
    document.querySelectorAll('.applications-registrations-table thead th.reg-action-col').forEach((th) => {
      th.style.display = isReportsPage() ? 'none' : '';
    });
  }

  function exposeCloseGlobals() {
    global.closeContestModal = () => closeModal('contestModal');
    global.closeDetail = () => closeModal('detailModal');
    global.closeRegEdit = () => closeModal('regEditModal');
  }

  function bindModalCloses() {
    exposeCloseGlobals();
    [
      { id: 'detailModal', close: () => closeModal('detailModal') },
      { id: 'contestModal', close: () => closeModal('contestModal') },
      { id: 'regEditModal', close: () => closeModal('regEditModal') },
    ].forEach(({ id, close }) => {
      const modal = document.getElementById(id);
      if (!modal || modal.dataset.quranCloseBound === '1') return;
      modal.dataset.quranCloseBound = '1';
      modal.querySelector('.portal-modal-close')?.addEventListener('click', (e) => {
        e.preventDefault();
        close();
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
    });
    if (!global._quranModalEscBound) {
      global._quranModalEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        ['detailModal', 'contestModal', 'regEditModal', 'contestExportModal'].forEach((id) => {
          const modal = document.getElementById(id);
          if (modal?.classList.contains('is-open')) closeModal(id);
        });
      });
    }
  }

  function openModal(id) {
    document.getElementById(id)?.classList.add('is-open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('is-open');
  }

  function updateGlobalDateHint() {
    const hint = qEl('globalDateHint');
    if (!hint) return;
    if (isReportsPage()) {
      hint.textContent = '';
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    const month = getGlobalMonth();
    if (!month) {
      hint.textContent = '';
      return;
    }
    const d = new Date(`${month}-01T12:00:00`);
    hint.textContent = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  function normalizeClosedMessage(text) {
    const t = (text || '').trim();
    if (!t || /^(open|closed)$/i.test(t)) return QURAN_CLOSED_DEFAULT;
    return t;
  }

  function publicApiBase() {
    const base = (typeof API_BASE !== 'undefined' && API_BASE)
      ? API_BASE.replace(/\/api\/?$/, '')
      : 'http://127.0.0.1:5000';
    return base.replace(/\/$/, '');
  }

  async function refreshRegistrationGate() {
    try {
      const res = await fetch(`${publicApiBase()}/api/public/applications/form-status`);
      const data = await res.json();
      const qc = data.quran_contest || {};
      registrationOpen = !!qc.open;
      registrationClosedMessage = normalizeClosedMessage(qc.closed_message);
    } catch (e) {
      registrationOpen = !!document.getElementById('toggleQuranOpen')?.checked;
      registrationClosedMessage = normalizeClosedMessage(
        document.getElementById('quranClosedMessage')?.value,
      );
    }
    const banner = document.getElementById('quranRegClosedBanner');
    const bannerText = document.getElementById('quranRegClosedBannerText');
    if (banner && bannerText) {
      if (!registrationOpen) {
        bannerText.textContent = registrationClosedMessage;
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
        bannerText.textContent = '';
      }
    }
  }

  function toggleQuranFormFields() {
    const open = !!document.getElementById('toggleQuranOpen')?.checked;
    const openFields = document.getElementById('quranFormOpenFields');
    const closedFields = document.getElementById('quranFormClosedFields');
    if (openFields) openFields.hidden = !open;
    if (closedFields) closedFields.hidden = open;
    renderHistory();
    refreshRegistrationGate();
  }

  function buildContestReportHtml(data, year) {
    const regs = data.registrations || [];
    const rows = regs.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(r.full_name)}</td>
        <td>${esc(r.convocation)}</td>
        <td>${esc(r.section_this_year)}</td>
        <td>${regFacultyDisplay(r)}</td>
        <td>${regSemesterDisplay(r)}</td>
        <td>${reportPreviousSection(r)}</td>
        <td>${reportWonBeforePlace(r)}</td>
        <td>${esc(r.whatsapp)}</td>
        <td>${esc(r.telephone)}</td>
        <td>${esc(r.email)}</td>
      </tr>
    `).join('');
    return `
      <div class="contest-report-sheet">
        <h2><i class="fa-solid fa-book-quran"></i> ${contestLabel(year)}</h2>
        <p style="color:#64748b;margin:0 0 16px;font-size:.85rem;">Generated ${new Date().toLocaleString()}</p>
        <p><strong>Contest date:</strong> ${fmtDate(data.contest_date)}</p>
        <p><strong>Place:</strong> ${esc(data.place) || emptyLabel()}</p>
        <p><strong>Total competitors:</strong> ${data.total_competitors ?? regs.length}</p>
        <h3>Winners by section</h3>
        ${winnerBlockHtml('10 Juz', data.winner_juz10_first || data.winner_first, data.winner_juz10_second, data.winner_juz10_third)}
        ${winnerBlockHtml('20 Juz', data.winner_juz20_first || data.winner_second, data.winner_juz20_second, data.winner_juz20_third)}
        ${winnerBlockHtml('30 Juz', data.winner_juz30_first || data.winner_third, data.winner_juz30_second, data.winner_juz30_third)}
        <h3>All Participants (${regs.length})</h3>
        <div class="contest-report-participants-wrap">
        <table class="contest-report-participants-table contest-report-participants-table--quran">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Dufcad</th>
              <th>Section</th>
              <th>Faculty</th>
              <th>Semester</th>
              <th>Prev. section</th>
              <th>Won before</th>
              <th>WhatsApp</th>
              <th>Phone</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="11">No registrations</td></tr>'}</tbody>
        </table>
        </div>
      </div>
    `;
  }

  function ensureContestExportModal() {
    if (document.getElementById('contestExportModal')) return;
    const el = document.createElement('div');
    el.id = 'contestExportModal';
    el.className = 'portal-modal-overlay';
    el.style.zIndex = '3002';
    el.innerHTML = `
      <div class="portal-modal-card portal-modal-card--sm">
        <div class="portal-modal-head">
          <h3 id="contestExportTitle">Export contest report</h3>
          <button type="button" class="portal-modal-close" id="contestExportClose" aria-label="Close">&times;</button>
        </div>
        <p style="font-size:.88rem;color:var(--text-muted);margin:0 0 14px;">Full report with top 3 winners and all participants.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="btn btn-outline" data-contest-export-action="print"><i class="fa-solid fa-print"></i> Print</button>
          <button type="button" class="btn btn-outline" data-contest-export-action="image"><i class="fa-solid fa-image"></i> Download Image</button>
          <button type="button" class="btn btn-primary" data-contest-export-action="pdf"><i class="fa-solid fa-file-pdf"></i> Preview PDF</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    el.querySelector('#contestExportClose')?.addEventListener('click', () => closeModal('contestExportModal'));
    el.addEventListener('click', (e) => { if (e.target === el) closeModal('contestExportModal'); });
    el.querySelectorAll('[data-contest-export-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.contestExportAction;
        const year = el.dataset.year;
        if (year) exportContest(parseInt(year, 10), action);
        closeModal('contestExportModal');
      });
    });
  }

  async function buildWholeReportElement() {
    const rows = getDateFilteredHistory();
    if (!rows.length) return null;
    const bundle = document.createElement('div');
    bundle.className = 'quran-whole-report-bundle';
    const dataList = await Promise.all(rows.map((h) => fetchContest(h.year)));
    rows.forEach((h, i) => {
      const fragment = document.createElement('div');
      fragment.innerHTML = buildContestReportHtml(dataList[i], h.year);
      const sheet = fragment.firstElementChild;
      if (sheet) bundle.appendChild(sheet);
    });
    return bundle;
  }

  async function exportWholeReport(action) {
    if (!isReportsPage()) return;
    if (typeof ReportExport === 'undefined') {
      alert('Export is not available on this page.');
      return;
    }
    const rows = getDateFilteredHistory();
    if (!rows.length) {
      alert('No contests in this date range to export.');
      return;
    }
    let sheet;
    try {
      sheet = await buildWholeReportElement();
    } catch (e) {
      console.error('Whole Quran report export failed', e);
      alert('Could not load contest data for export.');
      return;
    }
    if (!sheet) return;
    const base = (getReportExportDateLabel() || 'Quran_Contest_Report').replace(/[^\w\-]+/g, '_').slice(0, 80);
    const title = getReportExportDateLabel()
      ? `Quran Contest — ${getReportExportDateLabel()}`
      : 'Quran Contest Report';
    if (action === 'pdf') {
      await ReportExport.previewBeforeDownload(sheet, base, title);
      return;
    }
    document.body.appendChild(sheet);
    try {
      if (action === 'print') await ReportExport.printElement(sheet);
      else if (action === 'image') await ReportExport.downloadImage(sheet, base);
    } finally {
      document.body.removeChild(sheet);
    }
  }

  async function exportContest(year, action) {
    if (typeof ReportExport === 'undefined') {
      alert('Export is not available on this page.');
      return;
    }
    const data = await fetchContest(year);
    const host = document.createElement('div');
    host.innerHTML = buildContestReportHtml(data, year);
    const sheet = host.firstElementChild;
    const base = `Quran_Contest_${year}`;
    if (action === 'pdf') {
      await ReportExport.previewBeforeDownload(sheet, base, contestLabel(year));
      return;
    }
    document.body.appendChild(sheet);
    try {
      if (action === 'print') await ReportExport.printElement(sheet);
      else if (action === 'image') await ReportExport.downloadImage(sheet, base);
    } finally {
      document.body.removeChild(sheet);
    }
  }

  function renderStats() {
    const el = qEl('quran-stats');
    if (!el) return;
    const totalContests = history.length;
    const totalCompetitors = appsLinkedToAdminPrograms(false).length;
    const registrations = currentContestRegistrations();
    el.innerHTML = `
      <div class="stat-card"><div class="stat-icon icon-green"><i class="fa-solid fa-trophy"></i></div><div class="stat-info"><h4>${totalContests}</h4><p>Total contests</p><small style="color:var(--text-muted);font-size:.72rem;">Ever made</small></div></div>
      <div class="stat-card"><div class="stat-icon icon-blue"><i class="fa-solid fa-users"></i></div><div class="stat-info"><h4>${totalCompetitors}</h4><p>Total competitors</p><small style="color:var(--text-muted);font-size:.72rem;">Ever competed</small></div></div>
      <div class="stat-card"><div class="stat-icon icon-orange"><i class="fa-solid fa-calendar"></i></div><div class="stat-info"><h4>${registrations}</h4><p>Registrations</p><small style="color:var(--text-muted);font-size:.72rem;">Current contest</small></div></div>
    `;
  }

  function renderHistory() {
    const tbody = qEl('historyBody');
    if (!tbody) return;
    if (!history.length) {
      const emptyMsg = isReportsPage()
        ? 'No contests yet.'
        : 'No contests yet. Click <strong>Add contest</strong> above.';
      tbody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">${emptyMsg}</td></tr>`;
      return;
    }
    const rows = getDateFilteredHistory();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">No contests in this date range.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((h) => `
      <tr class="${selectedContestYear === h.year ? 'hsf-program-row--selected' : ''}" style="border-bottom:1px solid var(--border);">
        <td style="padding:10px;font-weight:700;">${contestNameCell(h.year)}</td>
        <td style="padding:10px;font-size:.82rem;">${fmtDate(h.contest_date)}</td>
        <td style="padding:10px;">${h.total_competitors ?? 0}</td>
        <td class="reg-action-col no-print" style="padding:10px;">${contestActionBtns(h.year)}</td>
      </tr>
    `).join('');
    syncRegActionColumnVisibility();
    bindContestRowExports();
  }

  function populateDufcadFilter() {
    const sel = qEl('filterDufcad');
    if (!sel) return;
    const current = sel.value;
    const dufcads = [...new Set(getContestYearApps().map((a) => a.convocation).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = '<option value="">All dufcad</option>' + dufcads.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    if (current && dufcads.includes(current)) sel.value = current;
  }

  function getFilteredApps() {
    const q = (qEl('filterSearch')?.value || '').trim().toLowerCase();
    const section = qEl('filterSection')?.value || '';
    const dufcad = qEl('filterDufcad')?.value || '';
    const base = getContestYearApps();
    return base.filter((a) => {
      if (q && !(a.full_name || '').toLowerCase().includes(q) && !(a.username || '').toLowerCase().includes(q)) return false;
      if (section && a.section_this_year !== section) return false;
      if (dufcad && a.convocation !== dufcad) return false;
      return true;
    });
  }

  function renderApps() {
    const tbody = qEl('appsBody');
    if (!tbody) return;
    if (!history.length && !isReportsPage()) {
      tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">No contest yet. Click <strong>Add contest</strong> above, then add competitors.</td></tr>`;
      return;
    }
    const base = getContestYearApps();
    const filtered = getFilteredApps();
    const yearHint = selectedContestYear && !isReportsPage() ? ` for ${contestLabel(selectedContestYear)}` : '';
    const emptyScope = selectedContestYear && !isReportsPage() ? '' : ' in this date range';
    if (!base.length) {
      tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">No registrations${yearHint}${emptyScope}.</td></tr>`;
      return;
    }
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">No registrations${yearHint} match your filters.</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map((a) => `
      <tr style="border-bottom:1px solid var(--border);${!a.is_read ? 'background:rgba(44,122,77,.06);' : ''}">
        <td class="reg-col-date">${fmtDate(a.created_at)}</td>
        <td class="reg-col-name">${esc(a.full_name)}</td>
        <td class="reg-col-dufcad">${esc(a.convocation)}</td>
        <td class="reg-col-section">${esc(a.section_this_year)}</td>
        <td class="reg-col-faculty">${regFacultyDisplay(a)}</td>
        <td class="reg-col-semester">${regSemesterDisplay(a)}</td>
        <td class="reg-col-status">${a.is_read ? '<span style="color:#64748b">Read</span>' : '<span style="color:#2c7a4d;font-weight:700">New</span>'}</td>
        ${isReportsPage() ? '' : `<td class="reg-action-col">${regActionBtns(a.id)}</td>`}
      </tr>
    `).join('');
    syncRegActionColumnVisibility();
  }

  function applyGlobalFilters() {
    try {
      updateGlobalDateHint();
      renderStats();
      renderHistory();
      if (!isReportsPage()) {
        updateRegistrationsTitle();
        populateDufcadFilter();
        renderApps();
      }
    } catch (err) {
      console.error('Quran contest filters failed', err);
      showLoadError();
    }
  }

  function showLoadError() {
    const tbody = qEl('appsBody');
    const histBody = qEl('historyBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:#dc2626;">Could not display data.</td></tr>`;
    if (histBody) histBody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:#dc2626;">Could not display history.</td></tr>`;
  }

  async function fetchJson(path, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${getApi()}${path}`, { ...opts, signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadFormSettings() {
    if (!document.getElementById('toggleQuranOpen')) return;
    const res = await fetchJson('/form-settings');
    const s = await res.json();
    document.getElementById('toggleQuranOpen').checked = !!s.quran_contest_open;
    const retryEl = document.getElementById('toggleQuranSameSectionRetry');
    allowSameSectionRetryBelow30 = !!s.quran_allow_same_section_retry_below_30;
    if (retryEl) retryEl.checked = allowSameSectionRetryBelow30;
    document.getElementById('quranHeadline').value = s.quran_headline || 'Quran Contest Registration';
    document.getElementById('quranSubtitle').value = s.quran_subtitle || 'Naadiga Ardayda Deeqda Waxbarasho HSF';
    document.getElementById('quranDeadlineMessage').value = s.quran_deadline_message || '';
    const closedEl = document.getElementById('quranClosedMessage');
    if (closedEl) {
      closedEl.value = normalizeClosedMessage(s.quran_closed_message || '');
    }
    toggleQuranFormFields();
    await refreshRegistrationGate();
  }

  async function saveFormSettings() {
    const res = await fetchJson('/form-settings');
    const current = await res.json();
    const closedRaw = document.getElementById('quranClosedMessage')?.value.trim() || '';
    const retryEl = document.getElementById('toggleQuranSameSectionRetry');
    allowSameSectionRetryBelow30 = !!(retryEl && retryEl.checked);
    await fetchJson('/form-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...current,
        quran_contest_open: document.getElementById('toggleQuranOpen').checked,
        quran_allow_same_section_retry_below_30: allowSameSectionRetryBelow30,
        quran_headline: document.getElementById('quranHeadline').value.trim() || 'Quran Contest Registration',
        quran_subtitle: document.getElementById('quranSubtitle').value.trim() || 'Naadiga Ardayda Deeqda Waxbarasho HSF',
        quran_deadline_message: document.getElementById('quranDeadlineMessage').value.trim(),
        quran_closed_message: closedRaw || QURAN_CLOSED_DEFAULT,
      }),
    });
    toggleQuranFormFields();
    await refreshRegistrationGate();
    const msg = document.getElementById('formSettingsMsg');
    if (msg) {
      msg.textContent = 'Saved.';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    }
  }

  async function loadAllData() {
    const tbody = qEl('appsBody');
    const histBody = qEl('historyBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">Loading…</td></tr>`;
    if (histBody) histBody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">Loading…</td></tr>`;
    try {
      const [appsRes, histRes] = await Promise.all([
        fetchJson('/quran-contest'),
        fetchJson('/quran-contest/years-history'),
      ]);
      if (!appsRes.ok || !histRes.ok) throw new Error('API error');
      apps = await appsRes.json();
      history = await histRes.json();
      if (!Array.isArray(apps)) apps = [];
      if (!Array.isArray(history)) history = [];
      if (history.length) {
        const years = history.map((h) => h.year);
        if (selectedContestYear == null || !years.includes(selectedContestYear)) {
          selectedContestYear = history[0].year;
        }
      } else {
        selectedContestYear = null;
      }
      applyGlobalFilters();
    } catch (e) {
      console.error('Quran contest load failed', e);
      const msg = e?.name === 'AbortError'
        ? 'Request timed out. Is the backend running on port 5000?'
        : 'Could not load data. Check the backend connection.';
      if (tbody) tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:#dc2626;">${msg}</td></tr>`;
      if (histBody) histBody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:#dc2626;">${msg}</td></tr>`;
    }
  }

  async function fetchContest(year) {
    const res = await fetchJson(`/quran-contest/years/${year}`);
    return res.json();
  }

  async function promptAddContestYear() {
    ensureAddContestYearModal();
    const modal = document.getElementById('quranAddYearModal');
    const input = document.getElementById('quranAddYearInput');
    const msgEl = document.getElementById('quranAddYearMsg');
    input.value = '';
    msgEl.textContent = '';
    modal.classList.add('is-open');
    setTimeout(() => input.focus(), 50);
    modal._submit = async () => {
      msgEl.textContent = '';
      const value = String(input.value || '').trim();
      if (!value) {
        msgEl.textContent = 'Enter a year or contest title.';
        return;
      }
      const res = await fetchJson('/quran-contest/years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.textContent = data.error || 'Could not add contest year.';
        return;
      }
      modal.classList.remove('is-open');
      await loadAllData();
    };
  }

  let memberSearchCache = null;

  async function loadMemberSearchCache() {
    if (memberSearchCache) return memberSearchCache;
    if (typeof getUsers === 'function') {
      memberSearchCache = await getUsers();
      return memberSearchCache;
    }
    memberSearchCache = [];
    return memberSearchCache;
  }

  function renderMemberSearchResults(q) {
    const host = document.getElementById('addCompetitorResults');
    if (!host) return;
    const ql = (q || '').trim().toLowerCase();
    if (!ql || ql.length < 2) {
      host.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted);margin:0;">Type at least 2 characters to search members.</p>';
      return;
    }
    loadMemberSearchCache().then((users) => {
      const matches = users.filter((u) => {
        const name = (u.name || '').toLowerCase();
        const user = (u.username || u.id || '').toLowerCase();
        return name.includes(ql) || user.includes(ql);
      }).slice(0, 15);
      if (!matches.length) {
        host.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted);margin:0;">No members found.</p>';
        return;
      }
      host.innerHTML = matches.map((u) => `
        <button type="button" class="btn btn-outline btn-sm qc-admin-search-hit"
          data-user-id="${esc(u.id)}" data-user-name="${esc(u.name || '')}" data-user-phone="${esc(u.phone || '')}"
          data-user-conv="${esc(u.convocation || '')}" data-user-email="${esc(u.email || '')}"
          data-user-university="${esc(u.university || '')}" data-user-faculty="${esc(u.faculty || '')}"
          data-user-semester="${esc(u.isGraduated ? 'Graduated' : (u.semester || ''))}"
          data-user-graduated="${u.isGraduated ? '1' : '0'}" data-user-username="${esc(u.username || '')}">
          <strong>${esc(u.name || u.username)}</strong> <span style="color:var(--text-muted);">@${esc(u.username || u.id)}</span>
        </button>
      `).join('');
      host.querySelectorAll('[data-user-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          fillAddCompetitorFromMember({
            id: btn.dataset.userId,
            name: btn.dataset.userName,
            phone: btn.dataset.userPhone,
            convocation: btn.dataset.userConv,
            email: btn.dataset.userEmail,
            university: btn.dataset.userUniversity,
            faculty: btn.dataset.userFaculty,
            semester: btn.dataset.userSemester,
            isGraduated: btn.dataset.userGraduated === '1',
            username: btn.dataset.userUsername,
          });
          host.innerHTML = '';
        });
      });
    });
  }

  function bindEvents() {
    if (eventsBound) return;

    ensureContestExportModal();
    bindModalCloses();
    setupMonthFilter();
    setupReportsDateFilter();

    const toggleOpen = document.getElementById('toggleQuranOpen');
    if (toggleOpen) toggleOpen.addEventListener('change', toggleQuranFormFields);

    ['filterSearch', 'filterSection', 'filterDufcad'].forEach((id) => {
      const el = qEl(id);
      if (!el) return;
      el.addEventListener('input', renderApps);
      el.addEventListener('change', renderApps);
    });

    const contestForm = document.getElementById('contestEditForm');
    if (contestForm) contestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const year = parseInt(document.getElementById('editYear').value, 10);
      const payload = {
        title: document.getElementById('editTitle')?.value.trim() || '',
        contest_date: document.getElementById('editDate').value,
        place: document.getElementById('editPlace').value.trim(),
      };
      [
        ['winner_juz10_first', 'editW10_1'], ['winner_juz10_second', 'editW10_2'], ['winner_juz10_third', 'editW10_3'],
        ['winner_juz20_first', 'editW20_1'], ['winner_juz20_second', 'editW20_2'], ['winner_juz20_third', 'editW20_3'],
        ['winner_juz30_first', 'editW30_1'], ['winner_juz30_second', 'editW30_2'], ['winner_juz30_third', 'editW30_3'],
      ].forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) payload[key] = el.value.trim();
      });
      if (!document.getElementById('editW10_1') && document.getElementById('editW1')) {
        payload.winner_juz10_first = document.getElementById('editW1').value.trim();
        payload.winner_juz10_second = document.getElementById('editW2').value.trim();
        payload.winner_juz10_third = document.getElementById('editW3').value.trim();
      }
      const res = await fetchJson(`/quran-contest/years/${year}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || 'Could not save.');
        return;
      }
      closeModal('contestModal');
      await loadAllData();
    });

    const regParticipated = document.getElementById('regEditParticipated');
    if (regParticipated) regParticipated.addEventListener('change', syncRegEditPastFields);
    bindPastSectionListeners([
      { id: 'regEditPrevSection', handler: syncRegEditPastFields },
      { id: 'regEditWonBefore', handler: syncRegEditPastFields },
      { id: 'addCompetitorPrevSection', handler: syncAddCompetitorPastFields },
      { id: 'addCompetitorWonBefore', handler: syncAddCompetitorPastFields },
    ]);

    const regForm = document.getElementById('regEditForm');
    if (regForm) regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = parseInt(document.getElementById('regEditId').value, 10);
      const msgEl = document.getElementById('regEditMsg');
      msgEl.textContent = '';
      const participated = document.getElementById('regEditParticipated')?.value || 'Maya';
      const prevSection = participated === 'Haa' ? (document.getElementById('regEditPrevSection')?.value || '') : '';
      const wonBefore = participated === 'Haa' ? (document.getElementById('regEditWonBefore')?.value || '') : '';
      const section = document.getElementById('regEditSection')?.value || '';
      if (regEditPrefill?.permanently_ineligible) {
        msgEl.style.color = '#dc2626';
        msgEl.textContent = QURAN_REG_MSG.juz30First;
        return;
      }
      const allowed = allowedSectionsForPast(participated, prevSection, wonBefore, regEditPrefill);
      if (section && !allowed.some((s) => s.value === section)) {
        msgEl.style.color = '#dc2626';
        msgEl.textContent = sectionEligibilityHint(participated, prevSection, wonBefore, regEditPrefill)
          || QURAN_REG_MSG.notEligible;
        return;
      }
      const res = await fetchJson(`/quran-contest/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regEditPayload()),
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.style.color = '#dc2626';
        msgEl.textContent = data.error || 'Could not save.';
        return;
      }
      closeModal('regEditModal');
      await loadAllData();
      showQuranFlash(data.message || QURAN_REG_MSG.success, 'success');
    });

    const addCompetitorForm = document.getElementById('addCompetitorForm');
    if (addCompetitorForm) addCompetitorForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = document.getElementById('addCompetitorMsg');
      if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.color = '';
      }
      const userId = document.getElementById('addCompetitorUserId')?.value || '';
      const convocation = document.getElementById('addCompetitorDufcad')?.value.trim() || '';
      const email = document.getElementById('addCompetitorEmail')?.value.trim() || '';
      const isAlnuur = isAlnuurDufcad(convocation);
      const pastLocked = isAddCompetitorPastLocked() && addCompetitorPrefill;
      const participated = pastLocked
        ? (addCompetitorPrefill.participated_before || 'Maya')
        : (document.querySelector('input[name="addCompetitorParticipated"]:checked')?.value || 'Maya');
      const year = addCompetitorTargetYear();
      if (!year) {
        if (msgEl) msgEl.textContent = 'Add a contest in Program History first.';
        return;
      }
      if (isContestRegistrationClosed(year)) {
        if (msgEl) {
          msgEl.style.color = '#dc2626';
          msgEl.textContent = 'This Quran contest has ended. Create a new contest year for more registrations.';
        }
        return;
      }
      if (isAlnuur && userId && !String(userId).startsWith('alnuur-')) {
        if (msgEl) {
          msgEl.style.color = '#dc2626';
          msgEl.textContent = 'This person is already in the member system and is not from Alnuur. Use their HSF dufcad, or clear the member and register Alnuur manually.';
        }
        return;
      }
      if (!userId && !isAlnuur) {
        if (msgEl) msgEl.textContent = 'Search and select a member, or choose Alnuur for manual registration.';
        return;
      }
      if (userId && !isAlnuur && addCompetitorMemberConv) {
        const dufcadErr = validateMemberDufcad(addCompetitorMemberConv, convocation);
        if (dufcadErr) {
          if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = dufcadErr;
          }
          return;
        }
      }
      const section = document.getElementById('addCompetitorSection')?.value || '';
      if (!section) {
        if (msgEl) msgEl.textContent = 'Choose section: 10, 20, or 30 Juz.';
        return;
      }
      const prevSection = participated === 'Haa'
        ? (pastLocked ? (addCompetitorPrefill.previous_section || '') : (document.getElementById('addCompetitorPrevSection')?.value || ''))
        : '';
      const wonBefore = participated === 'Haa'
        ? (pastLocked ? (addCompetitorPrefill.won_before || '') : (document.getElementById('addCompetitorWonBefore')?.value || ''))
        : '';
      if (addCompetitorPrefill?.permanently_ineligible) {
        if (msgEl) {
          msgEl.style.color = '#dc2626';
          msgEl.textContent = QURAN_REG_MSG.juz30First;
        }
        return;
      }
      const allowed = allowedSectionsForPast(participated, prevSection, wonBefore, addCompetitorPrefill);
      if (!allowed.some((s) => s.value === section)) {
        if (msgEl) {
          msgEl.style.color = '#dc2626';
          msgEl.textContent = sectionEligibilityHint(participated, prevSection, wonBefore, addCompetitorPrefill)
            || QURAN_REG_MSG.notEligible;
        }
        return;
      }
      const payload = {
        user_id: userId || undefined,
        year,
        full_name: document.getElementById('addCompetitorName')?.value.trim(),
        email,
        whatsapp: document.getElementById('addCompetitorWhatsapp')?.value.trim(),
        telephone: document.getElementById('addCompetitorTelephone')?.value.trim(),
        convocation,
        section_this_year: section,
        participated_before: participated,
        previous_section: participated === 'Haa' ? (prevSection || null) : null,
        won_before: participated === 'Haa' ? (wonBefore || null) : null,
      };
      if (!isAlnuur) {
        Object.assign(payload, {
          university: document.getElementById('addCompetitorUniversity')?.value.trim(),
          faculty: document.getElementById('addCompetitorFaculty')?.value.trim(),
          semester: document.getElementById('addCompetitorSemester')?.value.trim(),
        });
      }
      const res = await fetchJson('/quran-contest/admin-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (msgEl) {
          msgEl.style.color = '#dc2626';
          msgEl.textContent = data.error || 'Could not register.';
        }
        return;
      }
      closeModal('addCompetitorModal');
      await loadAllData();
      showQuranFlash(data.message || QURAN_REG_MSG.success, 'success');
    });

    document.querySelectorAll('input[name="addCompetitorParticipated"]').forEach((el) => {
      el.addEventListener('change', () => {
        if (isAddCompetitorAlnuurEmailPending()) {
          onAddCompetitorEmailLookup();
          return;
        }
        syncAddCompetitorPastFields();
      });
    });

    const addCompetitorDufcad = document.getElementById('addCompetitorDufcad');
    if (addCompetitorDufcad) {
      addCompetitorDufcad.addEventListener('change', () => {
        if (!isAlnuurDufcad(addCompetitorDufcad.value) && !hasContestHistoryPrefill(addCompetitorPrefill)) {
          addCompetitorPrefill = null;
          addCompetitorEmailResolvedFor = '';
        }
        syncAddCompetitorAlnuurMode();
        scheduleAddCompetitorEmailLookup();
      });
    }

    const addCompetitorEmail = document.getElementById('addCompetitorEmail');
    if (addCompetitorEmail) {
      addCompetitorEmail.addEventListener('blur', onAddCompetitorEmailLookup);
      addCompetitorEmail.addEventListener('input', () => {
        const emailKey = (addCompetitorEmail.value || '').trim().toLowerCase();
        if (emailKey !== addCompetitorEmailResolvedFor && !hasContestHistoryPrefill(addCompetitorPrefill)) {
          addCompetitorPrefill = null;
        }
        scheduleAddCompetitorEmailLookup();
      });
    }

    const addCompetitorSearch = document.getElementById('addCompetitorSearch');
    if (addCompetitorSearch) {
      addCompetitorSearch.addEventListener('input', () => renderMemberSearchResults(addCompetitorSearch.value));
    }

    eventsBound = true;
  }

  global.QuranContestAdmin = {
    init(opts = {}) {
      bindEvents();
      setupMonthFilter();
      setupReportsDateFilter();
      if (opts.loadFormSettings !== false) loadFormSettings();
      return loadAllData();
    },
    async refresh() {
      setupMonthFilter();
      setupReportsDateFilter();
      return loadAllData();
    },
    bindEvents,
    bindModalCloses,
    setupMonthFilter,
    setupReportsDateFilter,
    loadAllData,
    showLoadError,
    loadFormSettings,
    applyGlobalFilters,
    saveFormSettings,
    toggleQuranFormFields,
    exportContest,
    exportWholeReport,
    getReportExportDateLabel,
    contestLabel,
    selectContestYear,
    openSelectedContest() {
      if (selectedContestYear != null) QuranContestAdmin.viewContest(selectedContestYear);
    },
    openContestExportPicker(year) {
      ensureContestExportModal();
      const modal = document.getElementById('contestExportModal');
      modal.dataset.year = String(year);
      document.getElementById('contestExportTitle').textContent = `Export ${contestLabel(year)}`;
      openModal('contestExportModal');
    },
    closeContestModal: () => closeModal('contestModal'),
    closeDetail: () => closeModal('detailModal'),
    closeRegEdit: () => closeModal('regEditModal'),
    promptAddContestYear,
    openAddCompetitor() {
      const year = addCompetitorTargetYear();
      if (year && isContestRegistrationClosed(year)) {
        alert('This Quran contest has ended. Create a new contest year for more registrations.');
        return;
      }
      if (!registrationOpen) {
        alert(registrationClosedMessage || QURAN_CLOSED_DEFAULT);
        return;
      }
      addCompetitorMemberConv = '';
      addCompetitorPrefill = null;
      addCompetitorEmailResolvedFor = '';
      addCompetitorEmailLookupBusy = false;
      clearTimeout(addCompetitorEmailLookupTimer);
      document.getElementById('addCompetitorUserId').value = '';
      document.getElementById('addCompetitorName').value = '';
      document.getElementById('addCompetitorEmail').value = '';
      document.getElementById('addCompetitorWhatsapp').value = '';
      document.getElementById('addCompetitorTelephone').value = '';
      document.getElementById('addCompetitorDufcad').value = '';
      document.getElementById('addCompetitorUniversity').value = '';
      document.getElementById('addCompetitorFaculty').value = '';
      document.getElementById('addCompetitorSemester').value = '';
      document.getElementById('addCompetitorUsername').value = '';
      setParticipatedRadio('Maya');
      document.getElementById('addCompetitorPrevSection').value = '';
      document.getElementById('addCompetitorWonBefore').value = '';
      document.getElementById('addCompetitorSection').value = '';
      const selEl = document.getElementById('addCompetitorSelected');
      if (selEl) {
        selEl.textContent = '';
        selEl.hidden = true;
      }
      document.getElementById('addCompetitorMsg').textContent = '';
      document.getElementById('addCompetitorResults').innerHTML = '';
      document.getElementById('addCompetitorSearch').value = '';
      setAddCompetitorPastBlockVisible(false);
      lockAddCompetitorPastFields(false);
      lockAddCompetitorHsfFields(false);
      syncAddCompetitorPastFields();
      loadAdminConvocationOptions().then(() => syncAddCompetitorAlnuurMode());
      updateAddCompetitorYearHint();
      openModal('addCompetitorModal');
    },
    closeAddCompetitor: () => closeModal('addCompetitorModal'),
    async viewContest(year) {
      selectContestYear(year);
      const data = await fetchContest(year);
      setContestModalHeadVisible(false);
      document.getElementById('contestViewPanel').style.display = 'block';
      document.getElementById('contestEditForm').style.display = 'none';
      document.getElementById('contestViewPanel').innerHTML = renderContestViewPanel(data, year);
      openModal('contestModal');
    },
    async editContest(year) {
      if (isContestRegistrationClosed(year)) {
        alert('This Quran contest has ended. Winner places can no longer be edited.');
        return;
      }
      const data = await fetchContest(year);
      setContestModalHeadVisible(true);
      document.getElementById('contestModalTitle').textContent = `Edit ${contestLabel(year)}`;
      document.getElementById('contestViewPanel').style.display = 'none';
      document.getElementById('contestEditForm').style.display = 'block';
      document.getElementById('editYear').value = year;
      document.getElementById('editTitle').value = data.title || contestTitleFromHistory(year) || '';
      document.getElementById('editDate').value = data.contest_date ? data.contest_date.slice(0, 10) : '';
      document.getElementById('editPlace').value = data.place || '';
      fillWinnerSelects(data.registrations || [], data);
      openModal('contestModal');
    },
    async deleteContest(year) {
      const row = history.find((h) => h.year === year);
      const n = row?.total_competitors ?? 0;
      const msg = n
        ? `Delete ${contestLabel(year)} and all ${n} registration(s)? This cannot be undone.`
        : `Delete ${contestLabel(year)}?`;
      if (!confirm(msg)) return;
      await fetchJson(`/quran-contest/years/${year}`, { method: 'DELETE' });
      await loadAllData();
    },
    showDetail(id) {
      const a = apps.find((x) => x.id === id);
      if (!a) return;
      document.getElementById('detailContent').innerHTML = renderRegistrationDetailHtml(a);
      openModal('detailModal');
      if (!a.is_read) {
        fetchJson(`/quran-contest/${id}/read`, { method: 'POST' }).then(() => {
          a.is_read = true;
          applyGlobalFilters();
        });
      }
    },
    editRegistration(id) {
      const a = apps.find((x) => x.id === id);
      if (!a) return;
      regEditIsAlnuur = isAlnuurDufcad(a.convocation);
      regEditPrefill = null;
      document.getElementById('regEditId').value = a.id;
      document.getElementById('regEditTitle').textContent = `Edit — ${a.full_name}`;
      document.getElementById('regEditName').value = a.full_name || '';
      document.getElementById('regEditWhatsapp').value = a.whatsapp || '';
      document.getElementById('regEditTelephone').value = a.telephone || '';
      document.getElementById('regEditDufcad').value = a.convocation || '';
      document.getElementById('regEditParticipated').value = a.participated_before || 'Maya';
      document.getElementById('regEditPrevSection').value = a.participated_before === 'Haa' ? (a.previous_section || '') : '';
      document.getElementById('regEditWonBefore').value = a.participated_before === 'Haa' ? (a.won_before || '') : '';
      document.getElementById('regEditSection').value = a.section_this_year || 'Qeybta 10-ka Jus';
      document.getElementById('regEditMsg').textContent = '';
      lockRegEditHsfFields(!regEditIsAlnuur);
      if (!regEditIsAlnuur && a.user_id) {
        fetchQuranEligibility(a.user_id, a.id).then((prefill) => {
          regEditPrefill = prefill;
          if (!prefill) {
            syncRegEditPastFields();
            return;
          }
          document.getElementById('regEditWhatsapp').value = prefill.whatsapp || a.whatsapp || '';
          document.getElementById('regEditTelephone').value = prefill.telephone || a.telephone || '';
          document.getElementById('regEditDufcad').value = prefill.convocation || a.convocation || '';
          document.getElementById('regEditParticipated').value = prefill.participated_before || 'Maya';
          document.getElementById('regEditPrevSection').value = prefill.previous_section || '';
          document.getElementById('regEditWonBefore').value = prefill.won_before || 'Midna';
          syncRegEditPastFields();
        });
      } else {
        syncRegEditPastFields();
      }
      openModal('regEditModal');
    },
    async deleteRegistration(id) {
      const a = apps.find((x) => x.id === id);
      if (!a) return;
      if (!confirm(`Delete registration for ${a.full_name}? They will receive an email notification.`)) return;
      const res = await fetchJson(`/quran-contest/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Could not delete.');
        return;
      }
      await loadAllData();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

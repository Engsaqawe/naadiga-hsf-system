  /**
   * Shared Summer Course admin UI (portal page + Reports tab).
   */
  (function (global) {
    let apps = [];
    let history = [];
    let eventsBound = false;
    let selectedProgramYear = null;
    let registrationOpen = true;
    let registrationClosedMessage = '';
    /** Days toggled in the attendance modal since last save — used for absence emails. */
    let attendanceTouchedDays = new Set();
    /** Guided roll-call: which day column and student row are active. */
    let attendanceFocusDay = 1;
    let attendanceFocusStudentIdx = 0;
    /** Attendance panel filter: '' = all, else exact convocation label (includes Guest). */
    let attendanceFilterDufcad = '';
    /** Attendance panel name search (case-insensitive substring). */
    let attendanceSearchQuery = '';

    const HSF_ORG_NAME = 'Naadiga Ardayda Deeqda Waxbarasho HSF';
    const HSF_LOGO = '../../img/logo.png';
    const SUMMER_CLOSED_DEFAULT = 'Summer course registration is closed now. Please check back when registration opens.';

    function getApi() {
      const base = (typeof API_BASE !== 'undefined' && API_BASE)
        ? API_BASE.replace(/\/api\/?$/, '')
        : 'http://127.0.0.1:5000';
      return `${base}/api/applications`;
    }

    function sEl(id) {
      const tab = document.getElementById('summer-tab-content');
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
      if (/^al-?nuur$/i.test(String(memberConvocation).trim())) {
        if (!/^al-?nuur$/i.test(String(submittedConvocation).trim())) {
          return `You are ${actualLabel}. You cannot register as ${submittedLabel}.`;
        }
        return '';
      }
      if (/^al-?nuur$/i.test(String(submittedConvocation).trim())) {
        return `You are ${actualLabel}. Alnuur registration is handled by admin — contact HSF.`;
      }
      const actual = dufcadKey(memberConvocation);
      const selected = dufcadKey(submittedConvocation);
      if (actual && selected && actual !== selected) {
        return `You are ${actualLabel}. You cannot register as ${submittedLabel}.`;
      }
      return '';
    }

    function ensureAddYearModal() {
      if (document.getElementById('summerAddYearModal')) return;
      const el = document.createElement('div');
      el.id = 'summerAddYearModal';
      el.className = 'portal-modal-overlay';
      el.innerHTML = `
        <div class="portal-modal-card portal-modal-card--sm">
          <div class="portal-modal-head">
            <h3>Add summer course year</h3>
            <button type="button" class="portal-modal-close" id="summerAddYearClose" aria-label="Close">&times;</button>
          </div>
          <p style="font-size:.88rem;color:var(--text-muted);margin:0 0 12px;">Enter the program year (e.g. 2026 or 2027).</p>
          <div class="filter-group" style="margin-bottom:10px;">
            <label for="summerAddYearInput">Year</label>
            <input type="number" id="summerAddYearInput" class="filter-select" style="width:100%" min="2000" max="2100" placeholder="2027">
          </div>
          <p id="summerAddYearMsg" style="font-size:.82rem;color:#dc2626;margin:0 0 10px;"></p>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline" id="summerAddYearCancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="summerAddYearOk">Add year</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      const close = () => {
        el.classList.remove('is-open');
        document.getElementById('summerAddYearMsg').textContent = '';
      };
      el.querySelector('#summerAddYearClose')?.addEventListener('click', close);
      el.querySelector('#summerAddYearCancel')?.addEventListener('click', close);
      el.addEventListener('click', (e) => { if (e.target === el) close(); });
      el.querySelector('#summerAddYearOk')?.addEventListener('click', () => el._submit?.());
      el.querySelector('#summerAddYearInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el._submit?.(); }
      });
    }

    function semesterFromUser(u) {
      return u?.isGraduated ? 'Graduated' : (u.semester || '');
    }

    function setInputLocked(el, locked) {
      if (!el) return;
      el.readOnly = locked;
      if (el.tagName === 'SELECT') el.disabled = locked;
      el.classList.toggle('input-locked', locked);
      el.style.cursor = locked ? 'not-allowed' : '';
    }

    function lockAddAttendeeMemberFields(locked) {
      [
        'addAttendeeDufcad',
        'addAttendeeFaculty',
        'addAttendeeUniversity',
        'addAttendeeSemester',
      ].forEach((id) => setInputLocked(document.getElementById(id), locked));
    }

    function lockAddAttendeeYearField(locked) {
      setInputLocked(document.getElementById('addAttendeeYear'), locked);
    }

    function syncAddAttendeeFieldLocks() {
      const guestMode = !!document.getElementById('addAttendeeGuestMode')?.checked;
      const hasMember = !!document.getElementById('addAttendeeUserId')?.value;
      const year = selectedProgramYear ?? history[0]?.year ?? null;
      lockAddAttendeeYearField(!!year);
      lockAddAttendeeMemberFields(!guestMode && hasMember);
      const emailWrap = document.getElementById('addAttendeeEmailWrap');
      const guestHint = document.getElementById('addAttendeeGuestHint');
      const dufcadWrap = document.getElementById('addAttendeeDufcadWrap');
      const dufcadEl = document.getElementById('addAttendeeDufcad');
      const searchWrap = document.getElementById('addAttendeeSearch')?.closest('.filter-group');
      if (emailWrap) emailWrap.hidden = !guestMode;
      if (guestHint) guestHint.hidden = !guestMode;
      if (dufcadWrap) dufcadWrap.hidden = guestMode;
      if (dufcadEl) dufcadEl.required = !guestMode;
      if (searchWrap) searchWrap.style.display = guestMode ? 'none' : '';
      const resultsHost = document.getElementById('addAttendeeResults');
      if (resultsHost && guestMode) resultsHost.innerHTML = '';
    }

    function clearAddAttendeeMemberSelection() {
      addAttendeeMemberConv = '';
      document.getElementById('addAttendeeUserId').value = '';
      document.getElementById('addAttendeeConvocationRaw').value = '';
      document.getElementById('addAttendeeSelected').textContent = '';
    }

    function setAddAttendeeGuestMode(on) {
      const guestEl = document.getElementById('addAttendeeGuestMode');
      if (guestEl) guestEl.checked = !!on;
      if (on) {
        clearAddAttendeeMemberSelection();
        const searchEl = document.getElementById('addAttendeeSearch');
        if (searchEl) searchEl.value = '';
        document.getElementById('addAttendeeDufcad').value = '';
        document.getElementById('addAttendeeFaculty').value = '';
        document.getElementById('addAttendeeUniversity').value = '';
        document.getElementById('addAttendeeSemester').value = '';
      }
      syncAddAttendeeFieldLocks();
    }

    function fmtDate(iso) {
      return iso ? new Date(iso).toLocaleDateString() : '—';
    }

    function emptyLabel() {
      return '—';
    }

    function programStartDateDisplay(data) {
      if (data?.start_date) return fmtDate(data.start_date);
      if (data?.created_at) return fmtDate(data.created_at);
      return emptyLabel();
    }

    function currentProgramRegistrations() {
      if (selectedProgramYear == null || !history.length) return 0;
      return appsLinkedToAdminPrograms(false).filter((a) => appProgramYear(a) === selectedProgramYear).length;
    }

    function regDateKey(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function isReportsPage() {
      return !!document.getElementById('summer-tab-content');
    }

    function programLabel(year) {
      return `${year} Summer Course`;
    }

    function appProgramYear(a) {
      return a.created_at ? new Date(a.created_at).getFullYear() : null;
    }

    function adminProgramYears() {
      return new Set(history.map((h) => h.year));
    }

    function appsLinkedToAdminPrograms(useDateFilter = true) {
      const years = adminProgramYears();
      const base = useDateFilter ? getDateFilteredApps() : apps;
      return base.filter((a) => {
        const y = appProgramYear(a);
        return y != null && years.has(y);
      });
    }

    function getProgramYearApps() {
      if (!isReportsPage() && !history.length) return [];
      const useDateFilter = isReportsPage() || selectedProgramYear == null;
      const linked = appsLinkedToAdminPrograms(useDateFilter);
      if (isReportsPage() || selectedProgramYear == null) return linked;
      return linked.filter((a) => appProgramYear(a) === selectedProgramYear);
    }

    function setProgramModalHeadVisible(showTitle) {
      const head = document.getElementById('summerProgramModalHead');
      const title = document.getElementById('summerProgramModalTitle');
      const card = document.querySelector('#summerProgramModal .portal-modal-card');
      if (title) title.style.display = showTitle ? '' : 'none';
      if (head) head.classList.toggle('portal-modal-head--view-only', !showTitle);
      if (card) card.classList.toggle('portal-modal-card--no-inner-scroll', !showTitle);
    }

    function programModalBrandHtml(year, subtitle) {
      return `
        <div class="hsf-program-modal-brand">
          <img src="${HSF_LOGO}" alt="" class="hsf-program-modal-logo" width="52" height="52">
          <div class="hsf-program-modal-brand-text">
            <p class="hsf-program-modal-org">${esc(HSF_ORG_NAME)}</p>
            <h4 class="hsf-program-modal-year">${esc(programLabel(year))}</h4>
            ${subtitle ? `<p class="hsf-program-modal-sub">${esc(subtitle)}</p>` : ''}
          </div>
        </div>`;
    }

    function programNameCell(year) {
      if (isReportsPage()) return esc(programLabel(year));
      return `<button type="button" class="hsf-program-link" onclick="SummerCourseAdmin.selectProgramYear(${year})">${esc(programLabel(year))}</button>`;
    }

    function updateRegistrationsTitle() {
      const btn = sEl('summerRegYearTitleBtn');
      const span = sEl('summerRegYearTitle');
      if (!span) return;
      if (selectedProgramYear != null && !isReportsPage()) {
        span.textContent = programLabel(selectedProgramYear);
        btn?.setAttribute('title', 'View program details');
        btn?.classList.add('is-active');
      } else {
        span.textContent = 'Registrations';
        btn?.removeAttribute('title');
        btn?.classList.remove('is-active');
      }
    }

    function selectProgramYear(year) {
      if (!history.some((h) => h.year === year)) return;
      selectedProgramYear = year;
      updateRegistrationsTitle();
      populateDufcadFilter();
      renderStats();
      renderApps();
      sEl('summerRegYearTitle')?.closest('.card-table')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function getGlobalMonth() {
      return sEl('summerGlobalMonthPicker')?.value || '';
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

    function getGlobalDateRange() {
      const monthRange = monthToRange(getGlobalMonth());
      if (!isReportsPage()) return monthRange;
      const fromEl = document.getElementById('summerDateFrom');
      const toEl = document.getElementById('summerDateTo');
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
      const fromEl = document.getElementById('summerDateFrom');
      const toEl = document.getElementById('summerDateTo');
      const monthPicker = sEl('summerGlobalMonthPicker');
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
      const fromEl = document.getElementById('summerDateFrom');
      const toEl = document.getElementById('summerDateTo');
      if (!fromEl || !toEl) return;
      const { from, to } = monthToRange(getGlobalMonth());
      fromEl.value = from;
      toEl.value = to;
    }

    function inDateRange(dateKey, from, to) {
      if (!from && !to) return true;
      if (!dateKey) return false;
      if (from && dateKey < from) return false;
      if (to && dateKey > to) return false;
      return true;
    }

    function programDateForYear(year) {
      const row = history.find((h) => h.year === year);
      if (row?.start_date) return row.start_date.slice(0, 10);
      const keys = apps
        .filter((a) => a.created_at && new Date(a.created_at).getFullYear() === year)
        .map((a) => regDateKey(a.created_at))
        .filter(Boolean)
        .sort();
      return keys.length ? keys[keys.length - 1] : null;
    }

    function historyMatchesDate(h, from, to) {
      if (!from && !to) return true;
      const dateKey = h.start_date ? h.start_date.slice(0, 10) : programDateForYear(h.year);
      if (dateKey) return inDateRange(dateKey, from, to);
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

    function programRowExportHtml(year) {
      return `
        <button type="button" class="contest-icon-btn view summer-report-view-btn" title="View & filter report" data-program-year="${year}" aria-label="View filtered report for ${year}">
          <i class="fa-solid fa-eye"></i>
        </button>`;
    }

    function bindProgramRowExports() {
      if (!isReportsPage()) return;
      document.querySelectorAll('#summerHistoryBody .summer-report-view-btn').forEach((btn) => {
        if (btn.dataset.exportBound === '1') return;
        btn.dataset.exportBound = '1';
        btn.addEventListener('click', () => {
          const year = parseInt(btn.dataset.programYear, 10);
          if (year) openProgramReportViewer(year);
        });
      });
    }

    function programActionBtns(year) {
      if (isReportsPage()) {
        return `<div class="contest-history-actions">${programRowExportHtml(year)}</div>`;
      }
      const ended = isYearRegistrationClosed(year);
      const editBtn = ended
        ? ''
        : `<button type="button" class="contest-icon-btn" title="Edit" onclick="SummerCourseAdmin.editProgram(${year})"><i class="fa-solid fa-pen"></i></button>`;
      return `<div class="contest-history-actions">
        <button type="button" class="contest-icon-btn" title="View" onclick="SummerCourseAdmin.viewProgram(${year})"><i class="fa-solid fa-eye"></i></button>
        ${editBtn}
        <button type="button" class="contest-icon-btn danger" title="Delete" onclick="SummerCourseAdmin.deleteProgram(${year})"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    }

    function regActionBtns(id) {
      if (isReportsPage()) return '';
      return `<div class="contest-history-actions">
        <button type="button" class="contest-icon-btn" title="View" onclick="SummerCourseAdmin.showDetail(${id})"><i class="fa-solid fa-eye"></i></button>
        <button type="button" class="contest-icon-btn" title="Edit" onclick="SummerCourseAdmin.editRegistration(${id})"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="contest-icon-btn danger" title="Delete" onclick="SummerCourseAdmin.deleteRegistration(${id})"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    }

    let programViewCache = null;

    function parseCoursesList(text) {
      return (text || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    }

    function coursesBulletHtml(text) {
      const items = parseCoursesList(text);
      if (!items.length) return '<ul class="summer-courses-list"><li>—</li></ul>';
      return `<ul class="summer-courses-list">${items.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
    }

    function coursesCardsHtml(text) {
      const items = parseCoursesList(text);
      if (!items.length) {
        return '<div class="summer-courses-cards"><div class="summer-course-card summer-course-card--empty">No courses listed</div></div>';
      }
      return `<div class="summer-courses-cards">${items.map((c, i) => `
        <div class="summer-course-card">
          <span class="summer-course-card-num" aria-hidden="true">${i + 1}</span>
          <span class="summer-course-card-title">${esc(c)}</span>
        </div>
      `).join('')}</div>`;
    }

    function renderProgramLoadingPanel(year, mode) {
      const hist = history.find((h) => h.year === year);
      const regHint = hist?.total_registered ?? hist?.total_attended;
      const label = mode === 'attendance' ? 'Loading attendance…' : 'Loading program details…';
      return `
        <div class="hsf-program-modal-body summer-program-loading">
          ${programModalBrandHtml(year, mode === 'attendance' ? 'Attendance' : '')}
          <div class="summer-program-loading-box" role="status" aria-live="polite">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <div>
              <strong>${esc(label)}</strong>
              <p>${regHint != null ? `${regHint} registered — this may take a moment.` : 'Please wait a moment.'}</p>
            </div>
          </div>
        </div>`;
    }

    function dayStateFor(day) {
      const states = global._summerProgramMeta?.day_states || {};
      return states[`day${day}`] || 'open';
    }

    function isDayCheckboxDisabled(day) {
      if (isReportsPage()) return true;
      if (isSummerProgramEnded()) return true;
      return dayStateFor(day) === 'expired';
    }

    function addAttendeeTargetYear() {
      const fromField = parseInt(document.getElementById('addAttendeeYear')?.value, 10);
      if (fromField >= 2000 && fromField <= 2100) return fromField;
      return selectedProgramYear ?? history[0]?.year ?? null;
    }

    function syncAddAttendeeYearField() {
      const year = selectedProgramYear ?? history[0]?.year ?? null;
      const el = document.getElementById('addAttendeeYear');
      if (el && year) el.value = year;
      lockAddAttendeeYearField(!!year);
    }

    function formatRegistrationClosesAt(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    function historyRowForYear(year) {
      return history.find((h) => h.year === year);
    }

    function isYearRegistrationClosed(year) {
      return !!historyRowForYear(year)?.is_ended;
    }

    function isSummerProgramEnded() {
      return !!(global._summerProgramMeta?.is_ended);
    }

    function setProgramEditFormLocked(locked) {
      ['summerEditPlace', 'summerEditStartDate'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = locked;
        el.classList.toggle('input-locked', locked);
      });
      document.querySelectorAll('#summerEditCoursesList input').forEach((el) => {
        el.disabled = locked;
        el.classList.toggle('input-locked', locked);
      });
      document.querySelectorAll('#summerEditCoursesList .summer-course-edit-row button').forEach((el) => {
        el.disabled = locked;
        el.style.display = locked ? 'none' : '';
      });
      const addCourseBtn = document.querySelector('#summerProgramEditForm button[onclick*="addCourseRow"]');
      if (addCourseBtn) addCourseBtn.style.display = locked ? 'none' : '';
      const saveBtn = document.querySelector('#summerProgramEditForm button[type="submit"]');
      if (saveBtn) saveBtn.disabled = locked;
    }

    function summerRegistrationStatusHtml(data, year) {
      if (!data) return '';
      if (data.is_in_grace_period) {
        const when = formatRegistrationClosesAt(data.registration_closes_at);
        return `<p class="summer-program-grace-badge" style="margin-top:1rem;color:var(--warning);">
          <i class="fa-solid fa-clock"></i> Day 6 saved — full program lock ${when ? `at ${esc(when)}` : 'in 6 hours'} (Day 6 attendance can still be edited).</p>`;
      }
      if (data.is_ended) {
        return `<p class="summer-program-ended-badge" style="margin-top:1rem;"><i class="fa-solid fa-flag-checkered"></i> Program ended — attendance and registration are closed.</p>`;
      }
      return '';
    }

    function regColCount() {
      return isReportsPage() ? 7 : 8;
    }

    function histColCount() {
      return 4;
    }

    function attendanceDayCells(a, opts = {}) {
      const forModal = !!opts.forModal;
      const readOnly = !!opts.readOnly;
      const focusDay = opts.focusDay || attendanceFocusDay || 1;
      const att = a.attendance || {};
      return [1, 2, 3, 4, 5, 6].map((d) => {
        const st = dayStateFor(d);
        const disabled = readOnly || isDayCheckboxDisabled(d);
        const grey = st === 'locked' || st === 'expired';
        const checked = !!att[`day${d}`];
        const title = st === 'expired' ? 'Program locked' : `Day ${d}`;
        const focusCls = forModal && d === focusDay ? ' is-focus-day' : '';
        return `
        <td class="summer-att-day-cell${grey ? ' summer-att-day-cell--grey' : ''}${focusCls}" data-day="${d}">
          <label class="summer-att-day-toggle" title="${title}">
            <input type="checkbox" class="summer-att-day-cb" aria-label="Day ${d} — ${esc(a.name)}"
              data-app-id="${a.id}" data-day="${d}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
            <span class="summer-att-day-face" aria-hidden="true"></span>
          </label>
        </td>`;
      }).join('');
    }

    function renderProgramInfoPanel(data, year) {
      const place = (data.place || '').trim();
      const regCount = data.registration_count ?? (data.registrations || []).length;
      const marks = data.attendance_marks ?? data.total_attended ?? 0;
      return `
        <div class="hsf-program-modal-body">
          ${programModalBrandHtml(year)}
          <div class="hsf-program-place-card">
            <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
            <div>
              <span class="hsf-program-meta-label">Place</span>
              <strong class="hsf-program-place-name">${place ? esc(place) : emptyLabel()}</strong>
            </div>
          </div>
          <div class="hsf-program-meta-grid">
            <div class="hsf-program-meta-item">
              <span class="hsf-program-meta-label">Start date</span>
              <strong>${programStartDateDisplay(data)}</strong>
            </div>
            <div class="hsf-program-meta-item">
              <span class="hsf-program-meta-label">Program days</span>
              <strong>6 days</strong>
              <small style="display:block;font-weight:400;color:var(--text-muted);margin-top:4px;">${regCount} registered · ${marks} attendance marks</small>
            </div>
          </div>
          ${summerRegistrationStatusHtml(data, year)}
          <div class="hsf-program-courses-block">
            <p class="hsf-program-meta-label">Courses offered</p>
            ${coursesCardsHtml(data.courses_offered)}
          </div>
          <div class="summer-program-view-actions">
            <button type="button" class="btn btn-primary btn-sm summer-make-attendance-btn" onclick="SummerCourseAdmin.showProgramAttendance(${year})">
              <i class="fa-solid fa-clipboard-check"></i> Make attendance
            </button>
          </div>
        </div>`;
    }

    function computeFocusDayFromRegs(regs) {
      const list = regs || [];
      for (let d = 1; d <= 6; d++) {
        const anyPresent = list.some((r) => !!(r.attendance && r.attendance[`day${d}`]));
        if (!anyPresent) return d;
      }
      return 6;
    }

    function isGuestConvocation(conv) {
      return /^guest$/i.test(String(conv || '').trim());
    }

    function attendanceDufcadOptions(regs) {
      const byKey = new Map();
      (regs || []).forEach((a) => {
        const c = (a.convocation || '').trim();
        if (!c) return;
        if (isGuestConvocation(c)) {
          byKey.set('guest', 'Guest');
          return;
        }
        const key = dufcadKey(c) || c.toLowerCase();
        const label = dufcadDisplayFromConvocation(c) || c;
        if (!byKey.has(key)) byKey.set(key, label);
      });
      return [...byKey.entries()].sort((a, b) => {
        if (a[0] === 'guest') return 1;
        if (b[0] === 'guest') return -1;
        const an = parseInt(a[0], 10);
        const bn = parseInt(b[0], 10);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
        return String(a[1]).localeCompare(String(b[1]));
      }).map(([, label]) => label);
    }

    function attendanceFilterMatches(rowConvocation, filterValue) {
      const filter = (filterValue || '').trim();
      if (!filter) return true;
      const conv = (rowConvocation || '').trim();
      if (isGuestConvocation(filter)) return isGuestConvocation(conv);
      if (isGuestConvocation(conv)) return false;
      const fk = dufcadKey(filter);
      const ck = dufcadKey(conv);
      if (fk && ck) return fk === ck;
      return conv === filter;
    }

    function getAttendancePanelRows() {
      return [...document.querySelectorAll('#summerProgramViewPanel .summer-attendance-table tbody tr.summer-att-row')]
        .filter((tr) => !tr.hidden);
    }

    function applyAttendanceFilters() {
      const panel = document.getElementById('summerProgramViewPanel');
      if (!panel) return;
      const filter = (attendanceFilterDufcad || '').trim();
      const q = (attendanceSearchQuery || '').trim().toLowerCase();
      panel.querySelectorAll('tr.summer-att-row').forEach((tr) => {
        const conv = (tr.dataset.dufcad || '').trim();
        const name = (tr.querySelector('.summer-att-student-name')?.textContent || '').trim().toLowerCase();
        const dufcadOk = attendanceFilterMatches(conv, filter);
        const searchOk = !q || name.includes(q);
        tr.hidden = !(dufcadOk && searchOk);
      });
      const visible = getAttendancePanelRows();
      if (attendanceFocusStudentIdx >= visible.length) attendanceFocusStudentIdx = 0;
      applyAttendanceHighlights();
    }

    /** @deprecated use applyAttendanceFilters */
    function applyAttendanceDufcadFilter() {
      applyAttendanceFilters();
    }

    function applyAttendanceHighlights() {
      const panel = document.getElementById('summerProgramViewPanel');
      const table = panel?.querySelector('.summer-attendance-table');
      if (!table) return;
      const day = Math.min(6, Math.max(1, attendanceFocusDay || 1));
      attendanceFocusDay = day;

      table.querySelectorAll('.summer-att-day-head').forEach((th) => {
        const d = parseInt(th.dataset.day, 10);
        th.classList.toggle('is-focus-day', d === day);
      });
      table.querySelectorAll('.summer-att-day-cell').forEach((td) => {
        const d = parseInt(td.dataset.day, 10);
        td.classList.toggle('is-focus-day', d === day);
      });

      const rows = getAttendancePanelRows();
      table.querySelectorAll('tr.summer-att-row').forEach((tr) => {
        tr.classList.remove('is-focus-student');
      });
      if (!rows.length) {
        const hintEmpty = panel.querySelector('.summer-att-focus-hint');
        if (hintEmpty) {
          hintEmpty.textContent = filterLabelForHint()
            ? `Now marking: Day ${day} — no students in this filter`
            : `Now marking: Day ${day}`;
        }
        return;
      }
      if (attendanceFocusStudentIdx < 0) attendanceFocusStudentIdx = 0;
      if (attendanceFocusStudentIdx >= rows.length) attendanceFocusStudentIdx = rows.length - 1;

      rows.forEach((tr, i) => {
        tr.classList.toggle('is-focus-student', i === attendanceFocusStudentIdx);
      });
      const focusRow = rows[attendanceFocusStudentIdx];
      if (focusRow) {
        try {
          focusRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (_) { /* ignore */ }
      }

      const hint = panel.querySelector('.summer-att-focus-hint');
      if (hint) {
        const name = focusRow?.querySelector('.summer-att-name-cell')?.textContent?.trim() || '';
        const scope = filterLabelForHint();
        const scopeBit = scope ? ` (${scope})` : '';
        hint.textContent = name
          ? `Now marking: Day ${day}${scopeBit} — ${name}`
          : `Now marking: Day ${day}${scopeBit}`;
      }
    }

    function filterLabelForHint() {
      const bits = [];
      if ((attendanceFilterDufcad || '').trim()) bits.push(attendanceFilterDufcad.trim());
      if ((attendanceSearchQuery || '').trim()) bits.push('search');
      return bits.join(' · ');
    }

    function advanceAttendanceStudent() {
      const rows = getAttendancePanelRows();
      if (!rows.length) return;
      if (attendanceFocusStudentIdx < rows.length - 1) {
        attendanceFocusStudentIdx += 1;
      }
      applyAttendanceHighlights();
    }

    function renderProgramAttendancePanel(data, year) {
      const regs = data.registrations || [];
      const programEnded = !!data.is_ended;
      const inGrace = !!data.is_in_grace_period;
      const day6Finalized = !!data.day6_attendance_saved_at;
      const focusDay = Math.min(6, Math.max(1, attendanceFocusDay || 1));
      const dufcadOpts = attendanceDufcadOptions(regs);
      const filterVal = attendanceFilterDufcad || '';
      const searchVal = attendanceSearchQuery || '';
      const dayHeaders = [1, 2, 3, 4, 5, 6].map((d) =>
        `<th class="summer-att-day-head${d === focusDay ? ' is-focus-day' : ''}" data-day="${d}">
          <span class="summer-att-day-arrow" aria-hidden="true"><i class="fa-solid fa-caret-down"></i></span>
          <span class="summer-att-day-label">Day ${d}</span>
        </th>`
      ).join('');
      const q = searchVal.trim().toLowerCase();
      const rows = regs.map((a, i) => {
        const conv = (a.convocation || '').trim();
        const name = String(a.name || '');
        const dufcadOk = attendanceFilterMatches(conv, filterVal);
        const searchOk = !q || name.toLowerCase().includes(q);
        const hidden = !(dufcadOk && searchOk);
        return `
        <tr class="summer-att-row" data-student-idx="${i}" data-app-id="${a.id}" data-dufcad="${esc(conv)}"${hidden ? ' hidden' : ''}>
          <td class="summer-att-name-cell">
            <span class="summer-att-student-name">${esc(a.name)}</span>
            <span class="summer-att-student-dufcad">${esc(isGuestConvocation(conv) ? 'Guest' : (dufcadDisplayFromConvocation(conv) || conv || '—'))}</span>
          </td>
          ${attendanceDayCells(a, { forModal: true, readOnly: programEnded, focusDay })}
        </tr>`;
      }).join('');
      const filterOptions = [
        '<option value="">All</option>',
        ...dufcadOpts.map((d) => {
          const selected = !!(filterVal && (d === filterVal || attendanceFilterMatches(d, filterVal)));
          return `<option value="${esc(d)}"${selected ? ' selected' : ''}>${esc(d)}</option>`;
        }),
      ].join('');
      const saveBlock = programEnded ? `
          <p class="summer-program-ended-badge" style="margin-top:1rem;"><i class="fa-solid fa-flag-checkered"></i> Program ended — attendance and registration are closed.</p>
        ` : inGrace ? `
          <p class="summer-program-grace-badge" style="margin-top:1rem;color:var(--warning);">
            <i class="fa-solid fa-clock"></i> Day 6 saved — full program lock ${formatRegistrationClosesAt(data.registration_closes_at) ? `at ${esc(formatRegistrationClosesAt(data.registration_closes_at))}` : 'in 6 hours'}. You can still edit attendance until then.
          </p>
          <div class="summer-attendance-save-bar">
            <button type="button" class="btn btn-primary btn-sm" id="summerSaveAttendanceBtn">
              <i class="fa-solid fa-floppy-disk"></i> Save attendance
            </button>
            <p class="summer-attendance-save-hint" id="summerAttendanceSaveHint" hidden></p>
          </div>
        ` : `
          <div class="summer-attendance-save-bar">
            <label class="summer-finalize-day6">
              <input type="checkbox" id="summerFinalizeDay6"${day6Finalized ? ' checked disabled' : ''}>
              Day 6 attendance saved — program locks after 6 hours
            </label>
            <button type="button" class="btn btn-primary btn-sm" id="summerSaveAttendanceBtn">
              <i class="fa-solid fa-floppy-disk"></i> Save attendance
            </button>
            <p class="summer-attendance-save-hint" id="summerAttendanceSaveHint" hidden></p>
          </div>
        `;
      return `
        <div class="hsf-program-modal-body summer-program-attendance">
          ${programModalBrandHtml(year, 'Attendance')}
          <button type="button" class="btn btn-outline btn-sm hsf-program-back-btn" onclick="SummerCourseAdmin.viewProgram(${year})">
            <i class="fa-solid fa-arrow-left"></i> Back to program
          </button>
          <p class="hsf-program-att-hint">Search by name and filter by dufcad (or Guest) to take one class at a time. Arrow marks the day; highlighted row is the student being checked. After you tick, focus moves to the next visible student. After you save, the arrow moves to the next day. Unchecked members on a day you changed are emailed that they missed that day.</p>
          <div class="summer-att-filter-bar">
            <div class="summer-att-search-wrap">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input type="search" id="summerAttSearch" class="summer-att-search-input" placeholder="Search name…" value="${esc(searchVal)}" aria-label="Search attendance by name" autocomplete="off">
            </div>
            <div class="summer-att-filter-wrap">
              <label class="summer-att-filter-label" for="summerAttFilterDufcad">
                <i class="fa-solid fa-filter" aria-hidden="true"></i>
                <span class="summer-att-filter-text-short">Filter</span>
              </label>
              <select id="summerAttFilterDufcad" class="summer-att-filter-select" aria-label="Filter attendance by dufcad or guest">
                ${filterOptions}
              </select>
            </div>
          </div>
          <p class="summer-att-focus-hint" aria-live="polite">Now marking: Day ${focusDay}</p>
          <div class="table-wrapper summer-attendance-scroll">
            <table class="data-table summer-attendance-table">
              <thead>
                <tr>
                  <th class="summer-att-name-head">Name</th>
                  ${dayHeaders}
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--text-muted);">No registrations for this program.</td></tr>'}</tbody>
            </table>
          </div>
          ${saveBlock}
        </div>`;
    }

    function renderCourseEditList(courses) {
      const host = document.getElementById('summerEditCoursesList');
      if (!host) return;
      const list = courses.length ? courses : [''];
      host.innerHTML = list.map((c, i) => `
        <div class="summer-course-edit-row" data-idx="${i}">
          <input type="text" class="filter-select summer-course-edit-input" value="${esc(c)}" placeholder="Course name">
          <button type="button" class="contest-icon-btn danger" title="Remove" onclick="SummerCourseAdmin.removeCourseRow(${i})"><i class="fa-solid fa-times"></i></button>
        </div>
      `).join('');
    }

    function collectCourseEditList() {
      return [...document.querySelectorAll('#summerEditCoursesList .summer-course-edit-input')]
        .map((el) => el.value.trim())
        .filter(Boolean);
    }

    async function saveAttendanceDay(appId, day, checked, checkbox) {
      const a = apps.find((x) => x.id === appId);
      if (!a) return;
      const attendance = {
        day1: !!(a.attendance?.day1),
        day2: !!(a.attendance?.day2),
        day3: !!(a.attendance?.day3),
        day4: !!(a.attendance?.day4),
        day5: !!(a.attendance?.day5),
        day6: !!(a.attendance?.day6),
      };
      attendance[`day${day}`] = checked;
      try {
        const res = await fetchJson(`/summer-course/${appId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendance }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (checkbox) checkbox.checked = !checked;
          alert(data.error || 'Could not save attendance.');
          return;
        }
        if (data.application) {
          a.attendance = data.application.attendance;
          a.attendance_count = data.application.attendance_count;
          if (programViewCache?.data?.registrations) {
            const pr = programViewCache.data.registrations.find((x) => x.id === appId);
            if (pr) {
              pr.attendance = data.application.attendance;
              pr.attendance_count = data.application.attendance_count;
            }
          }
        }
      } catch (err) {
        if (checkbox) checkbox.checked = !checked;
        console.error('Attendance save failed', err);
      }
    }

    function collectAttendanceEntriesFromPanel() {
      const panel = document.getElementById('summerProgramViewPanel');
      if (!panel) return [];
      const byApp = new Map();
      panel.querySelectorAll('.summer-att-day-cb').forEach((cb) => {
        const appId = parseInt(cb.dataset.appId, 10);
        const day = parseInt(cb.dataset.day, 10);
        if (!appId || !day) return;
        if (!byApp.has(appId)) {
          byApp.set(appId, { id: appId, attendance: {} });
        }
        byApp.get(appId).attendance[`day${day}`] = cb.checked;
      });
      return [...byApp.values()].map((entry) => {
        const att = entry.attendance;
        return {
          id: entry.id,
          attendance: {
            day1: !!att.day1,
            day2: !!att.day2,
            day3: !!att.day3,
            day4: !!att.day4,
            day5: !!att.day5,
            day6: !!att.day6,
          },
        };
      });
    }

    async function saveProgramAttendance(year) {
      const entries = collectAttendanceEntriesFromPanel();
      if (!entries.length) {
        alert('No registrations to save.');
        return;
      }
      const finalizeDay6 = !!document.getElementById('summerFinalizeDay6')?.checked;
      const notifyDays = [...attendanceTouchedDays].sort((a, b) => a - b);
      const btn = document.getElementById('summerSaveAttendanceBtn');
      const hint = document.getElementById('summerAttendanceSaveHint');
      if (btn) btn.disabled = true;
      if (hint) {
        hint.hidden = false;
        hint.textContent = 'Saving…';
        hint.style.color = 'var(--text-muted)';
      }
      try {
        const res = await fetchJson(`/summer-course/years/${year}/attendance-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries,
            finalize_day6: finalizeDay6,
            notify_days: notifyDays,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Could not save attendance.');
          return;
        }
        attendanceTouchedDays = new Set();
        if (notifyDays.length) {
          attendanceFocusDay = Math.min(6, Math.max(...notifyDays) + 1);
        } else {
          attendanceFocusDay = computeFocusDayFromRegs(data.registrations);
        }
        attendanceFocusStudentIdx = 0;
        programViewCache = { year, data };
        global._summerProgramMeta = data;
        (data.registrations || []).forEach((reg) => {
          const local = apps.find((x) => x.id === reg.id);
          if (local) {
            local.attendance = reg.attendance;
            local.attendance_count = reg.attendance_count;
          }
        });
        const emailed = Number(data.absence_emails_sent || 0);
        let msg = finalizeDay6
          ? 'Day 6 attendance saved. Full program locks in 6 hours.'
          : 'Attendance saved.';
        if (emailed > 0) {
          msg += ` Absence notice sent to ${emailed} member${emailed === 1 ? '' : 's'}.`;
        }
        if (!finalizeDay6 && !data.is_ended) {
          msg += ` Next: Day ${attendanceFocusDay}.`;
        }
        await loadAllData();
        document.getElementById('summerProgramViewPanel').innerHTML = renderProgramAttendancePanel(data, year);
        applyAttendanceDufcadFilter();
        const hintAfter = document.getElementById('summerAttendanceSaveHint');
        if (hintAfter) {
          hintAfter.hidden = false;
          hintAfter.textContent = msg;
          hintAfter.style.color = 'var(--success, #16a34a)';
        }
      } catch (err) {
        console.error('Batch attendance save failed', err);
        const hintFail = document.getElementById('summerAttendanceSaveHint');
        if (hintFail) {
          hintFail.hidden = false;
          hintFail.textContent = 'Save failed. Please try again.';
          hintFail.style.color = '#dc2626';
        }
      } finally {
        const btnAfter = document.getElementById('summerSaveAttendanceBtn');
        if (btnAfter) btnAfter.disabled = false;
      }
    }

    function syncRegActionColumnVisibility() {
      document.querySelectorAll('.applications-registrations-table thead th.reg-action-col').forEach((th) => {
        th.style.display = isReportsPage() ? 'none' : '';
      });
    }

    function attendancePresentCount(a) {
      const att = a.attendance || {};
      return [1, 2, 3, 4, 5, 6].filter((d) => att[`day${d}`]).length;
    }

    function attendanceSummary(a) {
      const count = a.attendance_count ?? attendancePresentCount(a);
      return `${count}/6`;
    }

    /** Read-only ✓ / × grid (registration details, reports). */
    function attendanceDisplayHtml(a) {
      const att = a.attendance || {};
      const heads = [1, 2, 3, 4, 5, 6].map((d) =>
        `<th class="summer-att-display-head">Day ${d}</th>`
      ).join('');
      const cells = [1, 2, 3, 4, 5, 6].map((d) => {
        const present = !!att[`day${d}`];
        return `<td class="summer-att-display-cell">
          <span class="summer-att-display-mark${present ? ' is-present' : ' is-absent'}" aria-label="Day ${d}: ${present ? 'present' : 'absent'}">${present ? '✓' : '×'}</span>
        </td>`;
      }).join('');
      return `
        <div class="summer-att-display-wrap">
          <table class="summer-att-display-table">
            <thead><tr>${heads}</tr></thead>
            <tbody><tr>${cells}</tr></tbody>
          </table>
        </div>`;
    }

    function attendanceCheckboxes(a) {
      const att = a.attendance || {};
      return `<div class="summer-att-day-row">${[1, 2, 3, 4, 5, 6].map((d) => `
        <label class="summer-att-day-toggle summer-att-day-toggle--inline">
          <input type="checkbox" name="attendance_day${d}" value="1"${att[`day${d}`] ? ' checked' : ''}>
          <span class="summer-att-day-face" aria-hidden="true"></span>
          <span class="summer-att-day-label">Day ${d}</span>
        </label>
      `).join('')}</div>`;
    }

    function openModal(id) {
      document.getElementById(id)?.classList.add('is-open');
    }

    function closeModal(id) {
      document.getElementById(id)?.classList.remove('is-open');
    }

    function updateGlobalDateHint() {
      const hint = sEl('summerGlobalDateHint');
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

    function getReportExportDateLabel() {
      if (!isReportsPage()) return '';
      const { from, to } = getGlobalDateRange();
      if (from && to && from !== to) return `${fmtDate(from)} – ${fmtDate(to)}`;
      if (from) return fmtDate(from);
      const month = getGlobalMonth();
      if (month) {
        const d = new Date(`${month}-01T12:00:00`);
        return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
      }
      return '';
    }

    function normalizeClosedMessage(text) {
      const t = (text || '').trim();
      if (!t || /^(open|closed)$/i.test(t)) return SUMMER_CLOSED_DEFAULT;
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
        const sc = data.summer_course || {};
        registrationOpen = !!sc.open;
        registrationClosedMessage = normalizeClosedMessage(sc.closed_message);
      } catch (e) {
        registrationOpen = !!document.getElementById('toggleSummerOpen')?.checked;
        registrationClosedMessage = normalizeClosedMessage(
          document.getElementById('summerClosedMessage')?.value,
        );
      }
      const banner = document.getElementById('summerRegClosedBanner');
      const bannerText = document.getElementById('summerRegClosedBannerText');
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

    function toggleSummerFormFields() {
      const open = !!document.getElementById('toggleSummerOpen')?.checked;
      const openFields = document.getElementById('summerFormOpenFields');
      const closedFields = document.getElementById('summerFormClosedFields');
      if (openFields) openFields.hidden = !open;
      if (closedFields) closedFields.hidden = open;
      renderHistory();
      refreshRegistrationGate();
    }

    function dayAttendanceTaken(regs, day) {
      return (regs || []).some((r) => {
        if (r.attendance && r.attendance[`day${day}`]) return true;
        const notified = r.absence_notified_days || [];
        return notified.includes(day) || notified.includes(String(day));
      });
    }

    function dayAttendanceStats(regs, day) {
      const list = regs || [];
      let present = 0;
      let absent = 0;
      list.forEach((r) => {
        if (r.attendance && r.attendance[`day${day}`]) present += 1;
        else absent += 1;
      });
      return { present, absent, total: list.length };
    }

    function regDufcadLabel(r) {
      const conv = (r?.convocation || '').trim();
      if (!conv) return 'Other';
      if (isGuestConvocation(conv)) return 'Guest';
      return dufcadDisplayFromConvocation(conv) || conv;
    }

    function nameListOl(names) {
      if (!names.length) return '<li class="summer-report-list-empty">None</li>';
      return names.map((n, i) => `<li class="summer-report-break-avoid"><span class="summer-report-list-num">${i + 1}</span>${esc(n)}</li>`).join('');
    }

    function dufcadSortIndex(label, dufcadOrder) {
      const i = (dufcadOrder || []).indexOf(label);
      return i >= 0 ? i : 999;
    }

    function sortRegistrationsForReport(regs, order = 'alpha') {
      const list = [...(regs || [])];
      const dufcadOrder = attendanceDufcadOptions(list);
      list.sort((a, b) => {
        const nameA = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        if (order === 'dufcad') {
          const di = dufcadSortIndex(regDufcadLabel(a), dufcadOrder) - dufcadSortIndex(regDufcadLabel(b), dufcadOrder);
          if (di !== 0) return di;
        }
        return nameA;
      });
      return list;
    }

    function attendeesTableHtml(data, regs, opts = {}) {
      const order = opts.order || 'alpha';
      const sorted = sortRegistrationsForReport(regs, order);
      const takenDays = {};
      for (let d = 1; d <= 6; d++) takenDays[d] = dayAttendanceTaken(sorted, d);
      const scopeDays = daysForAbsenceScope(sorted);
      const rows = sorted.map((r, i) => {
        const att = r.attendance || {};
        const days = [1, 2, 3, 4, 5, 6].map((d) => {
          if (!takenDays[d]) return '';
          return att[`day${d}`] ? '✅' : '❌';
        }).join('</td><td>');
        const dufcadLabel = regDufcadLabel(r) || '—';
        const absentCount = studentAbsenceCount(r, scopeDays);
        const heavyAbsent = scopeDays.length && absentCount >= 3;
        return `
        <tr class="${heavyAbsent ? 'summer-report-row--heavy-absent' : ''}"${heavyAbsent ? ` title="${absentCount} absences"` : ''}>
          <td>${i + 1}</td>
          <td>${esc(r.name)}</td>
          <td>${esc(dufcadLabel)}</td>
          <td>${esc(r.faculty)}</td>
          <td>${esc(r.university)}</td>
          <td>${esc(r.semester) || '—'}</td>
          <td>${days}</td>
        </tr>
      `;
      }).join('');
      return `
        <h3>All Attendees (${data.registration_count ?? sorted.length})</h3>
        <div class="contest-report-participants-wrap">
          <table class="contest-report-participants-table contest-report-participants-table--summer">
            <thead>
              <tr><th>#</th><th>Name</th><th>Dufcad</th><th>Faculty</th><th>University</th><th>Semester</th><th>D1</th><th>D2</th><th>D3</th><th>D4</th><th>D5</th><th>D6</th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="12">No registrations</td></tr>'}</tbody>
          </table>
        </div>
      `;
    }

    function takenDayNumbers(regs) {
      return [1, 2, 3, 4, 5, 6].filter((d) => dayAttendanceTaken(regs, d));
    }

    function daysForAbsenceScope(regs) {
      const taken = takenDayNumbers(regs);
      return taken.length ? taken : [];
    }

    function studentAbsenceCount(r, days) {
      return (days || []).reduce((n, d) => (
        n + ((r.attendance && r.attendance[`day${d}`]) ? 0 : 1)
      ), 0);
    }

    function studentIsUnabsent(r, days) {
      if (!(days || []).length) return false;
      return days.every((d) => !!(r.attendance && r.attendance[`day${d}`]));
    }

    function reportFilterLabel(filter) {
      if (!filter || filter === 'all') return 'All (full report)';
      if (/^day([1-6])$/.test(filter)) return `Day ${filter.slice(3)} only`;
      if (filter === 'most-absent') return 'Most absent';
      if (filter === 'unabsent') return 'Unabsent (always present)';
      return filter;
    }

    function dayAttendanceListsHtml(regs, opts = {}) {
      const list = regs || [];
      const onlyDay = opts.onlyDay != null ? parseInt(opts.onlyDay, 10) : null;
      const dufcadOrder = attendanceDufcadOptions(list);
      const sections = [];
      for (let d = 1; d <= 6; d++) {
        if (onlyDay != null && d !== onlyDay) continue;
        if (!dayAttendanceTaken(list, d)) continue;
        const byDufcad = new Map();
        dufcadOrder.forEach((label) => byDufcad.set(label, { present: [], absent: [] }));
        list.forEach((r) => {
          const label = regDufcadLabel(r);
          if (!byDufcad.has(label)) byDufcad.set(label, { present: [], absent: [] });
          const bucket = byDufcad.get(label);
          const name = r.name || '—';
          if (r.attendance && r.attendance[`day${d}`]) bucket.present.push(name);
          else bucket.absent.push(name);
        });
        const dufcadBlocks = [...byDufcad.entries()]
          .filter(([, g]) => g.present.length || g.absent.length)
          .map(([label, g]) => {
            g.present.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            g.absent.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            return `
            <div class="summer-report-dufcad-block summer-report-break-avoid">
              <h4 class="summer-report-dufcad-title">${esc(label)} <span>— ${g.present.length} present · ${g.absent.length} absent</span></h4>
              <div class="summer-report-day-lists">
                <div class="summer-report-day-list summer-report-day-list--present">
                  <h4>Present (${g.present.length})</h4>
                  <ol>${nameListOl(g.present)}</ol>
                </div>
                <div class="summer-report-day-list summer-report-day-list--absent">
                  <h4>Absent (${g.absent.length})</h4>
                  <ol>${nameListOl(g.absent)}</ol>
                </div>
              </div>
            </div>
          `;
          }).join('');
        sections.push(`
          <section class="summer-report-day-section summer-report-break-avoid">
            <h3>Day ${d} attendance</h3>
            ${dufcadBlocks}
          </section>
        `);
      }
      if (!sections.length) {
        return `<p class="summer-report-day-lists-hint">No attendance lists for this filter yet.</p>`;
      }
      return `
        <h3>Attendance lists</h3>
        <p class="summer-report-day-lists-hint">${onlyDay != null
          ? `Day ${onlyDay} present and absent, grouped by dufcad.`
          : 'Present and absent for each taken day, grouped by dufcad.'}</p>
        ${sections.join('')}
      `;
    }

    function dayStatsCardsHtml(regs, opts = {}) {
      const activeDay = opts.activeDay != null ? parseInt(opts.activeDay, 10) : null;
      const cards = [1, 2, 3, 4, 5, 6].map((d) => {
        const { present, absent } = dayAttendanceStats(regs, d);
        const taken = dayAttendanceTaken(regs, d);
        const isActive = activeDay === d;
        const clickable = !!opts.clickableDays && taken;
        const tag = clickable ? 'button' : 'div';
        const typeAttr = clickable ? ' type="button"' : '';
        const dataAttr = clickable ? ` data-summer-report-filter="day${d}"` : '';
        return `
          <${tag}${typeAttr}${dataAttr} class="summer-report-day-card${taken ? ' is-taken' : ''}${isActive ? ' is-active-day' : ''}${clickable ? ' is-clickable' : ''}">
            <span class="summer-report-day-card-label">Day ${d}</span>
            <strong>${present} present</strong>
            <span class="summer-report-day-card-absent">${absent} absent</span>
          </${tag}>
        `;
      }).join('');
      return `<div class="summer-report-day-cards">${cards}</div>`;
    }

    function buildAbsenceRankedListsHtml(regs, mode) {
      const days = daysForAbsenceScope(regs);
      if (!days.length) {
        return `<p class="summer-report-day-lists-hint">No attendance has been taken yet.</p>`;
      }
      const dufcadOrder = attendanceDufcadOptions(regs);
      const scoped = (regs || []).map((r) => ({
        r,
        dufcad: regDufcadLabel(r) || '—',
        absent: studentAbsenceCount(r, days),
        present: days.length - studentAbsenceCount(r, days),
        name: r.name || '—',
      }));
      let filtered;
      let title;
      let hint;
      if (mode === 'most-absent') {
        filtered = scoped.filter((x) => x.absent > 0);
        title = `Most absent (${filtered.length})`;
        hint = `Grouped by dufcad, ranked by missed days among taken days (${days.map((d) => `D${d}`).join(', ')}). Rows with 3+ absences are highlighted.`;
      } else {
        filtered = scoped.filter((x) => studentIsUnabsent(x.r, days));
        title = `Unabsent — always present (${filtered.length})`;
        hint = `Grouped by dufcad. Present on every taken day (${days.map((d) => `D${d}`).join(', ')}).`;
      }

      const byDufcad = new Map();
      dufcadOrder.forEach((label) => byDufcad.set(label, []));
      filtered.forEach((x) => {
        if (!byDufcad.has(x.dufcad)) byDufcad.set(x.dufcad, []);
        byDufcad.get(x.dufcad).push(x);
      });

      const blocks = [...byDufcad.entries()]
        .filter(([, rows]) => rows.length)
        .map(([label, rows]) => {
          if (mode === 'most-absent') {
            rows.sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          } else {
            rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          }
          const lis = rows.map((x, i) => {
            const detail = mode === 'most-absent'
              ? ` — ${x.absent} absent / ${days.length} days`
              : ` — ${x.present}/${days.length} present`;
            const heavy = mode === 'most-absent' && x.absent >= 3;
            return `<li class="summer-report-break-avoid${heavy ? ' summer-report-li--heavy-absent' : ''}"><span class="summer-report-list-num">${i + 1}</span>${esc(x.name)}${esc(detail)}</li>`;
          }).join('');
          return `
            <div class="summer-report-dufcad-block summer-report-break-avoid">
              <h4 class="summer-report-dufcad-title">${esc(label)} <span>— ${rows.length}</span></h4>
              <div class="summer-report-day-list summer-report-day-list--${mode === 'most-absent' ? 'absent' : 'present'}">
                <ol>${lis}</ol>
              </div>
            </div>
          `;
        }).join('');

      return `
        <h3>${esc(title)}</h3>
        <p class="summer-report-day-lists-hint">${esc(hint)}</p>
        ${blocks || '<p class="summer-report-day-lists-hint">None</p>'}
      `;
    }

    function reportViewerFilterOptionsHtml(regs, { forSheet = false } = {}) {
      const taken = takenDayNumbers(regs);
      const dayBtns = [1, 2, 3, 4, 5, 6].map((d) => {
        const disabled = !taken.includes(d);
        const active = reportViewerFilter === `day${d}`;
        return `<button type="button" class="summer-report-filter-btn${active ? ' is-active' : ''}" data-summer-report-filter="day${d}" ${disabled ? 'disabled title="Attendance not taken yet"' : ''}>Day ${d}</button>`;
      }).join('');
      return `
        <div class="summer-report-filter-bar${forSheet ? ' summer-report-filter-bar--sheet' : ''}" role="group" aria-label="Report filter and order">
          <button type="button" class="summer-report-filter-btn${reportViewerFilter === 'all' ? ' is-active' : ''}" data-summer-report-filter="all">All</button>
          ${dayBtns}
          <button type="button" class="summer-report-filter-btn${reportViewerFilter === 'most-absent' ? ' is-active' : ''}" data-summer-report-filter="most-absent">Most absent</button>
          <button type="button" class="summer-report-filter-btn${reportViewerFilter === 'unabsent' ? ' is-active' : ''}" data-summer-report-filter="unabsent">Unabsent</button>
          <span class="summer-report-order-inline">
            <label class="summer-report-order-label" for="summerReportOrderSelect">Order:</label>
            <select id="summerReportOrderSelect" class="summer-report-order-select" aria-label="Report order">
              <option value="alpha"${reportViewerOrder === 'alpha' ? ' selected' : ''}>Alphabetically</option>
              <option value="dufcad"${reportViewerOrder === 'dufcad' ? ' selected' : ''}>By dufcada</option>
            </select>
          </span>
        </div>
      `;
    }

    /** Report layout: courses + day cards + full ✅/❌ grid + lists (day filter only narrows lists). */
    function buildProgramReportHtml(data, year, filter = 'all', opts = {}) {
      const regs = data.registrations || [];
      const filterKey = filter || 'all';
      const dayMatch = /^day([1-6])$/.exec(filterKey);
      const onlyDay = dayMatch ? parseInt(dayMatch[1], 10) : null;
      const forViewer = !!opts.forViewer;
      const order = opts.order || (forViewer ? reportViewerOrder : 'alpha') || 'alpha';
      /* Controls live outside the scroll sheet so the Order <select> stays clickable. */
      const filterLine = forViewer || filterKey !== 'all'
        ? `<p style="color:#64748b;margin:0 0 12px;font-size:.85rem;"><strong>Filter:</strong> ${esc(reportFilterLabel(filterKey))} · <strong>Order:</strong> ${order === 'dufcad' ? 'By dufcada' : 'Alphabetically'}</p>`
        : `<p style="color:#64748b;margin:0 0 12px;font-size:.85rem;"><strong>Order:</strong> ${order === 'dufcad' ? 'By dufcada' : 'Alphabetically'}</p>`;

      const reportHead = `
        <h2><i class="fa-solid fa-sun"></i> ${programLabel(year)}</h2>
        <p style="color:#64748b;margin:0 0 8px;font-size:.85rem;">Generated ${new Date().toLocaleString()}</p>
        ${filterLine}
        <p><strong>Place:</strong> ${esc(data.place) || emptyLabel()}</p>
        <p><strong>Total registered:</strong> ${data.registration_count ?? regs.length}</p>
      `;

      const coursesBlock = `
        <h3>Courses offered</h3>
        ${coursesCardsHtml(data.courses_offered)}
      `;

      const dayCards = dayStatsCardsHtml(regs, {
        activeDay: onlyDay,
        clickableDays: forViewer,
      });

      /* Compact number summary under cards (always in export, even when name lists are skipped). */
      const daySummaryLines = [1, 2, 3, 4, 5, 6].map((d) => {
        if (!dayAttendanceTaken(regs, d)) {
          return `<li><strong>Day ${d}:</strong> attendance not taken</li>`;
        }
        const { present, absent } = dayAttendanceStats(regs, d);
        return `<li><strong>Day ${d}:</strong> ${present} present · ${absent} absent</li>`;
      }).join('');
      const daySummaryBlock = `
        <div class="summer-report-day-summary-block summer-report-break-avoid">
          <h3>Daily attendance summary</h3>
          ${dayCards}
          <ul class="summer-report-day-summary-list">${daySummaryLines}</ul>
        </div>
      `;

      if (filterKey === 'most-absent' || filterKey === 'unabsent') {
        return `
          <div class="contest-report-sheet summer-program-report" data-summer-report-filter="${esc(filterKey)}">
            ${reportHead}
            ${coursesBlock}
            ${daySummaryBlock}
            ${buildAbsenceRankedListsHtml(regs, filterKey)}
          </div>
        `;
      }

      /* Full D1–D6 grid always (taken days ✅/❌ only); day filter only affects lists below. */
      const skipDayLists = !!opts.skipDayLists;
      const listsHtml = skipDayLists
        ? `<p class="summer-report-day-lists-hint">Present/absent name lists: use Day 1–6 filters to download those separately (keeps All export fast).</p>`
        : dayAttendanceListsHtml(regs, onlyDay != null ? { onlyDay } : {});
      return `
        <div class="contest-report-sheet summer-program-report" data-summer-report-filter="${esc(filterKey)}">
          ${reportHead}
          ${coursesBlock}
          ${daySummaryBlock}
          ${attendeesTableHtml(data, regs, { order })}
          ${listsHtml}
        </div>
      `;
    }

    function buildSummerDayListSheetHtml(data, year, dayNum, order = 'alpha') {
      const regs = data.registrations || [];
      return `
        <div class="contest-report-sheet summer-program-report" data-summer-report-filter="day${dayNum}">
          <h2><i class="fa-solid fa-sun"></i> ${programLabel(year)} — Day ${dayNum}</h2>
          <p style="color:#64748b;margin:0 0 12px;font-size:.85rem;">Present / absent lists by dufcad · Order: ${order === 'dufcad' ? 'By dufcada' : 'Alphabetically'}</p>
          ${dayAttendanceListsHtml(regs, { onlyDay: dayNum })}
        </div>
      `;
    }

    function materializeSummerExportSheet(html) {
      const host = document.createElement('div');
      host.innerHTML = html;
      const sheet = host.firstElementChild;
      if (!sheet) return null;
      sheet.querySelectorAll('.summer-report-day-card.is-clickable').forEach((el) => {
        el.removeAttribute('data-summer-report-filter');
        el.classList.remove('is-clickable');
        if (el.tagName === 'BUTTON') {
          const div = document.createElement('div');
          div.className = el.className;
          div.innerHTML = el.innerHTML;
          el.replaceWith(div);
        }
      });
      return sheet;
    }

    let reportViewerYear = null;
    let reportViewerFilter = 'all';
    let reportViewerOrder = 'alpha';
    let reportViewerData = null;

    function renderReportViewerBody() {
      const body = document.getElementById('summerReportViewerBody');
      if (!body || !reportViewerData || reportViewerYear == null) return;
      const regs = reportViewerData.registrations || [];
      body.innerHTML = `
        ${reportViewerFilterOptionsHtml(regs, { forSheet: true })}
        <div id="summerReportViewerSheet" class="summer-report-viewer-sheet">
          ${buildProgramReportHtml(reportViewerData, reportViewerYear, reportViewerFilter, { forViewer: true, order: reportViewerOrder })}
        </div>
      `;
    }

    function ensureProgramReportViewerModal() {
      if (document.getElementById('summerReportViewerModal')) return;
      const el = document.createElement('div');
      el.id = 'summerReportViewerModal';
      el.className = 'portal-modal-overlay';
      el.style.zIndex = '3003';
      el.innerHTML = `
        <div class="portal-modal-card portal-modal-card--lg summer-report-viewer-card">
          <div class="portal-modal-head">
            <h3 id="summerReportViewerTitle">Program report</h3>
            <button type="button" class="portal-modal-close" id="summerReportViewerClose" aria-label="Close">&times;</button>
          </div>
          <p class="summer-report-viewer-hint">One preview: pick a filter in the report, then Print / Image / PDF. Top Export still exports the whole report.</p>
          <div id="summerReportViewerBody" class="summer-report-viewer-body"></div>
          <div class="summer-report-viewer-actions">
            <button type="button" class="btn btn-outline" data-summer-viewer-export="print"><i class="fa-solid fa-print"></i> Print</button>
            <button type="button" class="btn btn-outline" data-summer-viewer-export="image"><i class="fa-solid fa-image"></i> Download Image</button>
            <button type="button" class="btn btn-primary" data-summer-viewer-export="pdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      el.querySelector('#summerReportViewerClose')?.addEventListener('click', () => closeModal('summerReportViewerModal'));
      el.addEventListener('click', (e) => { if (e.target === el) closeModal('summerReportViewerModal'); });
      el.addEventListener('click', (e) => {
        const filterBtn = e.target.closest('[data-summer-report-filter]');
        if (filterBtn && !filterBtn.disabled) {
          reportViewerFilter = filterBtn.dataset.summerReportFilter || 'all';
          renderReportViewerBody();
          return;
        }
        const exportBtn = e.target.closest('[data-summer-viewer-export]');
        if (exportBtn) {
          exportFilteredProgramReport(exportBtn.dataset.summerViewerExport);
        }
      });
      el.addEventListener('change', (e) => {
        const orderSel = e.target.closest('#summerReportOrderSelect');
        if (!orderSel) return;
        reportViewerOrder = orderSel.value === 'dufcad' ? 'dufcad' : 'alpha';
        renderReportViewerBody();
      });
      /* Keep native select usable inside the modal (avoid parent click steal). */
      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('#summerReportOrderSelect')) e.stopPropagation();
      }, true);
    }

    async function openProgramReportViewer(year) {
      if (!isReportsPage()) return;
      ensureProgramReportViewerModal();
      reportViewerYear = year;
      reportViewerFilter = 'all';
      reportViewerOrder = 'alpha';
      reportViewerData = null;
      const title = document.getElementById('summerReportViewerTitle');
      const body = document.getElementById('summerReportViewerBody');
      if (title) title.textContent = programLabel(year);
      if (body) body.innerHTML = '<p style="padding:16px;color:var(--text-muted);">Loading report…</p>';
      openModal('summerReportViewerModal');
      try {
        reportViewerData = await fetchProgram(year);
        renderReportViewerBody();
      } catch (err) {
        console.error('openProgramReportViewer failed', err);
        if (body) body.innerHTML = '<p style="padding:16px;color:#dc2626;">Could not load program report.</p>';
      }
    }

    async function exportFilteredProgramReport(action) {
      if (typeof ReportExport === 'undefined') {
        alert('Export is not available on this page.');
        return;
      }
      if (!reportViewerData || reportViewerYear == null) return;

      const filterSlug = String(reportViewerFilter || 'all').replace(/[^\w\-]+/g, '_');
      const orderSlug = reportViewerOrder === 'dufcad' ? 'dufcad' : 'alpha';
      const base = `Summer_Course_${reportViewerYear}_${filterSlug}_${orderSlug}`;
      const order = reportViewerOrder;
      const mounted = [];
      const actions = document.querySelector('.summer-report-viewer-actions');
      const busyBtns = actions ? [...actions.querySelectorAll('button')] : [];

      const mount = (sheet) => {
        if (!sheet) return null;
        document.body.appendChild(sheet);
        mounted.push(sheet);
        return sheet;
      };

      const setBusy = (on) => {
        busyBtns.forEach((b) => {
          b.disabled = !!on;
        });
        if (actions) {
          actions.dataset.exportBusy = on ? '1' : '';
          if (on) {
            let tip = actions.querySelector('.summer-export-busy-tip');
            if (!tip) {
              tip = document.createElement('p');
              tip.className = 'summer-export-busy-tip';
              tip.style.cssText = 'margin:8px 0 0;font-size:.85rem;color:var(--text-muted);';
              actions.appendChild(tip);
            }
            tip.textContent = reportViewerFilter === 'all'
              ? 'Preparing full report (table + all day summaries)…'
              : 'Preparing download…';
          } else {
            actions.querySelector('.summer-export-busy-tip')?.remove();
          }
        }
      };

      setBusy(true);
      try {
        /* Full All report: ✅/❌ table + day cards + all days present/absent lists.
          Fast path in ReportExport (scale 1 / portrait) keeps this downloadable. */
        const sheet = mount(materializeSummerExportSheet(
          buildProgramReportHtml(reportViewerData, reportViewerYear, reportViewerFilter, {
            forViewer: false,
            order,
            skipDayLists: false,
          }),
        ));
        if (!sheet) return;
        if (action === 'pdf') await ReportExport.downloadPdf(sheet, base, { preview: false });
        else if (action === 'print') await ReportExport.printElement(sheet);
        else if (action === 'image') await ReportExport.downloadImage(sheet, base);
      } catch (e) {
        console.error('Summer report export failed', e);
        alert('Export failed. Try Print, or download one day at a time.');
      } finally {
        setBusy(false);
        mounted.forEach((s) => {
          if (s.parentElement) document.body.removeChild(s);
        });
      }
    }

    function ensureProgramExportModal() {
      if (document.getElementById('summerExportModal')) return;
      const el = document.createElement('div');
      el.id = 'summerExportModal';
      el.className = 'portal-modal-overlay';
      el.style.zIndex = '3002';
      el.innerHTML = `
        <div class="portal-modal-card portal-modal-card--sm">
          <div class="portal-modal-head">
            <h3 id="summerExportTitle">Export program report</h3>
            <button type="button" class="portal-modal-close" id="summerExportClose" aria-label="Close">&times;</button>
          </div>
          <p style="font-size:.88rem;color:var(--text-muted);margin:0 0 14px;">Full report with courses and all attendees.</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button type="button" class="btn btn-outline" data-summer-export-action="print"><i class="fa-solid fa-print"></i> Print</button>
            <button type="button" class="btn btn-outline" data-summer-export-action="image"><i class="fa-solid fa-image"></i> Download Image</button>
            <button type="button" class="btn btn-primary" data-summer-export-action="pdf"><i class="fa-solid fa-file-pdf"></i> Preview PDF</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      el.querySelector('#summerExportClose')?.addEventListener('click', () => closeModal('summerExportModal'));
      el.addEventListener('click', (e) => { if (e.target === el) closeModal('summerExportModal'); });
      el.querySelectorAll('[data-summer-export-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.summerExportAction;
          const year = el.dataset.year;
          if (year) exportProgram(parseInt(year, 10), action);
          closeModal('summerExportModal');
        });
      });
    }

    async function buildWholeReportElement() {
      const rows = getDateFilteredHistory();
      if (!rows.length) return null;
      const bundle = document.createElement('div');
      bundle.className = 'quran-whole-report-bundle';
      const dataList = await Promise.all(rows.map((h) => fetchProgram(h.year)));
      rows.forEach((h, i) => {
        const fragment = document.createElement('div');
        fragment.innerHTML = buildProgramReportHtml(dataList[i], h.year, 'all', { includeAttendeesTable: true });
        const sheet = fragment.firstElementChild;
        if (sheet) bundle.appendChild(sheet);
      });
      return bundle;
    }

    async function exportWholeReport(action) {
      if (typeof ReportExport?.closeAllDropdowns === 'function') {
        ReportExport.closeAllDropdowns();
      }
      if (!isReportsPage()) return;
      if (typeof ReportExport === 'undefined') {
        alert('Export is not available on this page.');
        return;
      }
      const rows = getDateFilteredHistory();
      if (!rows.length) {
        alert('No summer programs in this date range to export.');
        return;
      }
      let sheet;
      try {
        sheet = await buildWholeReportElement();
      } catch (e) {
        console.error('Whole summer report export failed', e);
        alert('Could not load program data for export.');
        return;
      }
      if (!sheet) return;
      const base = (getReportExportDateLabel() || 'Summer_Course_Report').replace(/[^\w\-]+/g, '_').slice(0, 80);
      const title = getReportExportDateLabel()
        ? `Summer Course — ${getReportExportDateLabel()}`
        : 'Summer Course Report';
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

    async function exportProgram(year, action) {
      if (typeof ReportExport?.closeAllDropdowns === 'function') {
        ReportExport.closeAllDropdowns();
      }
      if (typeof ReportExport === 'undefined') {
        alert('Export is not available on this page.');
        return;
      }
      const data = await fetchProgram(year);
      const host = document.createElement('div');
      host.innerHTML = buildProgramReportHtml(data, year, 'all', { includeAttendeesTable: true });
      const sheet = host.firstElementChild;
      const base = `Summer_Course_${year}`;
      if (action === 'pdf') {
        await ReportExport.previewBeforeDownload(sheet, base, programLabel(year));
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
      const el = sEl('summer-stats');
      if (!el) return;
      const totalPrograms = history.length;
      const totalAttendees = appsLinkedToAdminPrograms(false).length;
      const registrations = currentProgramRegistrations();
      el.innerHTML = `
        <div class="stat-card"><div class="stat-icon icon-orange"><i class="fa-solid fa-sun"></i></div><div class="stat-info"><h4>${totalPrograms}</h4><p>Total programs</p><small style="color:var(--text-muted);font-size:.72rem;">Ever made</small></div></div>
        <div class="stat-card"><div class="stat-icon icon-green"><i class="fa-solid fa-user-check"></i></div><div class="stat-info"><h4>${totalAttendees}</h4><p>Total attendees</p><small style="color:var(--text-muted);font-size:.72rem;">Ever registered</small></div></div>
        <div class="stat-card"><div class="stat-icon icon-blue"><i class="fa-solid fa-calendar"></i></div><div class="stat-info"><h4>${registrations}</h4><p>Registrations</p><small style="color:var(--text-muted);font-size:.72rem;">Current program</small></div></div>
      `;
    }

    function renderHistory() {
      const tbody = sEl('summerHistoryBody');
      if (!tbody) return;
      if (!history.length) {
        const emptyMsg = isReportsPage()
          ? 'No summer programs yet.'
          : 'No summer programs yet. Click <strong>Add summer course year</strong> above.';
        tbody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">${emptyMsg}</td></tr>`;
        return;
      }
      const rows = getDateFilteredHistory();
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">No summer programs in this date range.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((h) => `
        <tr class="${selectedProgramYear === h.year ? 'hsf-program-row--selected' : ''}" style="border-bottom:1px solid var(--border);">
          <td style="padding:10px;font-weight:700;">${programNameCell(h.year)}</td>
          <td style="padding:10px;font-size:.82rem;">${fmtDate(h.start_date || programDateForYear(h.year))}</td>
          <td style="padding:10px;">${h.total_registered ?? h.total_attended ?? 0}</td>
          <td class="reg-action-col no-print" style="padding:10px;">${programActionBtns(h.year)}</td>
        </tr>
      `).join('');
      bindProgramRowExports();
      syncRegActionColumnVisibility();
    }

    function populateDufcadFilter() {
      const sel = sEl('summerFilterDufcad');
      if (!sel) return;
      const current = sel.value;
      const dufcads = attendanceDufcadOptions(getProgramYearApps());
      sel.innerHTML = '<option value="">All dufcad</option>' + dufcads.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
      if (current && (dufcads.includes(current) || dufcads.some((d) => attendanceFilterMatches(d, current)))) {
        const match = dufcads.find((d) => d === current || attendanceFilterMatches(d, current));
        sel.value = match || '';
      }
    }

    function getFilteredApps() {
      const q = (sEl('summerFilterSearch')?.value || '').trim().toLowerCase();
      const status = sEl('summerFilterStatus')?.value || '';
      const dufcad = sEl('summerFilterDufcad')?.value || '';
      const base = getProgramYearApps();
      return base.filter((a) => {
        if (q && !(a.name || '').toLowerCase().includes(q)) return false;
        if (status === 'new' && a.is_read) return false;
        if (status === 'read' && !a.is_read) return false;
        if (dufcad && !attendanceFilterMatches(a.convocation, dufcad)) return false;
        return true;
      });
    }

    function renderApps() {
      const tbody = sEl('summerAppsBody');
      if (!tbody) return;
      if (!history.length && !isReportsPage()) {
        tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">No summer program yet. Click <strong>Add summer course year</strong> above, then add attendees.</td></tr>`;
        return;
      }
      const base = getProgramYearApps();
      const filtered = getFilteredApps();
      const yearHint = selectedProgramYear && !isReportsPage() ? ` for ${programLabel(selectedProgramYear)}` : '';
      const emptyScope = selectedProgramYear && !isReportsPage() ? '' : ' in this date range';
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
          <td class="reg-col-name">${esc(a.name)}</td>
          <td class="reg-col-dufcad">${esc(isGuestConvocation(a.convocation) ? 'Guest' : (dufcadDisplayFromConvocation(a.convocation) || a.convocation || '—'))}</td>
          <td class="reg-col-faculty">${esc(a.faculty)}</td>
          <td class="reg-col-university">${esc(a.university)}</td>
          <td class="reg-col-semester">${esc(a.semester) || '—'}</td>
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
        updateRegistrationsTitle();
        populateDufcadFilter();
        renderApps();
      } catch (err) {
        console.error('Summer course filters failed', err);
        showLoadError();
      }
    }

    function showLoadError() {
      const tbody = sEl('summerAppsBody');
      const histBody = sEl('summerHistoryBody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:#dc2626;">Could not display data.</td></tr>`;
      if (histBody) histBody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:#dc2626;">Could not display history.</td></tr>`;
    }

    async function fetchJson(path, opts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        return await fetch(`${getApi()}${path}`, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    async function loadFormSettings() {
      if (!document.getElementById('toggleSummerOpen')) return;
      const res = await fetchJson('/form-settings');
      const s = await res.json();
      document.getElementById('toggleSummerOpen').checked = !!s.summer_course_open;
      document.getElementById('summerHeadline').value = s.summer_headline || 'Summer Course Registration';
      document.getElementById('summerSubtitle').value = s.summer_subtitle || 'Naadiga Ardayda Deeqda Waxbarasho HSF';
      const deadlineEl = document.getElementById('summerDeadlineMessage');
      if (deadlineEl) deadlineEl.value = s.summer_deadline_message || '';
      const closedEl = document.getElementById('summerClosedMessage');
      if (closedEl) {
        closedEl.value = normalizeClosedMessage(s.summer_closed_message || '');
      }
      toggleSummerFormFields();
      await refreshRegistrationGate();
    }

    async function saveFormSettings() {
      const res = await fetchJson('/form-settings');
      const current = await res.json();
      const closedRaw = document.getElementById('summerClosedMessage')?.value.trim() || '';
      await fetchJson('/form-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...current,
          summer_course_open: document.getElementById('toggleSummerOpen').checked,
          summer_headline: document.getElementById('summerHeadline').value.trim() || 'Summer Course Registration',
          summer_subtitle: document.getElementById('summerSubtitle').value.trim() || 'Naadiga Ardayda Deeqda Waxbarasho HSF',
          summer_deadline_message: document.getElementById('summerDeadlineMessage')?.value.trim() || '',
          summer_closed_message: closedRaw || SUMMER_CLOSED_DEFAULT,
        }),
      });
      toggleSummerFormFields();
      await refreshRegistrationGate();
      const msg = document.getElementById('formSettingsMsg');
      if (msg) {
        msg.textContent = 'Saved.';
        setTimeout(() => { msg.textContent = ''; }, 2000);
      }
    }

    async function refreshSummerDayStates() {
      const y = history?.[0]?.year;
      if (!y) {
        global._summerProgramMeta = null;
        return;
      }
      try {
        global._summerProgramMeta = await fetchProgram(y);
      } catch (e) {
        global._summerProgramMeta = null;
      }
    }

    async function loadAllData() {
      const tbody = sEl('summerAppsBody');
      const histBody = sEl('summerHistoryBody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">Loading…</td></tr>`;
      if (histBody) histBody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:var(--text-muted);">Loading…</td></tr>`;
      try {
        const [appsRes, histRes] = await Promise.all([
          fetchJson('/summer-course'),
          fetchJson('/summer-course/years-history'),
        ]);
        if (!appsRes.ok || !histRes.ok) throw new Error('API error');
        apps = await appsRes.json();
        history = await histRes.json();
        if (!Array.isArray(apps)) apps = [];
        if (!Array.isArray(history)) history = [];
        if (history.length) {
          const years = history.map((h) => h.year);
          if (selectedProgramYear == null || !years.includes(selectedProgramYear)) {
            selectedProgramYear = history[0].year;
          }
        } else {
          selectedProgramYear = null;
        }
        await refreshSummerDayStates();
        applyGlobalFilters();
      } catch (e) {
        console.error('Summer course load failed', e);
        const msg = e?.name === 'AbortError'
          ? 'Request timed out. Is the backend running on port 5000?'
          : 'Could not load data. Check the backend connection.';
        if (tbody) tbody.innerHTML = `<tr><td colspan="${regColCount()}" style="padding:20px;text-align:center;color:#dc2626;">${msg}</td></tr>`;
        if (histBody) histBody.innerHTML = `<tr><td colspan="${histColCount()}" style="padding:20px;text-align:center;color:#dc2626;">${msg}</td></tr>`;
      }
    }

    async function fetchProgram(year) {
      const res = await fetchJson(`/summer-course/years/${year}`);
      return res.json();
    }

    function setupMonthFilter() {
      const monthPicker = sEl('summerGlobalMonthPicker');
      if (!monthPicker) return;
      // Leave empty by default so Program History shows all; filter only when user picks a month.
      monthPicker.value = '';
      if (monthPicker.dataset.summerBound !== '1') {
        monthPicker.dataset.summerBound = '1';
        monthPicker.addEventListener('change', () => {
          syncReportsBetweenDatesFromMonth();
          applyGlobalFilters();
        });
      }
    }

    function setupReportsDateFilter() {
      if (!isReportsPage()) return;
      const fromEl = document.getElementById('summerDateFrom');
      const toEl = document.getElementById('summerDateTo');
      if (!fromEl || !toEl) return;
      syncReportsBetweenDatesFromMonth();
      [fromEl, toEl].forEach((el) => {
        if (el.dataset.summerBound === '1') return;
        el.dataset.summerBound = '1';
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

    function bindModalCloses() {
      global.closeSummerProgramModal = () => closeModal('summerProgramModal');
      global.closeSummerDetail = () => closeModal('summerDetailModal');
      global.closeSummerRegEdit = () => closeModal('summerRegEditModal');
      [
        { id: 'summerProgramModal', close: () => closeModal('summerProgramModal') },
        { id: 'summerDetailModal', close: () => closeModal('summerDetailModal') },
        { id: 'summerRegEditModal', close: () => closeModal('summerRegEditModal') },
      ].forEach(({ id, close }) => {
        const modal = document.getElementById(id);
        if (!modal || modal.dataset.summerCloseBound === '1') return;
        modal.dataset.summerCloseBound = '1';
        modal.querySelector('.portal-modal-close')?.addEventListener('click', (e) => {
          e.preventDefault();
          close();
        });
        modal.addEventListener('click', (e) => {
          if (e.target === modal) close();
        });
      });
    }

    async function promptAddProgramYear() {
      ensureAddYearModal();
      const modal = document.getElementById('summerAddYearModal');
      const input = document.getElementById('summerAddYearInput');
      const msgEl = document.getElementById('summerAddYearMsg');
      input.value = '';
      msgEl.textContent = '';
      modal.classList.add('is-open');
      setTimeout(() => input.focus(), 50);
      modal._submit = async () => {
        msgEl.textContent = '';
        const year = parseInt(String(input.value).trim(), 10);
        if (!year || year < 2000 || year > 2100) {
          msgEl.textContent = 'Enter a valid year between 2000 and 2100.';
          return;
        }
        const res = await fetchJson('/summer-course/years', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409) {
            await loadAllData();
            modal.classList.remove('is-open');
            alert(data.error || 'That program year already exists — it is now shown in Program History.');
          } else {
            msgEl.textContent = data.error || 'Could not add program year.';
          }
          return;
        }
        modal.classList.remove('is-open');
        await loadAllData();
      };
    }

    let summerMemberSearchCache = null;
    let addAttendeeMemberConv = '';

    async function loadSummerMemberSearchCache() {
      if (summerMemberSearchCache) return summerMemberSearchCache;
      if (typeof getUsers === 'function') {
        summerMemberSearchCache = await getUsers();
        return summerMemberSearchCache;
      }
      summerMemberSearchCache = [];
      return summerMemberSearchCache;
    }

    function renderSummerMemberSearchResults(q) {
      const host = document.getElementById('addAttendeeResults');
      if (!host) return;
      const ql = (q || '').trim().toLowerCase();
      if (!ql || ql.length < 2) {
        host.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted);margin:0;">Type at least 2 characters to search members.</p>';
        return;
      }
      loadSummerMemberSearchCache().then((users) => {
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
          <button type="button" class="btn btn-outline btn-sm" style="width:100%;margin-bottom:6px;text-align:left;"
            data-user-id="${esc(u.id)}" data-user-name="${esc(u.name || '')}" data-user-conv="${esc(u.convocation || '')}"
            data-user-faculty="${esc(u.faculty || '')}" data-user-university="${esc(u.university || '')}"
            data-user-semester="${esc(semesterFromUser(u))}" data-user-graduated="${u.isGraduated ? '1' : '0'}">
            <strong>${esc(u.name || u.username)}</strong> <span style="color:var(--text-muted);">@${esc(u.username || u.id)}</span>
          </button>
        `).join('');
        host.querySelectorAll('[data-user-id]').forEach((btn) => {
          btn.addEventListener('click', () => {
            setAddAttendeeGuestMode(false);
            addAttendeeMemberConv = btn.dataset.userConv || '';
            document.getElementById('addAttendeeUserId').value = btn.dataset.userId;
            document.getElementById('addAttendeeConvocationRaw').value = btn.dataset.userConv || '';
            document.getElementById('addAttendeeName').value = btn.dataset.userName;
            document.getElementById('addAttendeeDufcad').value = dufcadDisplayFromConvocation(btn.dataset.userConv);
            document.getElementById('addAttendeeFaculty').value = btn.dataset.userFaculty;
            document.getElementById('addAttendeeUniversity').value = btn.dataset.userUniversity;
            document.getElementById('addAttendeeSemester').value = btn.dataset.userSemester;
            document.getElementById('addAttendeeSelected').textContent = `Selected: ${btn.dataset.userName} (@${btn.dataset.userId})`;
            host.innerHTML = '';
            syncAddAttendeeFieldLocks();
          });
        });
      });
    }

    function bindEvents() {
      if (eventsBound) return;
      ensureProgramExportModal();
      bindModalCloses();
      setupMonthFilter();
      setupReportsDateFilter();

      const toggleOpen = document.getElementById('toggleSummerOpen');
      if (toggleOpen) toggleOpen.addEventListener('change', toggleSummerFormFields);

      ['summerFilterSearch', 'summerFilterStatus', 'summerFilterDufcad'].forEach((id) => {
        const el = sEl(id);
        if (!el) return;
        el.addEventListener('input', renderApps);
        el.addEventListener('change', renderApps);
      });

      const programForm = document.getElementById('summerProgramEditForm');
      if (programForm) programForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const year = parseInt(document.getElementById('summerEditYear').value, 10);
        if (isYearRegistrationClosed(year)) {
          alert('This summer program has ended. Program details can no longer be edited.');
          return;
        }
        const res = await fetchJson(`/summer-course/years/${year}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            place: document.getElementById('summerEditPlace').value.trim(),
            courses_list: collectCourseEditList(),
            start_date: document.getElementById('summerEditStartDate')?.value || '',
          }),
        });
        const result = await res.json();
        if (!res.ok) {
          alert(result.error || 'Could not save.');
          return;
        }
        closeModal('summerProgramModal');
        await loadAllData();
      });

      const regForm = document.getElementById('summerRegEditForm');
      if (regForm) regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = parseInt(document.getElementById('summerRegEditId').value, 10);
        const msgEl = document.getElementById('summerRegEditMsg');
        if (msgEl) msgEl.textContent = '';
        const res = await fetchJson(`/summer-course/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('summerRegEditName').value.trim(),
            convocation: document.getElementById('summerRegEditDufcad').value.trim(),
            faculty: document.getElementById('summerRegEditFaculty').value.trim(),
            university: document.getElementById('summerRegEditUniversity').value.trim(),
            semester: document.getElementById('summerRegEditSemester')?.value.trim() || '',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = data.error || 'Could not save.';
          }
          return;
        }
        closeModal('summerRegEditModal');
        await loadAllData();
      });

      const addAttendeeForm = document.getElementById('addAttendeeForm');
      if (addAttendeeForm) addAttendeeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('addAttendeeMsg');
        if (msgEl) msgEl.textContent = '';
        const userId = document.getElementById('addAttendeeUserId')?.value;
        const guestMode = !!document.getElementById('addAttendeeGuestMode')?.checked;
        const year = addAttendeeTargetYear();
        if (!year) {
          if (msgEl) msgEl.textContent = 'Add a summer program in Program History first.';
          return;
        }
        if (isYearRegistrationClosed(year)) {
          if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = 'This summer program has ended. Create a new program year to register more members.';
          }
          return;
        }
        if (!guestMode && !userId) {
          if (msgEl) msgEl.textContent = 'Select an HSF member from search, or enable guest registration.';
          return;
        }
        const convocationRaw = document.getElementById('addAttendeeConvocationRaw')?.value.trim()
          || document.getElementById('addAttendeeDufcad')?.value.trim()
          || '';
        const submittedConv = guestMode ? '' : convocationRaw;
        if (!guestMode && userId) {
          const dufcadErr = validateMemberDufcad(addAttendeeMemberConv, submittedConv);
          if (dufcadErr) {
            if (msgEl) {
              msgEl.style.color = '#dc2626';
              msgEl.textContent = dufcadErr;
            }
            return;
          }
        }
        const guestEmail = document.getElementById('addAttendeeEmail')?.value.trim() || '';
        if (guestMode && guestEmail && !guestEmail.includes('@')) {
          if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = 'Enter a valid email, or leave it blank.';
          }
          return;
        }
        const res = await fetchJson('/summer-course/admin-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: guestMode ? undefined : userId,
            guest_registration: guestMode,
            email: guestMode ? (guestEmail || undefined) : undefined,
            year,
            name: document.getElementById('addAttendeeName')?.value.trim(),
            convocation: submittedConv,
            faculty: document.getElementById('addAttendeeFaculty')?.value.trim(),
            university: document.getElementById('addAttendeeUniversity')?.value.trim(),
            semester: document.getElementById('addAttendeeSemester')?.value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = data.error || 'Could not register.';
          }
          return;
        }
        closeModal('addAttendeeModal');
        await loadAllData();
      });

      const addAttendeeSearch = document.getElementById('addAttendeeSearch');
      if (addAttendeeSearch) {
        addAttendeeSearch.addEventListener('input', () => renderSummerMemberSearchResults(addAttendeeSearch.value));
      }
      const addAttendeeGuestMode = document.getElementById('addAttendeeGuestMode');
      if (addAttendeeGuestMode) {
        addAttendeeGuestMode.addEventListener('change', () => setAddAttendeeGuestMode(addAttendeeGuestMode.checked));
      }

      if (!global._summerAttChangeBound) {
        global._summerAttChangeBound = true;
        document.addEventListener('change', (e) => {
          const cb = e.target.closest('.summer-att-day-cb');
          if (!cb || cb.disabled) return;
          const panel = document.getElementById('summerProgramViewPanel');
          const tbody = sEl('summerAppsBody');
          const inMainTable = tbody && tbody.contains(cb);
          const inAttendancePanel = panel && panel.contains(cb);
          const day = parseInt(cb.dataset.day, 10);
          if (inAttendancePanel) {
            if (day >= 1 && day <= 6) {
              attendanceTouchedDays.add(day);
              attendanceFocusDay = day;
            }
            const row = cb.closest('tr.summer-att-row');
            const visible = getAttendancePanelRows();
            const visIdx = row ? visible.indexOf(row) : -1;
            if (visIdx >= 0) attendanceFocusStudentIdx = visIdx;
            advanceAttendanceStudent();
            return;
          }
          if (!inMainTable) return;
          const appId = parseInt(cb.dataset.appId, 10);
          if (!appId || !day) return;
          saveAttendanceDay(appId, day, cb.checked, cb);
        });
      }

      if (!global._summerAttFilterBound) {
        global._summerAttFilterBound = true;
        document.addEventListener('change', (e) => {
          const sel = e.target.closest('#summerAttFilterDufcad');
          if (!sel) return;
          attendanceFilterDufcad = sel.value || '';
          attendanceFocusStudentIdx = 0;
          applyAttendanceFilters();
        });
        document.addEventListener('input', (e) => {
          const search = e.target.closest('#summerAttSearch');
          if (!search) return;
          attendanceSearchQuery = search.value || '';
          attendanceFocusStudentIdx = 0;
          applyAttendanceFilters();
        });
      }

      if (!global._summerAttSaveBound) {
        global._summerAttSaveBound = true;
        document.addEventListener('click', (e) => {
          const btn = e.target.closest('#summerSaveAttendanceBtn');
          if (!btn || btn.disabled) return;
          const year = programViewCache?.year ?? selectedProgramYear;
          if (!year) return;
          saveProgramAttendance(year);
        });
      }

      eventsBound = true;
    }

    global.SummerCourseAdmin = {
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
      saveFormSettings,
      toggleSummerFormFields,
      exportProgram,
      exportWholeReport,
      getReportExportDateLabel,
      programLabel,
      selectProgramYear,
      openSelectedProgram() {
        if (selectedProgramYear != null) SummerCourseAdmin.viewProgram(selectedProgramYear);
      },
      openProgramExportPicker(year) {
        openProgramReportViewer(year);
      },
      openProgramReportViewer,
      closeSummerProgramModal: () => closeModal('summerProgramModal'),
      closeSummerDetail: () => closeModal('summerDetailModal'),
      closeSummerRegEdit: () => closeModal('summerRegEditModal'),
      promptAddProgramYear,
      openAddAttendee() {
        const year = addAttendeeTargetYear();
        if (year && isYearRegistrationClosed(year)) {
          alert('This summer program has ended. Create a new program year to register more members.');
          return;
        }
        if (!registrationOpen) {
          alert(registrationClosedMessage || SUMMER_CLOSED_DEFAULT);
          return;
        }
        addAttendeeMemberConv = '';
        document.getElementById('addAttendeeUserId').value = '';
        document.getElementById('addAttendeeConvocationRaw').value = '';
        document.getElementById('addAttendeeName').value = '';
        document.getElementById('addAttendeeDufcad').value = '';
        document.getElementById('addAttendeeFaculty').value = '';
        document.getElementById('addAttendeeUniversity').value = '';
        document.getElementById('addAttendeeSemester').value = '';
        document.getElementById('addAttendeeEmail').value = '';
        document.getElementById('addAttendeeSelected').textContent = '';
        setAddAttendeeGuestMode(false);
        syncAddAttendeeYearField();
        document.getElementById('addAttendeeMsg').textContent = '';
        document.getElementById('addAttendeeResults').innerHTML = '';
        const searchEl = document.getElementById('addAttendeeSearch');
        if (searchEl) searchEl.value = '';
        syncAddAttendeeFieldLocks();
        openModal('addAttendeeModal');
      },
      closeAddAttendee: () => closeModal('addAttendeeModal'),
      async viewProgram(year) {
        selectProgramYear(year);
        setProgramModalHeadVisible(false);
        const viewPanel = document.getElementById('summerProgramViewPanel');
        const editForm = document.getElementById('summerProgramEditForm');
        if (viewPanel) viewPanel.style.display = 'block';
        if (editForm) editForm.style.display = 'none';
        if (viewPanel) viewPanel.innerHTML = renderProgramLoadingPanel(year, 'info');
        openModal('summerProgramModal');
        try {
          const data = await fetchProgram(year);
          programViewCache = { year, data };
          global._summerProgramMeta = data;
          if (viewPanel) viewPanel.innerHTML = renderProgramInfoPanel(data, year);
        } catch (err) {
          console.error('viewProgram failed', err);
          if (viewPanel) {
            viewPanel.innerHTML = `
              <div class="hsf-program-modal-body">
                ${programModalBrandHtml(year)}
                <p style="color:#dc2626;margin:0;">Could not load program details. Please try again.</p>
              </div>`;
          }
        }
      },
      async showProgramAttendance(year) {
        setProgramModalHeadVisible(false);
        const viewPanel = document.getElementById('summerProgramViewPanel');
        const editForm = document.getElementById('summerProgramEditForm');
        if (viewPanel) viewPanel.style.display = 'block';
        if (editForm) editForm.style.display = 'none';
        const modal = document.getElementById('summerProgramModal');
        const alreadyOpen = modal?.classList.contains('is-open');
        if (viewPanel) viewPanel.innerHTML = renderProgramLoadingPanel(year, 'attendance');
        if (!alreadyOpen) openModal('summerProgramModal');
        try {
          const data = await fetchProgram(year);
          global._summerProgramMeta = data;
          programViewCache = { year, data };
          attendanceTouchedDays = new Set();
          attendanceFilterDufcad = '';
          attendanceSearchQuery = '';
          attendanceFocusDay = computeFocusDayFromRegs(data.registrations);
          attendanceFocusStudentIdx = 0;
          if (viewPanel) {
            viewPanel.innerHTML = renderProgramAttendancePanel(data, year);
            applyAttendanceFilters();
          }
        } catch (err) {
          console.error('showProgramAttendance failed', err);
          if (viewPanel) {
            viewPanel.innerHTML = `
              <div class="hsf-program-modal-body">
                ${programModalBrandHtml(year, 'Attendance')}
                <p style="color:#dc2626;margin:0;">Could not load attendance. Please try again.</p>
              </div>`;
          }
        }
      },
      addCourseRow() {
        const courses = collectCourseEditList();
        courses.push('');
        renderCourseEditList(courses);
      },
      removeCourseRow(idx) {
        const courses = collectCourseEditList();
        courses.splice(idx, 1);
        renderCourseEditList(courses.length ? courses : ['']);
      },
      async editProgram(year) {
        const data = await fetchProgram(year);
        if (data.is_ended) {
          alert('This summer program has ended. Program details can no longer be edited.');
          return;
        }
        global._summerProgramMeta = data;
        setProgramModalHeadVisible(true);
        document.getElementById('summerProgramModalTitle').textContent = `Edit ${programLabel(year)}`;
        document.getElementById('summerProgramViewPanel').style.display = 'none';
        document.getElementById('summerProgramEditForm').style.display = 'block';
        document.getElementById('summerEditYear').value = year;
        document.getElementById('summerEditPlace').value = data.place || '';
        const startEl = document.getElementById('summerEditStartDate');
        if (startEl) startEl.value = data.start_date ? data.start_date.slice(0, 10) : '';
        renderCourseEditList(data.courses_list || parseCoursesList(data.courses_offered));
        setProgramEditFormLocked(false);
        openModal('summerProgramModal');
      },
      showDetail(id) {
        const a = apps.find((x) => x.id === id);
        if (!a) return;
        document.getElementById('summerDetailContent').innerHTML = `
          <p><strong>Name:</strong> ${esc(a.name)}</p>
          <p><strong>Email:</strong> ${esc(a.email) || '—'}</p>
          <p><strong>Dufcad:</strong> ${esc(a.convocation)}</p>
          <p><strong>University:</strong> ${esc(a.university)}</p>
          <p><strong>Faculty:</strong> ${esc(a.faculty)}</p>
          <p><strong>Semester:</strong> ${esc(a.semester) || '—'}</p>
          <p><strong>Username:</strong> ${esc(a.username) || '—'}</p>
          <p style="margin-top:12px;"><strong>Attendance (6 days):</strong> ${attendanceSummary(a)}</p>
          ${attendanceDisplayHtml(a)}
        `;
        openModal('summerDetailModal');
        if (!a.is_read) {
          fetchJson(`/summer-course/${id}/read`, { method: 'POST' }).then(() => {
            a.is_read = true;
            applyGlobalFilters();
          });
        }
      },
      editRegistration(id) {
        const a = apps.find((x) => x.id === id);
        if (!a) return;
        document.getElementById('summerRegEditId').value = a.id;
        document.getElementById('summerRegEditTitle').textContent = `Edit — ${a.name}`;
        document.getElementById('summerRegEditName').value = a.name || '';
        document.getElementById('summerRegEditDufcad').value = a.convocation || '';
        document.getElementById('summerRegEditFaculty').value = a.faculty || '';
        document.getElementById('summerRegEditUniversity').value = a.university || '';
        document.getElementById('summerRegEditSemester').value = a.semester || '';
        const msgEl = document.getElementById('summerRegEditMsg');
        if (msgEl) msgEl.textContent = '';
        openModal('summerRegEditModal');
      },
      async deleteRegistration(id, refreshProgramYear) {
        const a = apps.find((x) => x.id === id);
        if (!a) return;
        if (!confirm(`Remove ${a.name} from summer course registrations?`)) return;
        const res = await fetchJson(`/summer-course/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error || 'Could not delete.');
          return;
        }
        await loadAllData();
        if (refreshProgramYear) {
          await SummerCourseAdmin.showProgramAttendance(refreshProgramYear);
        }
      },
      async deleteProgram(year) {
        const row = history.find((h) => h.year === year);
        const n = row?.total_attended ?? 0;
        const msg = n
          ? `Delete ${programLabel(year)} and all ${n} registration(s)? This cannot be undone.`
          : `Delete ${programLabel(year)}?`;
        if (!confirm(msg)) return;
        await fetchJson(`/summer-course/years/${year}`, { method: 'DELETE' });
        await loadAllData();
      },
    };
  })(typeof window !== 'undefined' ? window : globalThis);

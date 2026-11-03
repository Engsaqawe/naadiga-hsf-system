/**
 * Hormuud Salaam Foundation – API Client (data.js)
 * All data operations go through the Flask backend at http://localhost:5000/api
 */

const API_BASE = (() => {
  const host = window.location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "http://127.0.0.1:5000/api";
  }
  return "/api";
})();

const STORAGE_KEYS = {
  CURRENT_USER: "hsf_current_user",
};

/**
 * Robustly formats a profile picture URL.
 * Handles localhost port mapping and production relative paths.
 */
function getProfilePicUrl(user) {
    if (!user || !user.profilePic) {
        const name = user?.name || 'User';
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1e4a6d&color=fff`;
    }
    
    let url = user.profilePic;
    
    // If on localhost development, point to the Flask port 5000
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        if (!url.startsWith('http')) {
            // Ensure no double slashes
            const cleanPath = url.startsWith('/') ? url : `/${url}`;
            url = `http://localhost:5000${cleanPath}`;
        }
    }
    
    // Add cache-busting timestamp
    return `${url}${url.includes('?') ? '&' : '?'}t=${new Date().getTime()}`;
}

// ─────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry-friendly fetch for shared hosting (Passenger cold starts).
 * GET retries on network errors and 502/503/504. Uses cache: 'no-store'.
 */
async function apiFetch(path, options = {}) {
  const opts = { ...options };
  const method = String(opts.method || "GET").toUpperCase();
  const maxRetries = opts.retries != null
    ? Number(opts.retries)
    : (method === "GET" ? 2 : 0);
  const delayMs = opts.retryDelayMs != null ? Number(opts.retryDelayMs) : 700;
  delete opts.retries;
  delete opts.retryDelayMs;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        cache: method === "GET" ? "no-store" : "default",
        ...opts,
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        if (!res.ok) {
          if ([502, 503, 504].includes(res.status) && attempt < maxRetries) {
            await sleepMs(delayMs * (attempt + 1));
            continue;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        return null;
      }

      if (!res.ok) {
        if ([502, 503, 504].includes(res.status) && attempt < maxRetries) {
          await sleepMs(delayMs * (attempt + 1));
          continue;
        }
        return data || { success: false, error: `HTTP ${res.status}` };
      }

      return data;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleepMs(delayMs * (attempt + 1));
        continue;
      }
      console.error(`API error [${path}]:`, err);
      return null;
    }
  }
  if (lastError) console.error(`API error [${path}]:`, lastError);
  return null;
}

/** Reload portal lists when the browser tab becomes visible again (light refresh). */
function onPortalTabVisible(reloadFn) {
  if (typeof document === "undefined" || typeof reloadFn !== "function") return;
  let lastRun = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastRun < 4000) return;
    lastRun = now;
    Promise.resolve(reloadFn()).catch(() => {});
  });
}


// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────
async function loginUser(username, password) {
  return apiFetch("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

function getCurrentUser() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.CURRENT_USER) || "{}");
}

/** User-facing role label — internal role values stay unchanged. */
function displayRole(role) {
  const labels = {
    Student: "Member",
    "Main Leader": "Main Member Leader",
    Leader: "Convocation Leader",
    "Payment Sub Admin": "Payment Sub Admin",
    "Payment Admin": "Payment Admin",
    "Media Admin": "Media Admin",
  };
  return labels[role] || role || "Member";
}

function roleBadgeClass(role) {
  if (role === "Leader" || role === "Main Leader") return "badge-leader";
  if (role === "Payment Sub Admin" || role === "Payment Admin") return "badge-collector";
  if (role === "Media Admin") return "badge-leader";
  return "badge-student";
}

function applySettingsRoleBadge(el, role) {
  if (!el) return;
  el.textContent = displayRole(role);
  el.className = roleBadgeClass(role);
  el.style.display = "inline-block";
  el.style.padding = "6px 16px";
  el.style.borderRadius = "20px";
  el.style.fontWeight = "600";
}

function setCurrentUser(user) {
  localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  window.location.href = determineLoginPath();
}

function determineLoginPath() {
  // Walk up from pages/role/page.html → ../../login.html
  const depth = window.location.pathname.split("/").length - 1;
  const prefix = depth >= 3 ? "../../" : depth >= 2 ? "../" : "";
  return prefix + "login.html";
}

// ─────────────────────────────────────────────────────────────
// Users / Students
// ─────────────────────────────────────────────────────────────
async function getUsers(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const path = `/users${params ? "?" + params : ""}`;
  let data = await apiFetch(path);
  if (data === null) {
    await sleepMs(900);
    data = await apiFetch(path);
  }
  return Array.isArray(data) ? data : [];
}

async function getUserById(id) {
  return apiFetch(`/users/${encodeURIComponent(id)}`);
}

/** True when GET /users/:id returned a real member row (not an error payload). */
function isValidUserRecord(user) {
  return !!(user && user.id && user.name != null && !user.error);
}

async function addStudent(data) {
  return apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function editStudent(id, data) {
  return apiFetch(`/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async function deleteStudent(id) {
  return apiFetch(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function sendBroadcast(data) {
  return apiFetch("/users/broadcast", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────────────────────
// Convocations
// ─────────────────────────────────────────────────────────────
async function getConvocations() {
  let data = await apiFetch("/convocations");
  if (data === null) {
    await sleepMs(900);
    data = await apiFetch("/convocations");
  }
  return Array.isArray(data) ? data : [];
}

async function addConvocation(name, year) {
  return apiFetch("/convocations", {
    method: "POST",
    body: JSON.stringify({ name, year }),
  });
}

async function graduateConvocation(convocationName) {
  return apiFetch("/convocations/graduate", {
    method: "POST",
    body: JSON.stringify({ convocation: convocationName }),
  });
}

async function deleteConvocation(id) {
  return apiFetch(`/convocations/${id}`, { method: "DELETE" });
}

// ─────────────────────────────────────────────────────────────
// Meetings — shared attendance / eligibility helpers
// ─────────────────────────────────────────────────────────────
function dufcadNumberKey(convocation) {
  const m = String(convocation || "").match(/(\d+)/);
  return m ? m[1] : String(convocation || "").trim().toLowerCase();
}

function convocationsMatch(meetingConv, memberConv) {
  const mc = String(meetingConv || "").trim();
  const uc = String(memberConv || "").trim();
  if (!mc || mc.toLowerCase() === "all") return true;
  if (!uc) return false;
  const alnuur = (v) => String(v || "").trim().toLowerCase().replace(/-/g, "") === "alnuur";
  if (alnuur(mc) || alnuur(uc)) return alnuur(mc) && alnuur(uc);
  const mk = dufcadNumberKey(mc);
  const uk = dufcadNumberKey(uc);
  if (/^\d+$/.test(mk) && /^\d+$/.test(uk)) return mk === uk;
  return mc.toLowerCase() === uc.toLowerCase();
}

function isMeetingAttendanceFinalized(meet) {
  return !!(meet && (meet.attendanceTaken || (meet.participantsCount && meet.participantsCount > 0)));
}

/** True when more than 24 hours have passed since the meeting date (attendance window closed). */
function isMeetingAttendanceWindowClosed(meet) {
  if (!meet?.date) return false;
  const meetingStart = new Date(`${meet.date}T00:00:00`);
  if (Number.isNaN(meetingStart.getTime())) return false;
  return Date.now() > meetingStart.getTime() + 24 * 60 * 60 * 1000;
}

/** Lock Attend only after attendance is saved and the 24h edit window has passed. */
function isAttendButtonLocked(meet) {
  if (!isMeetingAttendanceFinalized(meet)) return false;
  return isMeetingAttendanceWindowClosed(meet);
}

function countMeetingTargetMembers(students, convocation, targetAudience) {
  const target = (targetAudience || "active").toLowerCase();
  return (students || []).filter((s) => {
    if (!s || s.role === "Public User" || s.role === "Alnuur") return false;
    if (String(s.id || "").startsWith("alnuur-")) return false;
    if (!convocationsMatch(convocation, s.convocation)) return false;
    if (target === "graduated") return !!s.isGraduated;
    if (target === "active") return !s.isGraduated;
    return true;
  }).length;
}

function getMeetingAttendanceRecord(meet, student, attendanceRecords = []) {
  if (!meet || !student) return null;
  return (attendanceRecords || []).find(
    (a) => a.meeting_id === meet.id && a.student_id === student.id
  ) || null;
}

/** Live roster rules — used when creating meetings and marking attendance (not historical reports). */
function meetingLiveEligibility(meet, student, attendanceRecords = []) {
  if (!meet || !meet.date || !student) return false;

  const mDate = new Date(meet.date);
  if (isNaN(mDate.getTime())) return false;
  mDate.setHours(0, 0, 0, 0);

  const regDate = student.created_at ? new Date(student.created_at) : new Date(0);
  regDate.setHours(0, 0, 0, 0);
  if (mDate < regDate) return false;

  if (mDate.getTime() === regDate.getTime()) {
    const hasRecord = (attendanceRecords || []).some(
      (a) => a.meeting_id === meet.id && a.student_id === student.id
    );
    if (!hasRecord && isMeetingAttendanceFinalized(meet)) return false;
  }

  if (!convocationsMatch(meet.convocation, student.convocation)) return false;

  const target = (meet.target_audience || "active").toLowerCase();
  if (target === "graduated" && !student.isGraduated) return false;
  if (target === "active" && student.isGraduated) return false;

  return true;
}

/**
 * Whether a member counts toward a finalized meeting (reports, stats, %).
 * Uses saved attendance rows as the historical snapshot — survives graduation.
 */
function meetingAppliesToStudent(meet, student, attendanceRecords = []) {
  if (!meet || !meet.date || !student) return false;
  if (!isMeetingAttendanceFinalized(meet)) return false;
  return !!getMeetingAttendanceRecord(meet, student, attendanceRecords);
}

/** Member dashboard: finalized history + open scheduled meetings they belong to. */
function meetingDashboardAppliesToStudent(meet, student, attendanceRecords = []) {
  if (!meet || !meet.date || !student) return false;
  if (isMeetingAttendanceFinalized(meet)) {
    return !!getMeetingAttendanceRecord(meet, student, attendanceRecords);
  }
  return meetingLiveEligibility(meet, student, attendanceRecords);
}

function meetingAttendanceRowsForMeeting(meet, attendanceRecords = []) {
  if (!meet) return [];
  return (attendanceRecords || []).filter((a) => a.meeting_id === meet.id);
}

function memberRowFromAttendanceRecord(rec, student) {
  const isExcused = !!(rec && rec.is_excused);
  let status = rec?.status || "Absent";
  if (isExcused && status !== "Present" && status !== "Late") {
    status = "Absent (excused)";
  }
  return {
    id: student?.id || rec?.student_id || "—",
    name: student?.name || rec?.student_id || "Unknown member",
    phone: student?.phone || "—",
    convocation: student?.convocation || "—",
    status,
    is_excused: isExcused,
  };
}

function getMeetingAttendanceStats(student, meetings, attendanceRecords, asOfDate = new Date()) {
  const asOf = new Date(asOfDate);
  asOf.setHours(23, 59, 59, 999);

  const applicable = (meetings || []).filter((meet) => {
    if (!meetingAppliesToStudent(meet, student, attendanceRecords)) return false;
    const mDate = new Date(meet.date);
    mDate.setHours(0, 0, 0, 0);
    const cutoff = new Date(asOf);
    cutoff.setHours(0, 0, 0, 0);
    return mDate <= cutoff;
  });

  let attended = 0;
  let missed = 0;
  applicable.forEach((meet) => {
    const rec = getMeetingAttendanceRecord(meet, student, attendanceRecords);
    if (!rec) return;
    if (rec.status === "Present" || rec.status === "Late") {
      attended++;
    } else {
      missed++;
    }
  });

  return { attended, missed, total: applicable.length };
}

/** Build attended / missed lists for a single meeting report. */
function buildSingleMeetingReportData(meet, students, attendanceRecords) {
  if (!meet) return null;

  const studentMap = new Map((students || []).map((s) => [s.id, s]));
  const meetingRows = meetingAttendanceRowsForMeeting(meet, attendanceRecords);
  const attended = [];
  const missed = [];
  const excused = [];

  meetingRows.forEach((rec) => {
    const student = studentMap.get(rec.student_id);
    const row = memberRowFromAttendanceRecord(rec, student);
    if (rec.status === "Present" || rec.status === "Late") {
      attended.push(row);
    } else if (row.is_excused) {
      excused.push(row);
    } else {
      missed.push(row);
    }
  });

  attended.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  missed.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  excused.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const convLabel =
    !meet.convocation || meet.convocation === "All"
      ? "All Convocations"
      : meet.convocation;
  const audience =
    (meet.target_audience || "active").toLowerCase() === "graduated"
      ? "Graduated members"
      : "Active members";

  return {
    meeting_id: meet.id,
    topic: meet.topic,
    date: meet.date,
    place: meet.place || "—",
    presenter: meet.presenter || "—",
    convocation: convLabel,
    target_audience: audience,
    attended,
    missed,
    excused,
    attended_count: attended.length,
    missed_count: missed.length,
    excused_count: excused.length,
    /** Total absences including excused (for summary tables). */
    absent_count: missed.length + excused.length,
    total: meetingRows.length,
    generated: new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

async function fetchMeetingAttendanceReportData(meetingId) {
  const data = await apiFetch(
    `/reports/meeting-attendance-data?meeting_id=${encodeURIComponent(meetingId)}`
  );
  if (!data || data.error) {
    return { error: data?.error || "Could not load meeting report." };
  }
  return data;
}

/** Attendance % for one finalized meeting (from saved attendance rows). */
function getMeetingParticipationRate(meet, students, attendanceRecords) {
  if (!isMeetingAttendanceFinalized(meet)) return null;
  const rows = meetingAttendanceRowsForMeeting(meet, attendanceRecords);
  if (rows.length === 0) return null;

  const present = rows.filter(
    (r) => r.status === "Present" || r.status === "Late"
  ).length;

  return Math.round((present / rows.length) * 100);
}

async function getMeetings(convocation) {
  const q = convocation ? `?convocation=${encodeURIComponent(convocation)}` : "";
  return (await apiFetch(`/meetings${q}`)) || [];
}

async function addMeeting(data) {
  return apiFetch("/meetings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function updateMeeting(id, data) {
  return apiFetch(`/meetings/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async function deleteMeeting(id) {
  return apiFetch(`/meetings/${id}`, { method: "DELETE" });
}

// ─────────────────────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────────────────────
async function getTransactions(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  return (await apiFetch(`/transactions${params ? "?" + params : ""}`)) || [];
}

async function deleteTransaction(id) {
  const res = await apiFetch(`/transactions/${id}`, { method: "DELETE" });
  return !!(res && res.success);
}

function formatCollectAmount(amount) {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return null;
  return `$${n.toFixed(2)}`;
}

function getDefaultCollectAmount() {
  const saved = localStorage.getItem("hsf_collect_amount");
  if (saved && !isNaN(parseFloat(saved)) && parseFloat(saved) > 0) {
    return parseFloat(saved).toFixed(2);
  }
  return "1.00";
}

function getCollectAmountInput(studentId) {
  if (studentId) return document.getElementById(`collect-amount-${studentId}`);
  return document.getElementById("collect-amount");
}

function readCollectAmount(studentId) {
  const input = getCollectAmountInput(studentId);
  if (!input) return null;
  const n = parseFloat(input.value);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

function parseTxnAmount(val) {
  if (val == null || val === "") return 0;
  const n = parseFloat(String(val).replace(/[$,]/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function formatTxnAmountDisplay(val) {
  return `$${parseTxnAmount(val).toFixed(2)}`;
}

function renderGroupedTransactionHistory(transactions, options = {}) {
  const opts = {
    groupByConvocation: false,
    allConvocations: [],
    selectedConv: "All",
    isCollector: false,
    isFutureDate: false,
    showAction: true,
    colspan: 9,
    ...options,
  };

  const emptyRow = `<tr><td colspan="${opts.colspan}" style="text-align:center;padding:2rem;color:var(--text-muted);">Ma jirto wax lacag ah oo la qaaday bishaan.</td></tr>`;
  if (!transactions || !transactions.length) return emptyRow;

  const rowHtml = (t, rowClass = "") => {
    const actionTd = opts.showAction
      ? `<td style="text-align:right;">
          ${opts.isCollector && !opts.isFutureDate
            ? `<button type="button" class="btn btn-outline" style="padding:5px 10px;font-size:0.78rem;color:#dc2626;border-color:#fecaca;"
                onclick="uncollectPayment(${t.id}, '${t.student_id}', '${t.month}')">
                <i class="fa-solid fa-rotate-left"></i> Uncollect
              </button>`
            : ""}
        </td>`
      : "";

    return `<tr class="${rowClass}">
      <td>${t.date}</td>
      <td><strong>${t.student_id}</strong></td>
      <td>${t.name}</td>
      <td>${t.convocation || "—"}</td>
      <td>${t.month}</td>
      <td><strong>${formatTxnAmountDisplay(t.amount)}</strong></td>
      <td>${t.collector || "System"}</td>
      <td><span class="badge badge-paid">${t.status}</span></td>
      ${actionTd}
    </tr>`;
  };

  if (!opts.groupByConvocation) {
    return transactions.map((t) => rowHtml(t)).join("");
  }

  const targetConvs =
    opts.selectedConv === "All"
      ? (opts.allConvocations.length
          ? opts.allConvocations.map((c) => c.name)
          : [...new Set(transactions.map((t) => t.convocation).filter(Boolean))])
      : [opts.selectedConv];

  const html = targetConvs
    .map((convName) => {
      const group = transactions.filter(
        (t) => (t.convocation || "").toLowerCase() === convName.toLowerCase()
      );
      if (!group.length) return "";
      const safeConv = convName.replace(/\s+/g, "-");
      return `
        <tr style="background:var(--bg-hover);cursor:pointer;"
          onclick="document.querySelectorAll('.th-${safeConv}').forEach(r=>r.style.display=r.style.display==='none'?'table-row':'none')">
          <td colspan="${opts.colspan}"><strong>${convName}</strong> (${group.length} Transaction${group.length !== 1 ? "s" : ""}) <i class="fa-solid fa-chevron-down" style="float:right;margin-top:4px;"></i></td>
        </tr>
        ${group.map((t) => rowHtml(t, `th-${safeConv}`)).join("")}
      `;
    })
    .join("");

  return html || emptyRow;
}

function bindCollectAmountInputs() {
  document.querySelectorAll(".collect-amount-input--inline").forEach((input) => {
    if (input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", () => {
      const n = parseFloat(input.value);
      if (!isNaN(n) && n > 0) localStorage.setItem("hsf_collect_amount", String(n));
    });
  });
}

async function updateStudentPayment(studentId, month, collectorName, convocation, year, amount) {
  const y = year || new Date().getFullYear();
  const amt = formatCollectAmount(amount);
  if (!amt) return false;
  const data = {
    student_id: studentId,
    date: new Date().toISOString().split("T")[0],
    month: month,
    year: y,
    collector: collectorName || "Admin",
    convocation: convocation || "Admin",
    amount: amt,
    method: "EVC Plus",
    status: "Success",
  };
  const res = await apiFetch("/transactions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return !!res;
}

const REPORT_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonthInputValue(val) {
  if (!val || typeof val !== "string" || !val.includes("-")) return null;
  const [y, m] = val.split("-");
  const year = parseInt(y, 10);
  const monthIndex = parseInt(m, 10) - 1;
  if (Number.isNaN(year) || monthIndex < 0 || monthIndex > 11) return null;
  return {
    year,
    monthIndex,
    monthName: REPORT_MONTH_NAMES[monthIndex],
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  };
}

function buildMonthRangeList(fromVal, toVal) {
  const from = parseMonthInputValue(fromVal);
  const to = parseMonthInputValue(toVal);
  if (!from || !to) return null;
  if (from.year > to.year || (from.year === to.year && from.monthIndex > to.monthIndex)) {
    return null;
  }
  const months = [];
  let cy = from.year;
  let cm = from.monthIndex;
  while (cy < to.year || (cy === to.year && cm <= to.monthIndex)) {
    months.push({ name: REPORT_MONTH_NAMES[cm], year: cy, monthIndex: cm });
    cm += 1;
    if (cm > 11) {
      cm = 0;
      cy += 1;
    }
  }
  return months;
}

function singleMonthPeriod(pm) {
  return {
    mode: "single",
    month: pm.name,
    year: pm.year,
    monthIndex: pm.monthIndex,
    label: `${pm.name} ${pm.year}`,
  };
}

function reportPeriodMonths(period) {
  if (!period) return [];
  if (period.mode === "all") return [];
  if (period.mode === "range" && Array.isArray(period.months) && period.months.length) {
    return period.months;
  }
  if (period.mode === "single" && period.month) {
    return [{
      name: period.month,
      year: period.year,
      monthIndex: period.monthIndex,
    }];
  }
  return [];
}

function resolveReportPeriod(singleVal, fromVal, toVal) {
  const range = buildMonthRangeList(fromVal, toVal);
  if (range && range.length) {
    const first = range[0];
    const last = range[range.length - 1];
    const label =
      range.length === 1
        ? `${first.name} ${first.year}`
        : `${first.name} ${first.year} – ${last.name} ${last.year}`;
    return { mode: "range", months: range, label, fromVal, toVal };
  }
  const single = parseMonthInputValue(singleVal);
  if (!single) return null;
  return {
    mode: "single",
    month: single.monthName,
    year: single.year,
    monthIndex: single.monthIndex,
    label: `${single.monthName} ${single.year}`,
    singleVal,
  };
}

function transactionInReportPeriod(t, period) {
  if (!t || !t.month || String(t.status || "").toLowerCase() !== "success") return false;
  if (!period || period.mode === "all") return true;
  const yr = parseInt(t.year, 10);
  const m = String(t.month).toLowerCase();
  if (period.mode === "single") {
    return m === period.month.toLowerCase() && yr === period.year;
  }
  return (period.months || []).some(
    (pm) => pm.name.toLowerCase() === m && pm.year === yr
  );
}

function meetingInReportPeriod(meet, period) {
  if (!meet?.date) return false;
  if (!period || period.mode === "all") return true;
  const parts = meet.date.split("-");
  if (parts.length < 2) return false;
  const y = parseInt(parts[0], 10);
  const monthIndex = parseInt(parts[1], 10) - 1;
  if (period.mode === "single") {
    return y === period.year && monthIndex === period.monthIndex;
  }
  return (period.months || []).some((pm) => pm.year === y && pm.monthIndex === monthIndex);
}

function mergeMonthlyReportData(reports, months, convocation, collector) {
  const valid = (reports || []).filter((r) => r && !r.error);
  if (!valid.length) return { error: "No report data for this period." };
  const paid = [];
  const unpaid = [];
  let total_collected = 0;
  valid.forEach((r) => {
    paid.push(...(r.paid || []));
    unpaid.push(...(r.unpaid || []));
    total_collected += Number(r.total_collected || 0);
  });
  const periodLabel =
    months.length === 1
      ? `${months[0].name} ${months[0].year}`
      : `${months[0].name} ${months[0].year} – ${months[months.length - 1].name} ${months[months.length - 1].year}`;
  return {
    convocation: convocation || valid[0].convocation,
    month: periodLabel,
    year: "",
    collector: collector || valid[0].collector,
    generated: valid[0].generated || new Date().toUTCString(),
    total_students: valid[0].total_students,
    paid_count: paid.length,
    unpaid_count: unpaid.length,
    total_collected: Math.round(total_collected * 100) / 100,
    paid,
    unpaid,
    isRange: months.length > 1,
    periodLabel,
  };
}

/** One section per month — avoids duplicating the same members across months in paid/unpaid lists. */
function buildMonthlyReportRange(reports, months, convocation, collector) {
  const monthSections = (reports || [])
    .map((r, i) => {
      if (!r || r.error) return null;
      const pm = months[i];
      const periodLabel = pm ? `${pm.name} ${pm.year}` : r.month || "";
      return {
        ...r,
        convocation: convocation || r.convocation,
        collector: collector || r.collector,
        month: pm?.name || r.month,
        year: pm?.year ?? r.year,
        periodLabel,
        paid_count: (r.paid || []).length,
        unpaid_count: (r.unpaid || []).length,
        isRange: false,
      };
    })
    .filter(Boolean);
  if (!monthSections.length) return { error: "No report data for this period." };
  const periodLabel =
    months.length === 1
      ? `${months[0].name} ${months[0].year}`
      : `${months[0].name} ${months[0].year} – ${months[months.length - 1].name} ${months[months.length - 1].year}`;
  const total_collected = monthSections.reduce(
    (sum, s) => sum + Number(s.total_collected || 0),
    0
  );
  return {
    convocation: convocation || monthSections[0].convocation,
    collector: collector || monthSections[0].collector,
    generated: monthSections[0].generated || new Date().toUTCString(),
    isRange: true,
    periodLabel,
    monthSections,
    total_collected: Math.round(total_collected * 100) / 100,
    paid_count: monthSections.reduce((sum, s) => sum + s.paid_count, 0),
    unpaid_count: monthSections.reduce((sum, s) => sum + s.unpaid_count, 0),
  };
}

function buildAllConvocationsReportRange(reports, months) {
  const monthSections = (reports || [])
    .map((r, i) => {
      if (!r || r.error) return null;
      const pm = months[i];
      const convocations = r.convocations || [];
      const periodLabel = pm ? `${pm.name} ${pm.year}` : `${r.month || ""} ${r.year || ""}`.trim();
      return {
        periodLabel,
        month: pm?.name || r.month,
        year: pm?.year ?? r.year,
        generated: r.generated,
        convocations,
        grand_paid: Number(r.grand_paid ?? convocations.reduce((s, c) => s + Number(c.paid || 0), 0)),
        grand_unpaid: Number(r.grand_unpaid ?? convocations.reduce((s, c) => s + Number(c.unpaid || 0), 0)),
        grand_total: Number(r.grand_total ?? convocations.reduce((s, c) => s + Number(c.total || 0), 0)),
        grand_students: Number(r.grand_students ?? convocations.reduce((s, c) => s + Number(c.students || 0), 0)),
      };
    })
    .filter(Boolean);
  if (!monthSections.length) return { error: "No report data for this period." };
  const periodLabel =
    months.length === 1
      ? `${months[0].name} ${months[0].year}`
      : `${months[0].name} ${months[0].year} – ${months[months.length - 1].name} ${months[months.length - 1].year}`;
  const grand_total = Math.round(
    monthSections.reduce((sum, s) => sum + s.grand_total, 0) * 100
  ) / 100;
  return {
    generated: monthSections[0].generated,
    isRange: true,
    periodLabel,
    monthSections,
    convocations: monthSections[monthSections.length - 1]?.convocations || [],
    grand_paid: monthSections.reduce((sum, s) => sum + s.grand_paid, 0),
    grand_unpaid: monthSections.reduce((sum, s) => sum + s.grand_unpaid, 0),
    grand_total,
    grand_students: monthSections[0]?.grand_students ?? 0,
  };
}

function mergeAllConvocationsReportData(reports, months) {
  const valid = (reports || []).filter((r) => r && !r.error);
  if (!valid.length) return { error: "No report data for this period." };
  const map = {};
  valid.forEach((r) => {
    (r.convocations || []).forEach((row) => {
      if (!map[row.name]) {
        map[row.name] = { name: row.name, students: row.students, paid: 0, unpaid: 0, total: 0 };
      }
      map[row.name].paid += Number(row.paid || 0);
      map[row.name].unpaid += Number(row.unpaid || 0);
      map[row.name].total += Number(row.total || 0);
    });
  });
  const convocations = Object.values(map);
  const periodLabel =
    months.length === 1
      ? `${months[0].name} ${months[0].year}`
      : `${months[0].name} ${months[0].year} – ${months[months.length - 1].name} ${months[months.length - 1].year}`;
  return {
    month: periodLabel,
    year: "",
    generated: valid[0].generated,
    convocations,
    grand_paid: convocations.reduce((s, r) => s + r.paid, 0),
    grand_unpaid: convocations.reduce((s, r) => s + r.unpaid, 0),
    grand_total: Math.round(convocations.reduce((s, r) => s + r.total, 0) * 100) / 100,
    grand_students: convocations.reduce((s, r) => s + r.students, 0),
    isRange: months.length > 1,
    periodLabel,
  };
}

function buildExpensesReportRange(reports, months) {
  const monthSections = (reports || [])
    .map((r, i) => {
      const pm = months[i];
      if (!pm) return null;
      const periodLabel = `${pm.name} ${pm.year}`;
      const expenses = r && !r.error ? (r.expenses || []) : [];
      const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return {
        periodLabel,
        month: pm.name,
        year: pm.year,
        expenses,
        total: Math.round(total * 100) / 100,
        count: expenses.length,
        generated: (r && !r.error && r.generated) || new Date().toUTCString(),
      };
    })
    .filter(Boolean);
  if (!monthSections.length) return { error: "No expense data for this period." };
  const periodLabel =
    months.length === 1
      ? `${months[0].name} ${months[0].year}`
      : `${months[0].name} ${months[0].year} – ${months[months.length - 1].name} ${months[months.length - 1].year}`;
  const total = Math.round(
    monthSections.reduce((sum, s) => sum + s.total, 0) * 100
  ) / 100;
  return {
    month: periodLabel,
    year: "",
    generated: monthSections[0].generated,
    isRange: true,
    periodLabel,
    monthSections,
    expenses: monthSections.flatMap((s) => s.expenses),
    total,
    count: monthSections.reduce((sum, s) => sum + s.count, 0),
  };
}

function mergeExpensesReportData(reports, months) {
  return buildExpensesReportRange(reports, months);
}

async function fetchMonthlyReportDataForPeriod(convocation, period, collector) {
  if (period.mode === "single") {
    return fetchMonthlyReportData(convocation, period.month, period.year, collector);
  }
  const parts = await Promise.all(
    period.months.map(({ name, year }) =>
      fetchMonthlyReportData(convocation, name, year, collector)
    )
  );
  if (period.months.length === 1) {
    const r = parts[0];
    if (!r || r.error) return r || { error: "No report data for this period." };
    const pm = period.months[0];
    return {
      ...r,
      periodLabel: `${pm.name} ${pm.year}`,
      isRange: false,
    };
  }
  return buildMonthlyReportRange(parts, period.months, convocation, collector);
}

async function fetchAllConvocationsReportDataForPeriod(period) {
  if (period.mode === "single") {
    return fetchAllConvocationsReportData(period.month, period.year);
  }
  const parts = await Promise.all(
    period.months.map(({ name, year }) => fetchAllConvocationsReportData(name, year))
  );
  if (period.months.length === 1) {
    const r = parts[0];
    if (!r || r.error) return r || { error: "No report data for this period." };
    const pm = period.months[0];
    return {
      ...r,
      periodLabel: `${pm.name} ${pm.year}`,
      isRange: false,
    };
  }
  return buildAllConvocationsReportRange(parts, period.months);
}

function extractPaidUnpaidFromMonthlyReport(r) {
  if (!r || r.error) {
    return {
      paid: [],
      unpaid: [],
      paid_count: 0,
      unpaid_count: 0,
      total_collected: 0,
      total_students: 0,
    };
  }
  if (r.isRange && r.monthSections?.length) {
    const paid = r.monthSections.flatMap((s) => s.paid || []);
    const unpaid = r.monthSections.flatMap((s) => s.unpaid || []);
    return {
      paid,
      unpaid,
      paid_count: paid.length,
      unpaid_count: unpaid.length,
      total_collected: r.total_collected || 0,
      total_students: r.monthSections[0]?.total_students || 0,
    };
  }
  return {
    paid: r.paid || [],
    unpaid: r.unpaid || [],
    paid_count: r.paid_count ?? (r.paid || []).length,
    unpaid_count: r.unpaid_count ?? (r.unpaid || []).length,
    total_collected: r.total_collected || 0,
    total_students: r.total_students || 0,
  };
}

async function fetchDufcadMemberListsForPeriod(period) {
  const convocations = await getConvocations();
  const names = (convocations || []).map((c) => c.name).filter(Boolean);
  const periodLabel = period.label || period.periodLabel || "Selected period";
  const generated = new Date().toUTCString();

  if (!names.length) {
    return {
      periodLabel,
      dufcads: [],
      grand_paid: 0,
      grand_unpaid: 0,
      generated,
      isRange: false,
    };
  }

  if (period.mode === "range" && period.months?.length > 1) {
    const monthSections = await Promise.all(
      period.months.map(async (pm) => {
        const reports = await Promise.all(
          names.map((name) => fetchMonthlyReportData(name, pm.name, pm.year, "Collector"))
        );
        const dufcads = reports
          .filter((r) => r && !r.error)
          .map((r) => ({
            name: r.convocation,
            unpaid: r.unpaid || [],
            unpaid_count: r.unpaid_count ?? (r.unpaid || []).length,
            paid_count: r.paid_count ?? (r.paid || []).length,
            total_students: r.total_students || 0,
          }));
        return {
          periodLabel: `${pm.name} ${pm.year}`,
          month: pm.name,
          year: pm.year,
          dufcads,
          grand_unpaid: dufcads.reduce((s, d) => s + d.unpaid_count, 0),
          grand_paid: dufcads.reduce((s, d) => s + d.paid_count, 0),
        };
      })
    );
    return {
      periodLabel,
      isRange: true,
      monthSections,
      dufcads: [],
      grand_paid: monthSections.reduce((s, m) => s + m.grand_paid, 0),
      grand_unpaid: monthSections.reduce((s, m) => s + m.grand_unpaid, 0),
      generated,
    };
  }

  const reports = await Promise.all(
    names.map((name) => fetchMonthlyReportDataForPeriod(name, period, "Collector"))
  );
  const dufcads = reports
    .filter((r) => r && !r.error)
    .map((r) => ({
      name: r.convocation,
      ...extractPaidUnpaidFromMonthlyReport(r),
    }));
  return {
    periodLabel,
    isRange: false,
    dufcads,
    grand_paid: dufcads.reduce((s, d) => s + d.paid_count, 0),
    grand_unpaid: dufcads.reduce((s, d) => s + d.unpaid_count, 0),
    generated,
  };
}

function hasDufcadMemberReportData(data) {
  if (!data) return false;
  if (data.dufcads?.length) return true;
  return Boolean(data.isRange && data.monthSections?.length);
}

async function fetchExpensesReportDataForPeriod(period) {
  if (period?.mode === "all") {
    const expenses = (await getExpenses()) || [];
    const rows = expenses.map((e) => {
      const amt = Number(String(e.amount ?? 0).replace(/[^0-9.-]/g, "")) || 0;
      return {
        id: e.id,
        month: e.month,
        year: e.year,
        date: e.date || e.expense_date || "",
        amount: amt,
        description: e.description || "—",
      };
    });
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return {
      month: "All",
      year: null,
      expenses: rows,
      total: Math.round(total * 100) / 100,
      count: rows.length,
      periodLabel: "All time",
      isRange: false,
      generated: new Date().toUTCString(),
    };
  }
  if (period.mode === "single") {
    return fetchExpensesReportData(period.month, period.year);
  }
  const parts = await Promise.all(
    period.months.map(({ name, year }) => fetchExpensesReportData(name, year))
  );
  if (period.months.length === 1) {
    const r = parts[0];
    if (!r || r.error) return r || { error: "No expense data for this period." };
    const pm = period.months[0];
    return {
      ...r,
      periodLabel: `${pm.name} ${pm.year}`,
      isRange: false,
    };
  }
  return buildExpensesReportRange(parts, period.months);
}

function openMonthlyPaymentReport(convocation, month, year, collector) {
  const params = new URLSearchParams({
    convocation: convocation || '',
    month: month || '',
    year: String(year || new Date().getFullYear()),
    collector: collector || 'Collector',
  });
  const base = API_BASE.replace(/\/api\/?$/, '');
  window.open(`${base}/api/reports/monthly-payments?${params}`, '_blank');
}

async function fetchMonthlyReportData(convocation, month, year, collector) {
  const params = new URLSearchParams({
    convocation: convocation || '',
    month: month || '',
    year: String(year || new Date().getFullYear()),
    collector: collector || 'Collector',
  });
  return apiFetch(`/reports/monthly-payments-data?${params}`);
}

async function fetchAllConvocationsReportData(month, year) {
  const params = new URLSearchParams({
    month: month || '',
    year: String(year || new Date().getFullYear()),
  });
  return apiFetch(`/reports/all-convocations-data?${params}`);
}

async function fetchExpensesReportData(month, year) {
  const params = new URLSearchParams({
    month: month || '',
    year: String(year || new Date().getFullYear()),
  });
  return apiFetch(`/reports/expenses-data?${params}`);
}

function openAllConvocationsSummary(month, year) {
  const params = new URLSearchParams({
    month: month || '',
    year: String(year || new Date().getFullYear()),
  });
  const base = API_BASE.replace(/\/api\/?$/, '');
  window.open(`${base}/api/reports/all-convocations-summary?${params}`, '_blank');
}

async function getNotifications(userId, limit = 40) {
  return apiFetch(`/notifications?user_id=${encodeURIComponent(userId)}&limit=${limit}`);
}

async function markNotificationRead(notificationId, userId) {
  return apiFetch(`/notifications/${notificationId}/read`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

async function markAllNotificationsRead(userId) {
  return apiFetch('/notifications/mark-all-read', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

// ─────────────────────────────────────────────────────────────
// Expenses
// ─────────────────────────────────────────────────────────────
async function getExpenses() {
  return (await apiFetch("/expenses")) || [];
}

async function getMonthlyExpenses(month, year) {
  const expenses = await getExpenses();
  const entry = expenses.find(
    (e) => e.month === month && parseInt(e.year) === parseInt(year)
  );
  return entry ? entry.amount : 0;
}

function formatExpenseDate(e) {
  if (!e) return "—";
  if (e.date) {
    const d = new Date(`${e.date}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }
    return e.date;
  }
  if (e.month && e.year) return `${e.month} ${e.year}`;
  return "—";
}

async function addExpense(month, year, amount, description = "", date = "") {
  return apiFetch("/expenses", {
    method: "POST",
    body: JSON.stringify({ month, year, amount, description, date }),
  });
}

async function getFundEntries() {
  return (await apiFetch("/fund-entries")) || [];
}

async function addFundEntry(month, year, amount, description = "", date = "", sourceType = "Supported", recordedBy = "") {
  return apiFetch("/fund-entries", {
    method: "POST",
    body: JSON.stringify({
      month,
      year,
      amount,
      description,
      date,
      source_type: sourceType,
      recorded_by: recordedBy,
    }),
  });
}

function formatFundEntryDate(e) {
  return formatExpenseDate(e);
}

function sumFundEntriesTotal(entries) {
  return (entries || []).reduce((acc, e) => acc + parseFloat(e.amount || 0), 0);
}

function sumExpenseTotal(expenses) {
  return (expenses || []).reduce((acc, e) => acc + parseFloat(e.amount || 0), 0);
}

function sumTxnCollected(transactions) {
  return (transactions || []).reduce((acc, t) => acc + parseTxnAmount(t.amount), 0);
}

function calcAccountBalance(transactions, expenses, fundEntries) {
  return sumTxnCollected(transactions) + sumFundEntriesTotal(fundEntries) - sumExpenseTotal(expenses);
}

function buildFundEntriesReportRange(reports, months) {
  const monthSections = (reports || [])
    .map((r, i) => {
      const pm = months[i];
      if (!pm) return null;
      const periodLabel = `${pm.name} ${pm.year}`;
      const entries = r && !r.error ? (r.entries || []) : [];
      const total = entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return {
        periodLabel,
        month: pm.name,
        year: pm.year,
        entries,
        total: Math.round(total * 100) / 100,
        count: entries.length,
        generated: (r && !r.error && r.generated) || new Date().toUTCString(),
      };
    })
    .filter(Boolean);
  if (!monthSections.length) return { error: "No support entry data for this period." };
  const periodLabel =
    months.length === 1
      ? `${months[0].name} ${months[0].year}`
      : `${months[0].name} ${months[0].year} – ${months[months.length - 1].name} ${months[months.length - 1].year}`;
  const total = Math.round(
    monthSections.reduce((sum, s) => sum + s.total, 0) * 100
  ) / 100;
  return {
    month: periodLabel,
    year: "",
    generated: monthSections[0].generated,
    isRange: true,
    periodLabel,
    monthSections,
    entries: monthSections.flatMap((s) => s.entries),
    total,
    count: monthSections.reduce((sum, s) => sum + s.count, 0),
  };
}

function mergeFundEntriesReportData(reports, months) {
  return buildFundEntriesReportRange(reports, months);
}

async function fetchFundEntriesReportData(month, year) {
  const params = new URLSearchParams({
    month: month || "",
    year: String(year || new Date().getFullYear()),
  });
  return apiFetch(`/reports/fund-entries-data?${params}`);
}

async function fetchFundEntriesReportDataForPeriod(period) {
  if (period?.mode === "all") {
    const entries = (await getFundEntries()) || [];
    const rows = entries.map((e) => {
      const amt = Number(String(e.amount ?? 0).replace(/[^0-9.-]/g, "")) || 0;
      return {
        id: e.id,
        month: e.month,
        year: e.year,
        date: e.date || e.entry_date || "",
        amount: amt,
        source_type: e.source_type || "Supported",
        description: e.description || "—",
        recorded_by: e.recorded_by || "",
      };
    });
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return {
      month: "All",
      year: null,
      entries: rows,
      total: Math.round(total * 100) / 100,
      count: rows.length,
      periodLabel: "All time",
      isRange: false,
      generated: new Date().toUTCString(),
    };
  }
  if (period.mode === "single") {
    return fetchFundEntriesReportData(period.month, period.year);
  }
  const parts = await Promise.all(
    period.months.map(({ name, year }) => fetchFundEntriesReportData(name, year))
  );
  if (period.months.length === 1) {
    const r = parts[0];
    if (!r || r.error) return r || { error: "No support entry data for this period." };
    const pm = period.months[0];
    return {
      ...r,
      periodLabel: `${pm.name} ${pm.year}`,
      isRange: false,
    };
  }
  return buildFundEntriesReportRange(parts, period.months);
}

// ─────────────────────────────────────────────────────────────
// Attendance
// ─────────────────────────────────────────────────────────────
async function getAttendance(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  return (await apiFetch(`/attendance${params ? "?" + params : ""}`)) || [];
}

async function recordAttendance(records) {
  // records can be a single object {meeting_id, student_id, status, date} or an array
  return apiFetch("/attendance", {
    method: "POST",
    body: JSON.stringify(records),
  });
}

// ─────────────────────────────────────────────────────────────
// Stats & Performance
// ─────────────────────────────────────────────────────────────
async function getStats(month, year, convocation) {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (year) params.set("year", year);
  if (convocation) params.set("convocation", convocation);
  return apiFetch(`/stats?${params.toString()}`);
}

async function getPerformance(month, year) {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (year) params.set("year", year);
  return (await apiFetch(`/performance?${params.toString()}`)) || [];
}

// ─────────────────────────────────────────────────────────────
// Compat – kept for pages that may still call initializeData()
// ─────────────────────────────────────────────────────────────
async function initializeData() {
  // No-op. DB initialisation is handled server-side.
}
// ─────────────────────────────────────────────────────────────
// Profile Picture Upload
// ─────────────────────────────────────────────────────────────
async function uploadProfilePic(userId, file) {
  const id = String(userId || "").trim();
  if (!id) {
    return { success: false, error: "User id is missing." };
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(
      `${API_BASE}/upload-profile/${encodeURIComponent(id)}`,
      {
        method: "POST",
        body: formData,
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: data.error || `Upload failed (HTTP ${res.status})`,
      };
    }
    return data;
  } catch (err) {
    console.error("Upload error:", err);
    return { success: false, error: "Could not reach the server. Check your connection." };
  }
}

initializeData();

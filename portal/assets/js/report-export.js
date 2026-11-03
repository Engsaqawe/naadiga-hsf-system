/**
 * Shared report export: Print, Download Image, Download PDF (content-sized).
 */
const ReportExport = {
  _openDropdowns: [],
  CAPTURE_SCALE: 2,
  /* Browsers ~16k; stay under to avoid blank/failed summer "All" exports. */
  MAX_CANVAS_DEVICE_PX: 8192,

  _isMobileExportViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  },

  _isSummerExportMenu(menuEl) {
    if (!menuEl) return false;
    if (menuEl.id === 'summer-report-export-menu') return true;
    if (menuEl.closest?.('.summer-export-portal')) return true;
    if (menuEl.closest?.('#summer-tab-content, #summerHistoryBody')) return true;
    const home = menuEl._exportMenuHome;
    if (home?.closest?.('.summer-export-portal, #summer-tab-content, #summerHistoryBody')) return true;
    return false;
  },

  _clearMobileContestExportMenu(menu) {
    if (!menu) return;
    menu.classList.remove('active', 'export-options--fixed-mobile');
    [
      'position', 'display', 'left', 'top', 'right', 'bottom',
      'width', 'min-width', 'max-height', 'overflow', 'overflow-y',
      'z-index', 'margin-top',
    ].forEach((prop) => menu.style.removeProperty(prop));
    const home = menu._exportMenuHome;
    if (home && menu.parentElement !== home) {
      home.appendChild(menu);
    }
    menu._exportMenuHome = null;
  },

  _openMobileContestExportMenu(toggleEl, menuEl) {
    if (!toggleEl || !menuEl) return;
    if (!menuEl._exportMenuHome) {
      menuEl._exportMenuHome = menuEl.parentElement;
    }
    if (menuEl.parentElement !== document.body) {
      document.body.appendChild(menuEl);
    }
    const margin = 8;
    const menuW = Math.min(260, window.innerWidth - margin * 2);
    const rect = toggleEl.getBoundingClientRect();
    let left = rect.right - menuW;
    if (left < margin) left = margin;
    if (left + menuW > window.innerWidth - margin) {
      left = window.innerWidth - margin - menuW;
    }
    // Menu may still be measuring; use a safe height so it never opens with 0 height
    const measured = menuEl.offsetHeight || menuEl.scrollHeight || 0;
    const estimatedH = Math.max(140, Math.min(240, measured || 180));
    let top = rect.bottom + 6;
    if (top + estimatedH > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - estimatedH - 6);
    }
    menuEl.classList.add('export-options--fixed-mobile', 'active');
    menuEl.style.setProperty('position', 'fixed', 'important');
    menuEl.style.setProperty('display', 'block', 'important');
    menuEl.style.setProperty('left', `${left}px`, 'important');
    menuEl.style.setProperty('top', `${top}px`, 'important');
    menuEl.style.setProperty('right', 'auto', 'important');
    menuEl.style.setProperty('bottom', 'auto', 'important');
    menuEl.style.setProperty('width', `${menuW}px`, 'important');
    menuEl.style.setProperty('min-width', '0', 'important');
    menuEl.style.setProperty('max-height', `${Math.min(estimatedH + 48, window.innerHeight - margin * 2)}px`, 'important');
    menuEl.style.setProperty('overflow-y', 'auto', 'important');
    menuEl.style.setProperty('overflow', 'auto', 'important');
    menuEl.style.setProperty('z-index', '10050', 'important');
    menuEl.style.setProperty('margin-top', '0', 'important');
  },

  closeAllDropdowns() {
    const menus = new Set([
      ...document.querySelectorAll('.export-options.active'),
      ...document.querySelectorAll('.export-options.export-options--fixed-mobile'),
      ...document.querySelectorAll('body > .export-options'),
    ]);
    menus.forEach((m) => {
      m.classList.remove('active');
      this._clearMobileContestExportMenu(m);
    });
  },

  initDropdown(toggleEl, menuEl) {
    if (!toggleEl || !menuEl || toggleEl.dataset.exportDropdownInit === '1') return;
    toggleEl.dataset.exportDropdownInit = '1';
    const closeAll = () => this.closeAllDropdowns();
    toggleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = menuEl.classList.contains('active')
        || menuEl.classList.contains('export-options--fixed-mobile')
        || menuEl.parentElement === document.body;
      closeAll();
      if (!wasOpen) {
        menuEl.classList.add('active');
        // Summer Course reports only: portal menu so table/footer cannot clip it
        if (this._isSummerExportMenu(menuEl)) {
          requestAnimationFrame(() => this._openMobileContestExportMenu(toggleEl, menuEl));
        }
      }
    });
    menuEl.addEventListener('click', (e) => e.stopPropagation());
    if (!this._openDropdowns.length) {
      document.addEventListener('click', closeAll);
      window.addEventListener('resize', closeAll);
      this._openDropdowns.push(true);
    }
  },

  bindActions(menuEl, { targetSelector, filenameBase, onBeforeCapture, previewTitle, directPdf = false }) {
    if (!menuEl || menuEl.dataset.exportActionsBound === '1') return;
    menuEl.dataset.exportActionsBound = '1';
    menuEl.querySelectorAll('.export-item').forEach((item) => {
      item.addEventListener('click', async () => {
        this.closeAllDropdowns();
        const action = item.dataset.exportAction;
        const el = document.querySelector(targetSelector);
        if (!el) return;
        if (typeof onBeforeCapture === 'function') onBeforeCapture(action);
        const base = typeof filenameBase === 'function' ? filenameBase() : filenameBase;
        const name = this._buildFilename(base);
        const title = typeof previewTitle === 'function' ? previewTitle() : previewTitle;
        const inlinePreviewOpen = (() => {
          const preview = document.getElementById('report-preview');
          return preview && preview.style.display !== 'none';
        })();
        if (action === 'print') await this.printElement(el);
        else if (action === 'image') await this.downloadImage(el, name);
        else if (action === 'pdf') {
          if (directPdf || inlinePreviewOpen) {
            await this.downloadPdf(el, name, { preview: false });
          } else {
            await this.previewBeforeDownload(el, name, title || 'Report preview');
          }
        }
      });
    });
  },

  _buildFilename(base) {
    const safe = (base || 'HSF_Report').replace(/[^\w\-]+/g, '_');
    const d = new Date().toISOString().slice(0, 10);
    return `${safe}_${d}`;
  },

  _getReportSheets(root) {
    if (!root) return [];
    const sheets = root.matches?.('.report-sheet') ? [root] : [];
    root.querySelectorAll('.report-sheet').forEach((sheet) => sheets.push(sheet));
    return sheets;
  },

  _maxTableColumns(element) {
    if (!element) return 0;
    let max = 0;
    element.querySelectorAll('.report-table thead tr').forEach((row) => {
      max = Math.max(max, row.children.length);
    });
    return max;
  },

  _getContestExportStyles({ mode = 'capture' } = {}) {
    const compact = mode === 'capture';
    const isPrint = mode === 'print';
    const isPreview = mode === 'preview';
    const cellSize = isPrint ? '11px' : (compact ? '11px' : '12px');
    const headSize = isPrint ? '11px' : (compact ? '11px' : '12px');
    const pad = isPrint ? '5px 5px' : (compact ? '4px 5px' : '6px 5px');
    const lineHeight = compact ? '1.3' : '1.35';
    const wrapOverflow = isPreview ? 'auto' : 'visible';
    const tableLayout = isPreview ? 'auto' : 'fixed';
    const tableWidth = isPreview ? 'max-content' : '100%';
    const tableMinWidth = isPreview ? '900px' : '0';
    const tableMaxWidth = isPreview ? 'none' : '100%';
    const cellWhiteSpace = isPreview ? 'nowrap' : 'normal';
    const cellWordBreak = isPreview ? 'normal' : 'break-word';
    return `
      .report-export-ready { box-sizing: border-box !important; overflow: visible !important; background: #fff !important; color: #1e293b !important; }
      .report-export-ready .contest-report-participants-wrap { overflow-x: ${wrapOverflow} !important; overflow-y: visible !important; max-width: 100% !important; width: 100% !important; padding: 0 !important; -webkit-overflow-scrolling: touch !important; }
      .report-export-ready .contest-report-participants-table { width: ${tableWidth} !important; min-width: ${tableMinWidth} !important; max-width: ${tableMaxWidth} !important; table-layout: ${tableLayout} !important; border-collapse: collapse !important; font-size: ${cellSize} !important; }
      .report-export-ready .contest-report-participants-table--summer {
        table-layout: auto !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        font-size: 11px !important;
      }
      .report-export-ready .contest-report-participants-table th { padding: ${pad} !important; font-size: ${headSize} !important; font-weight: 700 !important; line-height: ${lineHeight} !important; white-space: ${cellWhiteSpace} !important; word-break: ${cellWordBreak} !important; vertical-align: bottom !important; border: 1px solid #cbd5e1 !important; }
      .report-export-ready .contest-report-participants-table td { padding: ${pad} !important; font-size: ${cellSize} !important; line-height: ${lineHeight} !important; white-space: ${cellWhiteSpace} !important; word-break: ${cellWordBreak} !important; vertical-align: top !important; border: 1px solid #cbd5e1 !important; }
      .report-export-ready .contest-report-participants-table--summer th,
      .report-export-ready .contest-report-participants-table--summer td {
        white-space: nowrap !important;
        word-break: normal !important;
        overflow-wrap: normal !important;
        font-size: 11px !important;
        line-height: 1.3 !important;
        padding: 4px 5px !important;
        vertical-align: middle !important;
      }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(1), .report-export-ready .contest-report-participants-table--quran td:nth-child(1) { width: 3%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(2), .report-export-ready .contest-report-participants-table--quran td:nth-child(2) { width: 10%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(3), .report-export-ready .contest-report-participants-table--quran td:nth-child(3) { width: 6%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(4), .report-export-ready .contest-report-participants-table--quran td:nth-child(4) { width: 9%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(5), .report-export-ready .contest-report-participants-table--quran td:nth-child(5) { width: 9%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(6), .report-export-ready .contest-report-participants-table--quran td:nth-child(6) { width: 8%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(7), .report-export-ready .contest-report-participants-table--quran td:nth-child(7) { width: 8%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(8), .report-export-ready .contest-report-participants-table--quran td:nth-child(8) { width: 7%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(9), .report-export-ready .contest-report-participants-table--quran td:nth-child(9) { width: 9%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(10), .report-export-ready .contest-report-participants-table--quran td:nth-child(10) { width: 8%; }
      .report-export-ready .contest-report-participants-table--quran th:nth-child(11), .report-export-ready .contest-report-participants-table--quran td:nth-child(11) { width: 23%; }
      .report-export-ready .contest-report-participants-table--summer th:nth-child(1),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(1) {
        width: 28px !important;
        min-width: 28px !important;
        max-width: 36px !important;
        text-align: center !important;
      }
      .report-export-ready .contest-report-participants-table--summer th:nth-child(2),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(2) {
        width: auto !important;
        min-width: 170px !important;
        white-space: nowrap !important;
      }
      .report-export-ready .contest-report-participants-table--summer th:nth-child(3),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(3) {
        min-width: 78px !important;
      }
      .report-export-ready .contest-report-participants-table--summer th:nth-child(4),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(4),
      .report-export-ready .contest-report-participants-table--summer th:nth-child(5),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(5) {
        white-space: nowrap !important;
      }
      .report-export-ready .contest-report-participants-table--summer th:nth-child(6),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(6) {
        min-width: 48px !important;
        text-align: center !important;
      }
      .report-export-ready .contest-report-participants-table--summer th:nth-child(7),
      .report-export-ready .contest-report-participants-table--summer th:nth-child(8),
      .report-export-ready .contest-report-participants-table--summer th:nth-child(9),
      .report-export-ready .contest-report-participants-table--summer th:nth-child(10),
      .report-export-ready .contest-report-participants-table--summer th:nth-child(11),
      .report-export-ready .contest-report-participants-table--summer th:nth-child(12),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(7),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(8),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(9),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(10),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(11),
      .report-export-ready .contest-report-participants-table--summer td:nth-child(12) {
        width: 32px !important;
        min-width: 32px !important;
        max-width: 36px !important;
        padding: 3px 2px !important;
        text-align: center !important;
        white-space: nowrap !important;
        font-size: 12px !important;
      }
      .report-export-ready .hsf-program-winners-grid { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 8px !important; }
      .report-export-ready .hsf-program-winners-grid > div { background: #fff !important; border: 1px solid #e2e8f0 !important; color: #0f172a !important; padding: 10px 12px !important; border-radius: 10px !important; }
      .report-export-ready .hsf-program-winners-grid span,
      .report-export-ready .hsf-program-meta-label { color: #64748b !important; }
      .report-export-ready .hsf-program-winners-grid strong { color: #0f172a !important; }
      .report-export-ready .summer-courses-cards { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 8px !important; margin: 8px 0 16px !important; }
      .report-export-ready .summer-course-card { display: flex !important; align-items: flex-start !important; gap: 10px !important; padding: 10px 12px !important; border: 1px solid #e2e8f0 !important; border-radius: 10px !important; background: #fff !important; color: #0f172a !important; }
      .report-export-ready .summer-course-card-num { flex-shrink: 0 !important; width: 24px !important; height: 24px !important; border-radius: 7px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; font-size: 0.72rem !important; font-weight: 800 !important; background: rgba(13, 148, 136, 0.14) !important; color: #0f766e !important; }
      .report-export-ready .summer-course-card-title { font-size: 0.86rem !important; font-weight: 600 !important; color: #0f172a !important; }
      .report-export-ready .summer-report-day-cards {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 10px !important;
        margin: 8px 0 12px !important;
        width: 100% !important;
        max-width: 100% !important;
      }
      .report-export-ready .summer-report-day-card {
        padding: 12px 14px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 10px !important;
        background: #fff !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        min-height: 64px !important;
        box-sizing: border-box !important;
      }
      .report-export-ready .summer-report-day-card.is-taken {
        border-color: #99f6e4 !important;
        background: #f0fdfa !important;
      }
      .report-export-ready .summer-report-day-card-label {
        display: block !important;
        font-size: 0.75rem !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        color: #64748b !important;
        margin-bottom: 4px !important;
      }
      .report-export-ready .summer-report-day-card strong {
        display: block !important;
        font-size: 1rem !important;
        color: #0f766e !important;
      }
      .report-export-ready .summer-report-day-card-absent {
        display: block !important;
        font-size: 0.88rem !important;
        color: #b45309 !important;
        margin-top: 2px !important;
      }
      .report-export-ready .summer-report-day-summary-list {
        margin: 0 0 16px !important;
        padding: 10px 14px !important;
        list-style: none !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 10px !important;
        background: #f8fafc !important;
      }
      .report-export-ready .summer-report-day-summary-list li {
        font-size: 0.9rem !important;
        color: #0f172a !important;
        padding: 3px 0 !important;
        border-bottom: 1px solid #e2e8f0 !important;
      }
      .report-export-ready .summer-report-day-summary-list li:last-child {
        border-bottom: none !important;
      }
      .report-export-ready .summer-report-day-list {
        border: 1px solid #e2e8f0 !important;
        border-radius: 8px !important;
        padding: 8px 10px !important;
        background: #fff !important;
      }
      .report-export-ready .summer-report-day-list h4 {
        margin: 0 0 6px !important;
        font-size: 0.82rem !important;
        border: none !important;
        padding: 0 !important;
      }
      .report-export-ready .summer-report-day-list--present h4 { color: #0f766e !important; }
      .report-export-ready .summer-report-day-list--absent h4 { color: #b45309 !important; }
      .report-export-ready .summer-report-day-list ol {
        margin: 0 !important;
        padding: 0 !important;
        list-style: none !important;
      }
      .report-export-ready .summer-report-day-list li {
        display: flex !important;
        gap: 6px !important;
        font-size: 0.78rem !important;
        line-height: 1.25 !important;
        padding: 2px 0 !important;
        color: #0f172a !important;
        border-bottom: 1px solid #f1f5f9 !important;
      }
      .report-export-ready .summer-report-dufcad-block { margin: 0 0 10px !important; }
      .report-export-ready .summer-report-dufcad-title {
        margin: 0 0 6px !important;
        font-size: 0.88rem !important;
        font-weight: 700 !important;
        color: #1e4a6d !important;
        border: none !important;
        padding: 0 !important;
      }
      .report-export-ready .summer-report-dufcad-title span {
        font-weight: 500 !important;
        color: #64748b !important;
        font-size: 0.78rem !important;
      }
      .report-export-ready .summer-report-day-section {
        margin: 0 0 14px !important;
        page-break-inside: avoid !important;
      }
      .report-export-ready .summer-report-day-lists {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
      }
      .report-export-ready .contest-report-participants-table--summer th,
      .report-export-ready .contest-report-participants-table--summer td {
        font-size: 10px !important;
        padding: 3px 4px !important;
        line-height: 1.25 !important;
      }
      .report-export-ready.contest-report-sheet h2,
      .report-export-ready.contest-report-sheet h3 { color: #1e4a6d !important; border-bottom-color: #e2e8f0 !important; }
      .report-export-ready.contest-report-sheet,
      .report-export-ready .contest-report-sheet {
        padding: ${isPreview ? '24px 28px' : '28px 32px'} !important;
        box-sizing: border-box !important;
      }
    `;
  },

  _getSheetExportStyles({ mode = 'capture', pageContentPx = null } = {}) {
    const compact = mode === 'capture';
    const isPrint = mode === 'print';
    const cellSize = isPrint ? '12px' : (compact ? '12px' : '13px');
    const headSize = isPrint ? '12px' : (compact ? '12px' : '13px');
    const pad = isPrint ? '7px 6px' : (compact ? '6px 5px' : '7px 6px');
    const lineHeight = isPrint ? '1.4' : (compact ? '1.35' : '1.4');
    const sheetWidth = mode === 'capture' && pageContentPx ? `${pageContentPx}px` : '100%';
    return `
      .report-export-ready.report-sheet,
      .report-export-ready .report-sheet {
        width: ${sheetWidth} !important;
        max-width: ${sheetWidth} !important;
        min-width: ${mode === 'capture' && pageContentPx ? `${pageContentPx}px` : '0'} !important;
        height: auto !important;
        min-height: 0 !important;
        box-sizing: border-box !important;
        overflow: visible !important;
        background: #fff !important;
        color: #1e293b !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        display: block !important;
      }
      .report-export-ready .report-sheet-header,
      .report-export-ready .report-meta-grid,
      .report-export-ready .report-block,
      .report-export-ready .report-block-head,
      .report-export-ready .report-footer-bar,
      .report-export-ready .report-month-section,
      .report-export-ready .report-meeting-section {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      .report-export-ready .report-month-section-title {
        color: #1e4a6d !important;
        margin: 0 !important;
        padding: 16px 0 8px !important;
        font-size: 1.05rem !important;
        font-weight: 700 !important;
      }
      .report-export-ready .report-meta-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 10px !important;
        background: linear-gradient(180deg, #f8fafc, #ffffff) !important;
        border-bottom: 3px solid #2E946A !important;
        color: #1e293b !important;
      }
      .report-export-ready .report-meta-grid .lbl {
        color: #64748b !important;
      }
      .report-export-ready .report-meta-grid .val {
        color: #0f172a !important;
      }
      .report-export-ready .report-block {
        background: #fff !important;
        color: #1e293b !important;
      }
      .report-export-ready .report-block-head {
        border-bottom-color: #e2e8f0 !important;
      }
      .report-export-ready .report-block-head h4 {
        color: #1e4a6d !important;
      }
      .report-export-ready .report-table th {
        background: linear-gradient(90deg, #145f40, #1e4a6d) !important;
        color: #fff !important;
      }
      .report-export-ready .report-table td {
        color: #1e293b !important;
        border-bottom-color: #e2e8f0 !important;
      }
      .report-export-ready .report-badge--paid {
        background: #d1fae5 !important;
        color: #145f40 !important;
      }
      .report-export-ready .report-badge--unpaid {
        background: #fee2e2 !important;
        color: #b91c1c !important;
      }
      .report-export-ready .report-table .amt {
        color: #145f40 !important;
      }
      .report-export-ready .report-table .unpaid-txt,
      .report-export-ready .report-table .status-tag--unpaid {
        color: #dc2626 !important;
      }
      .report-export-ready .report-table .status-tag--paid {
        color: #145f40 !important;
      }
      .report-export-ready .report-table tr.row-paid td {
        background: rgba(16, 185, 129, 0.06) !important;
      }
      .report-export-ready .report-table tr.row-unpaid td {
        background: rgba(239, 68, 68, 0.06) !important;
      }
      .report-export-ready .report-sheet-header h2,
      .report-export-ready .report-sheet-header p {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
      .report-export-ready .report-footer-bar {
        flex-wrap: wrap !important;
        gap: 8px !important;
      }
      .report-export-ready .report-footer-bar .total {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
      .report-export-ready .report-block {
        padding-left: 12px !important;
        padding-right: 12px !important;
        overflow: visible !important;
      }
      .report-export-ready .report-sheet-header {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 16px !important;
        text-align: left !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .report-export-ready .report-sheet-header img {
        width: 72px !important;
        height: 72px !important;
        min-width: 72px !important;
        min-height: 72px !important;
        border-radius: 50% !important;
        background: #fff !important;
        padding: 6px !important;
        object-fit: contain !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .report-export-ready .report-table {
        width: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
        font-size: ${cellSize} !important;
        display: table !important;
        white-space: normal !important;
        overflow: visible !important;
      }
      .report-export-ready .report-table thead,
      .report-export-ready .report-table tbody {
        display: table-row-group !important;
      }
      .report-export-ready .report-table thead { display: table-header-group !important; }
      .report-export-ready .report-table tr { display: table-row !important; }
      .report-export-ready .report-table th,
      .report-export-ready .report-table td {
        display: table-cell !important;
      }
      .report-export-ready .report-table th {
        padding: ${pad} !important;
        font-size: ${headSize} !important;
        font-weight: 700 !important;
        line-height: ${lineHeight} !important;
        white-space: normal !important;
        word-break: break-word !important;
        vertical-align: bottom !important;
      }
      .report-export-ready .report-table td {
        padding: ${pad} !important;
        font-size: ${cellSize} !important;
        line-height: ${lineHeight} !important;
        white-space: normal !important;
        word-break: break-word !important;
        vertical-align: top !important;
        overflow: visible !important;
      }
      .report-export-ready .report-table--cols-2 th:nth-child(1), .report-export-ready .report-table--cols-2 td:nth-child(1) { width: 58%; }
      .report-export-ready .report-table--cols-2 th:nth-child(2), .report-export-ready .report-table--cols-2 td:nth-child(2) { width: 42%; }
      .report-export-ready .report-table--cols-3 th:nth-child(1), .report-export-ready .report-table--cols-3 td:nth-child(1) { width: 18%; }
      .report-export-ready .report-table--cols-3 th:nth-child(2), .report-export-ready .report-table--cols-3 td:nth-child(2) { width: 57%; }
      .report-export-ready .report-table--cols-3 th:nth-child(3), .report-export-ready .report-table--cols-3 td:nth-child(3) { width: 25%; }
      .report-export-ready .report-table--cols-4 th:nth-child(1), .report-export-ready .report-table--cols-4 td:nth-child(1) { width: 28%; }
      .report-export-ready .report-table--cols-4 th:nth-child(2), .report-export-ready .report-table--cols-4 td:nth-child(2) { width: 24%; }
      .report-export-ready .report-table--cols-4 th:nth-child(3), .report-export-ready .report-table--cols-4 td:nth-child(3) { width: 24%; }
      .report-export-ready .report-table--cols-4 th:nth-child(4), .report-export-ready .report-table--cols-4 td:nth-child(4) { width: 24%; }
      .report-export-ready .report-table--cols-5 th:nth-child(1), .report-export-ready .report-table--cols-5 td:nth-child(1) { width: 24%; }
      .report-export-ready .report-table--cols-5 th:nth-child(2), .report-export-ready .report-table--cols-5 td:nth-child(2) { width: 12%; }
      .report-export-ready .report-table--cols-5 th:nth-child(3), .report-export-ready .report-table--cols-5 td:nth-child(3) { width: 20%; }
      .report-export-ready .report-table--cols-5 th:nth-child(4), .report-export-ready .report-table--cols-5 td:nth-child(4) { width: 12%; }
      .report-export-ready .report-table--cols-5 th:nth-child(5), .report-export-ready .report-table--cols-5 td:nth-child(5) { width: 32%; }
      .report-export-ready .report-table--cols-6 th:nth-child(1), .report-export-ready .report-table--cols-6 td:nth-child(1) { width: 18%; }
      .report-export-ready .report-table--cols-6 th:nth-child(2), .report-export-ready .report-table--cols-6 td:nth-child(2) { width: 8%; }
      .report-export-ready .report-table--cols-6 th:nth-child(3), .report-export-ready .report-table--cols-6 td:nth-child(3) { width: 14%; }
      .report-export-ready .report-table--cols-6 th:nth-child(4), .report-export-ready .report-table--cols-6 td:nth-child(4) { width: 24%; }
      .report-export-ready .report-table--cols-6 th:nth-child(5), .report-export-ready .report-table--cols-6 td:nth-child(5) { width: 14%; }
      .report-export-ready .report-table--cols-6 th:nth-child(6), .report-export-ready .report-table--cols-6 td:nth-child(6) { width: 22%; }
      .report-export-ready .report-table--cols-7 th:nth-child(1), .report-export-ready .report-table--cols-7 td:nth-child(1) { width: 11%; }
      .report-export-ready .report-table--cols-7 th:nth-child(2), .report-export-ready .report-table--cols-7 td:nth-child(2) { width: 20%; }
      .report-export-ready .report-table--cols-7 th:nth-child(3), .report-export-ready .report-table--cols-7 td:nth-child(3) { width: 14%; }
      .report-export-ready .report-table--cols-7 th:nth-child(4), .report-export-ready .report-table--cols-7 td:nth-child(4) { width: 13%; }
      .report-export-ready .report-table--cols-7 th:nth-child(5), .report-export-ready .report-table--cols-7 td:nth-child(5) { width: 14%; }
      .report-export-ready .report-table--cols-7 th:nth-child(6), .report-export-ready .report-table--cols-7 td:nth-child(6) { width: 14%; }
      .report-export-ready .report-table--cols-7 th:nth-child(7), .report-export-ready .report-table--cols-7 td:nth-child(7) { width: 14%; }
      .report-export-ready .report-table--cols-8 th:nth-child(1), .report-export-ready .report-table--cols-8 td:nth-child(1) { width: 14%; }
      .report-export-ready .report-table--cols-8 th:nth-child(2), .report-export-ready .report-table--cols-8 td:nth-child(2) { width: 8%; }
      .report-export-ready .report-table--cols-8 th:nth-child(3), .report-export-ready .report-table--cols-8 td:nth-child(3) { width: 12%; }
      .report-export-ready .report-table--cols-8 th:nth-child(4), .report-export-ready .report-table--cols-8 td:nth-child(4) { width: 12%; }
      .report-export-ready .report-table--cols-8 th:nth-child(5), .report-export-ready .report-table--cols-8 td:nth-child(5) { width: 12%; }
      .report-export-ready .report-table--cols-8 th:nth-child(6), .report-export-ready .report-table--cols-8 td:nth-child(6) { width: 12%; }
      .report-export-ready .report-table--cols-8 th:nth-child(7), .report-export-ready .report-table--cols-8 td:nth-child(7) { width: 12%; }
      .report-export-ready .report-table--cols-8 th:nth-child(8), .report-export-ready .report-table--cols-8 td:nth-child(8) { width: 18%; }
      .report-export-ready .report-table--cols-9 th:nth-child(1), .report-export-ready .report-table--cols-9 td:nth-child(1) { width: 13%; }
      .report-export-ready .report-table--cols-9 th:nth-child(2), .report-export-ready .report-table--cols-9 td:nth-child(2) { width: 7%; }
      .report-export-ready .report-table--cols-9 th:nth-child(3), .report-export-ready .report-table--cols-9 td:nth-child(3) { width: 11%; }
      .report-export-ready .report-table--cols-9 th:nth-child(4), .report-export-ready .report-table--cols-9 td:nth-child(4) { width: 11%; }
      .report-export-ready .report-table--cols-9 th:nth-child(5), .report-export-ready .report-table--cols-9 td:nth-child(5) { width: 11%; }
      .report-export-ready .report-table--cols-9 th:nth-child(6), .report-export-ready .report-table--cols-9 td:nth-child(6) { width: 11%; }
      .report-export-ready .report-table--cols-9 th:nth-child(7), .report-export-ready .report-table--cols-9 td:nth-child(7) { width: 11%; }
      .report-export-ready .report-table--cols-9 th:nth-child(8), .report-export-ready .report-table--cols-9 td:nth-child(8) { width: 11%; }
      .report-export-ready .report-table--cols-9 th:nth-child(9), .report-export-ready .report-table--cols-9 td:nth-child(9) { width: 14%; }
      .report-export-ready .report-table--cols-10 th:nth-child(1), .report-export-ready .report-table--cols-10 td:nth-child(1) { width: 12%; }
      .report-export-ready .report-table--cols-10 th:nth-child(2), .report-export-ready .report-table--cols-10 td:nth-child(2) { width: 6%; }
      .report-export-ready .report-table--cols-10 th:nth-child(3), .report-export-ready .report-table--cols-10 td:nth-child(3) { width: 9%; }
      .report-export-ready .report-table--cols-10 th:nth-child(4), .report-export-ready .report-table--cols-10 td:nth-child(4) { width: 11%; }
      .report-export-ready .report-table--cols-10 th:nth-child(5), .report-export-ready .report-table--cols-10 td:nth-child(5) { width: 9%; }
      .report-export-ready .report-table--cols-10 th:nth-child(6), .report-export-ready .report-table--cols-10 td:nth-child(6) { width: 11%; }
      .report-export-ready .report-table--cols-10 th:nth-child(7), .report-export-ready .report-table--cols-10 td:nth-child(7) { width: 8%; }
      .report-export-ready .report-table--cols-10 th:nth-child(8), .report-export-ready .report-table--cols-10 td:nth-child(8) { width: 11%; }
      .report-export-ready .report-table--cols-10 th:nth-child(9), .report-export-ready .report-table--cols-10 td:nth-child(9) { width: 11%; }
      .report-export-ready .report-table--cols-10 th:nth-child(10), .report-export-ready .report-table--cols-10 td:nth-child(10) { width: 12%; }
      .report-export-ready .report-table--payment-members th:nth-child(1), .report-export-ready .report-table--payment-members td:nth-child(1) { width: 28% !important; }
      .report-export-ready .report-table--payment-members th:nth-child(2), .report-export-ready .report-table--payment-members td:nth-child(2) { width: 12% !important; }
      .report-export-ready .report-table--payment-members th:nth-child(3), .report-export-ready .report-table--payment-members td:nth-child(3) { width: 12% !important; }
      .report-export-ready .report-table--payment-members th:nth-child(4), .report-export-ready .report-table--payment-members td:nth-child(4) { width: 22% !important; }
      .report-export-ready .report-table--payment-members th:nth-child(5), .report-export-ready .report-table--payment-members td:nth-child(5) { width: 12% !important; }
      .report-export-ready .report-table--payment-members th:nth-child(6), .report-export-ready .report-table--payment-members td:nth-child(6) { width: 14% !important; }
      .report-export-ready .report-table--convocation-summary th:nth-child(1), .report-export-ready .report-table--convocation-summary td:nth-child(1) { width: 30%; }
      .report-export-ready .report-table--convocation-summary th:nth-child(2), .report-export-ready .report-table--convocation-summary td:nth-child(2) { width: 14%; }
      .report-export-ready .report-table--convocation-summary th:nth-child(3), .report-export-ready .report-table--convocation-summary td:nth-child(3) { width: 14%; }
      .report-export-ready .report-table--convocation-summary th:nth-child(4), .report-export-ready .report-table--convocation-summary td:nth-child(4) { width: 14%; }
      .report-export-ready .report-table--convocation-summary th:nth-child(5), .report-export-ready .report-table--convocation-summary td:nth-child(5) { width: 28%; }
      .report-export-ready .report-table--employment th:nth-child(1), .report-export-ready .report-table--employment td:nth-child(1) { width: 13%; }
      .report-export-ready .report-table--employment th:nth-child(2), .report-export-ready .report-table--employment td:nth-child(2) { width: 6%; }
      .report-export-ready .report-table--employment th:nth-child(3), .report-export-ready .report-table--employment td:nth-child(3) { width: 9%; }
      .report-export-ready .report-table--employment th:nth-child(4), .report-export-ready .report-table--employment td:nth-child(4) { width: 11%; }
      .report-export-ready .report-table--employment th:nth-child(5), .report-export-ready .report-table--employment td:nth-child(5) { width: 9%; }
      .report-export-ready .report-table--employment th:nth-child(6), .report-export-ready .report-table--employment td:nth-child(6) { width: 13%; }
      .report-export-ready .report-table--employment th:nth-child(7), .report-export-ready .report-table--employment td:nth-child(7) { width: 10%; }
      .report-export-ready .report-table--employment th:nth-child(8), .report-export-ready .report-table--employment td:nth-child(8) { width: 11%; }
      .report-export-ready .report-table--employment th:nth-child(9), .report-export-ready .report-table--employment td:nth-child(9) { width: 9%; }
      .report-export-ready .report-table--employment th:nth-child(10), .report-export-ready .report-table--employment td:nth-child(10) { width: 9%; }
      .report-export-ready .report-table--employment td {
        white-space: normal !important;
        overflow-wrap: break-word !important;
        vertical-align: top !important;
      }
      .report-export-ready .report-table--employment .report-cell-phone {
        max-width: 0 !important;
        word-break: break-all !important;
        overflow-wrap: anywhere !important;
      }
      .report-export-ready .report-table--employment .report-cell-status {
        white-space: nowrap !important;
      }
      .report-export-ready .report-table--employment .report-cell-status .status-tag {
        white-space: nowrap !important;
      }
    `;
  },

  _getExportStyles({ mode = 'capture', pageContentPx = null } = {}) {
    return this._getContestExportStyles({ mode }) + this._getSheetExportStyles({ mode, pageContentPx });
  },

  _injectCaptureStyles(pageContentPx) {
    let el = document.getElementById('reportExportCaptureStyles');
    if (!el) {
      el = document.createElement('style');
      el.id = 'reportExportCaptureStyles';
      document.head.appendChild(el);
    }
    el.textContent = this._getExportStyles({ mode: 'capture', pageContentPx });
    return el;
  },

  _removeCaptureStyles() {
    document.getElementById('reportExportCaptureStyles')?.remove();
  },

  _getPrintStyles({ landscape = false } = {}) {
    const pageRule = landscape
      ? '@page { size: A4 landscape; margin: 8mm; }'
      : '@page { size: A4 portrait; margin: 10mm; }';
    return `
      ${pageRule}
      html, body {
        margin: 0;
        padding: 0;
        height: auto !important;
        min-height: 0 !important;
        background: #fff;
        width: 100% !important;
        max-width: 100% !important;
      }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
      .report-print-root,
      .report-paper,
      .report-sheet,
      .contest-report-sheet,
      .quran-whole-report-bundle {
        box-shadow: none !important;
        border-radius: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
        margin: 0 !important;
        height: auto !important;
        min-height: 0 !important;
      }
      ${this._getExportStyles({ mode: 'print' })}
      .report-sheet-header,
      .report-meta-grid,
      .report-block,
      .report-block-head,
      .report-table,
      .report-table-wrap {
        width: 100% !important;
        max-width: 100% !important;
      }
      .report-footer-bar, .footer {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        flex-wrap: wrap !important;
        page-break-inside: avoid !important;
        break-inside: avoid-page !important;
      }
      .report-footer-bar--month { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .report-meeting-section,
      .report-month-section {
        page-break-inside: auto !important;
        break-inside: auto !important;
      }
      .report-meeting-section + .report-meeting-section,
      .report-month-section + .report-month-section {
        page-break-before: always !important;
        break-before: page !important;
      }
      .report-block,
      .report-sheet-header {
        page-break-inside: avoid !important;
        break-inside: avoid-page !important;
      }
      .report-table thead { display: table-header-group !important; }
      .report-table tr,
      .contest-report-participants-table tr {
        page-break-inside: avoid !important;
        break-inside: avoid-page !important;
      }
      .contest-report-participants-table thead { display: table-header-group !important; }
      .no-print { display: none !important; visibility: hidden !important; }
      @media print {
        html, body, body * { visibility: visible !important; }
        .no-print { display: none !important; visibility: hidden !important; }
        .report-print-root, .report-print-root * { visibility: visible !important; }
      }
    `;
  },

  _collectPrintStyles() {
    return [...document.querySelectorAll('link[rel="stylesheet"], style')]
      .map((node) => node.outerHTML)
      .join('');
  },

  _wrapPrintBodyHtml(clone) {
    if (!clone) return '';
    if (clone.matches?.('.report-print-root, .report-preview') || clone.id === 'report-preview') {
      return clone.outerHTML;
    }
    return `<div id="report-preview" class="report-print-root report-preview">${clone.outerHTML}</div>`;
  },

  _capturePageWidth(landscape) {
    return landscape ? 1123 : 794;
  },

  _measureContentHeight(root) {
    if (!root) return 200;
    const footer = root.querySelector('.report-footer-bar:last-of-type')
      || root.querySelector('.report-footer-bar')
      || root.querySelector('.footer');
    if (footer) {
      const rootRect = root.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return Math.ceil(footerRect.bottom - rootRect.top + 2);
    }
    return Math.max(root.scrollHeight, root.offsetHeight, 200);
  },

  _sizeCaptureRoot(clone, widthPx, heightPx) {
    if (!clone) return;
    clone.style.setProperty('width', `${widthPx}px`, 'important');
    clone.style.setProperty('min-width', `${widthPx}px`, 'important');
    clone.style.setProperty('max-width', `${widthPx}px`, 'important');
    clone.style.setProperty('height', `${heightPx}px`, 'important');
    clone.style.setProperty('min-height', `${heightPx}px`, 'important');
    clone.style.setProperty('max-height', `${heightPx}px`, 'important');
    clone.style.setProperty('overflow', 'visible', 'important');
    clone.style.setProperty('box-sizing', 'border-box', 'important');
    clone.style.setProperty('margin', '0', 'important');
    const keepPadding = clone.matches?.('.contest-report-sheet, .quran-whole-report-bundle');
    if (!keepPadding) {
      clone.style.setProperty('padding', '0', 'important');
    }
  },

  _prepareCaptureClone(clone, widthPx) {
    this._prepareExportClone(clone, { mode: 'capture', pageContentPx: widthPx });
    this._applySheetFullWidth(clone, widthPx, 'capture');
    const heightPx = this._measureContentHeight(clone);
    this._sizeCaptureRoot(clone, widthPx, heightPx);
    return { widthPx, heightPx };
  },

  _applySheetFullWidth(clone, pageContentPx, mode) {
    const usePx = mode === 'capture' && pageContentPx;
    const setWidth = (el) => {
      if (!el) return;
      if (usePx) {
        el.style.setProperty('width', `${pageContentPx}px`, 'important');
        el.style.setProperty('min-width', `${pageContentPx}px`, 'important');
        el.style.setProperty('max-width', `${pageContentPx}px`, 'important');
      } else {
        el.style.setProperty('width', '100%', 'important');
        el.style.setProperty('max-width', '100%', 'important');
      }
      el.style.setProperty('box-sizing', 'border-box', 'important');
      el.style.setProperty('display', 'block', 'important');
    };

    this._getReportSheets(clone).forEach(setWidth);
    if (clone.matches?.('.report-sheet')) setWidth(clone);

    clone.querySelectorAll(
      '.report-sheet-header, .report-meta-grid, .report-block, .report-block-head, .report-footer-bar, .report-month-section, .report-meeting-section',
    ).forEach((el) => {
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('max-width', '100%', 'important');
      el.style.setProperty('box-sizing', 'border-box', 'important');
    });
  },

  _buildPrintDocumentHtml(clone, styles, { landscape = false } = {}) {
    const bodyHtml = this._wrapPrintBodyHtml(clone);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Print Report</title>${styles}<style>${this._getPrintStyles({ landscape })}</style></head><body>${bodyHtml}</body></html>`;
  },

  _printHtmlDocument(html) {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
      document.body.appendChild(iframe);

      const frameWin = iframe.contentWindow;
      const frameDoc = iframe.contentDocument || frameWin?.document;
      if (!frameWin || !frameDoc) {
        document.body.removeChild(iframe);
        resolve(false);
        return;
      }

      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();

      const cleanup = () => {
        iframe.remove();
        resolve(true);
      };

      frameWin.focus();
      setTimeout(() => {
        frameWin.print();
        setTimeout(cleanup, 1000);
      }, 450);
    });
  },

  async printElement(element) {
    if (!element) return;
    await this._prepareExportImages(element);
    const { host, clone, landscape } = this._buildPrintHost(element);
    const styles = this._collectPrintStyles();
    const html = this._buildPrintDocumentHtml(clone, styles, { landscape });
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) {
      const printed = await this._printHtmlDocument(html);
      document.body.removeChild(host);
      if (!printed) {
        const preview = document.getElementById('report-preview');
        if (preview && preview.style.display !== 'none' && preview.querySelector('.report-sheet')) {
          window.print();
        }
      }
      return;
    }
    win.document.write(html);
    win.document.close();
    document.body.removeChild(host);
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 450);
  },

  async _waitForImages(element) {
    const imgs = [...element.querySelectorAll('img')];
    await Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  },

  _resolveLogoPngUrl() {
    try {
      return new URL('../../img/logo.png', window.location.href).href;
    } catch (_) {
      return '../../img/logo.png';
    }
  },

  /**
   * html2canvas often blanks SVG logos on mobile. Prefer PNG and inline as data URL.
   */
  async _prepareExportImages(element) {
    if (!element) return;
    const logoPng = this._resolveLogoPngUrl();
    const imgs = [...element.querySelectorAll('img')];
    await Promise.all(imgs.map(async (img) => {
      try {
        const src = img.getAttribute('src') || img.currentSrc || '';
        if (/\.svg(\?|$)/i.test(src) || /logo\.svg/i.test(src)) {
          img.src = logoPng;
        } else if (!src || /logo\.(svg|png)/i.test(src)) {
          img.src = logoPng;
        }
        if (!img.complete || !img.naturalWidth) {
          await new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 4000);
          });
        }
        if (img.naturalWidth > 0) {
          const c = document.createElement('canvas');
          const size = Math.max(img.naturalWidth, img.naturalHeight, 128);
          c.width = size;
          c.height = size;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          img.src = c.toDataURL('image/png');
        }
      } catch (e) {
        console.warn('Export logo prepare failed', e);
      }
    }));
  },

  _isWideExport(element) {
    if (!element) return false;
    /* Summer reports: portrait is enough and much faster to capture. */
    if (element.classList?.contains('summer-program-report')
      || element.querySelector?.('.summer-program-report')) {
      return false;
    }
    if (element.querySelector('.contest-report-participants-table')) return true;
    return this._maxTableColumns(element) >= 6;
  },

  _isFastTallExport(element) {
    return !!(element?.classList?.contains('summer-program-report')
      || element?.querySelector?.('.summer-program-report'));
  },

  _prepareReportTables(clone) {
    clone.querySelectorAll('.report-table').forEach((tbl) => {
      const cols = tbl.querySelectorAll('thead th').length;
      tbl.classList.remove(
        'report-table--cols-2', 'report-table--cols-3', 'report-table--cols-4',
        'report-table--cols-5', 'report-table--cols-6', 'report-table--cols-7',
        'report-table--cols-8', 'report-table--cols-9', 'report-table--cols-10',
      );
      if (!tbl.classList.contains('report-table--payment-members')
        && !tbl.classList.contains('report-table--convocation-summary')
        && !tbl.classList.contains('report-table--employment')
        && cols >= 2 && cols <= 10) {
        tbl.classList.add(`report-table--cols-${cols}`);
      }
      tbl.style.setProperty('width', '100%', 'important');
      tbl.style.setProperty('min-width', '100%', 'important');
      tbl.style.setProperty('max-width', '100%', 'important');
      tbl.style.setProperty('table-layout', 'fixed', 'important');
      tbl.style.setProperty('display', 'table', 'important');
    });
  },

  _prepareExportClone(clone, { mode = 'capture', pageContentPx = null } = {}) {
    const landscape = this._isWideExport(clone);
    const widthPx = pageContentPx || this._capturePageWidth(landscape);

    clone.querySelectorAll('.contest-report-participants-wrap').forEach((wrap) => {
      if (mode === 'preview') {
        wrap.style.overflowX = 'auto';
        wrap.style.overflowY = 'visible';
        wrap.style.maxWidth = '100%';
        wrap.style.width = '100%';
      } else {
        wrap.style.overflow = 'visible';
        wrap.style.maxWidth = '100%';
        wrap.style.width = '100%';
      }
    });

    clone.querySelectorAll('.contest-report-participants-table').forEach((tbl) => {
      const isSummer = tbl.classList.contains('contest-report-participants-table--summer');
      if (mode === 'preview') {
        tbl.style.width = 'max-content';
        tbl.style.minWidth = isSummer ? '1050px' : '900px';
        tbl.style.maxWidth = 'none';
        tbl.style.tableLayout = 'auto';
      } else if (isSummer) {
        tbl.style.width = '100%';
        tbl.style.minWidth = '0';
        tbl.style.maxWidth = '100%';
        tbl.style.tableLayout = 'auto';
      } else {
        tbl.style.width = '100%';
        tbl.style.minWidth = '0';
        tbl.style.maxWidth = '100%';
        tbl.style.tableLayout = 'fixed';
      }
    });

    this._prepareReportTables(clone);

    const widthStyle = (mode === 'preview' || mode === 'print')
      ? { width: '100%', maxWidth: '100%' }
      : { width: `${widthPx}px`, maxWidth: `${widthPx}px` };

    clone.querySelectorAll('.contest-report-sheet, .quran-whole-report-bundle').forEach((sheet) => {
      sheet.classList.add('report-export-ready');
      sheet.style.width = widthStyle.width;
      sheet.style.maxWidth = widthStyle.maxWidth;
      sheet.style.boxSizing = 'border-box';
      sheet.style.overflow = 'visible';
      sheet.style.padding = mode === 'preview' ? '24px 28px' : '28px 32px';
    });

    this._getReportSheets(clone).forEach((sheet) => {
      sheet.classList.add('report-export-ready');
      sheet.style.boxSizing = 'border-box';
      sheet.style.overflow = 'visible';
      sheet.style.padding = '0';
      sheet.style.margin = '0';
    });

    this._applySheetFullWidth(clone, widthPx, mode);

    if (mode === 'capture') {
      clone.style.setProperty('width', `${widthPx}px`, 'important');
      clone.style.setProperty('min-width', `${widthPx}px`, 'important');
      clone.style.setProperty('max-width', `${widthPx}px`, 'important');
    } else {
      clone.style.margin = '0';
      clone.style.width = widthStyle.width;
      clone.style.maxWidth = widthStyle.maxWidth;
    }
    clone.style.boxSizing = 'border-box';
    clone.style.overflow = 'visible';
    return { pageContentPx: widthPx, landscape };
  },

  _buildCaptureHost(element, { landscape = null, targetWidth = null } = {}) {
    const useLandscape = landscape ?? this._isWideExport(element);
    const pageContentPx = targetWidth || this._capturePageWidth(useLandscape);

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      `width:${pageContentPx}px`,
      'overflow:visible',
      'background:#fff',
      'pointer-events:none',
      'z-index:-1',
    ].join(';');

    const style = document.createElement('style');
    style.textContent = this._getExportStyles({ mode: 'capture', pageContentPx });
    host.appendChild(style);

    const clone = element.cloneNode(true);
    clone.querySelectorAll('.no-print').forEach((node) => node.remove());

    host.appendChild(clone);
    document.body.appendChild(host);
    this._injectCaptureStyles(pageContentPx);

    const origImgs = element.querySelectorAll('img');
    const cloneImgs = clone.querySelectorAll('img');
    origImgs.forEach((img, i) => {
      if (cloneImgs[i]) cloneImgs[i].src = img.currentSrc || img.src;
    });

    return { host, clone, pageContentPx, landscape: useLandscape };
  },

  _buildPrintHost(element) {
    const useLandscape = this._isWideExport(element);

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'width:100%',
      'max-width:100%',
      'overflow:visible',
      'background:#fff',
      'pointer-events:none',
      'z-index:-1',
    ].join(';');

    const style = document.createElement('style');
    style.textContent = this._getExportStyles({ mode: 'print' });
    host.appendChild(style);

    const clone = element.cloneNode(true);
    clone.querySelectorAll('.no-print').forEach((node) => node.remove());
    this._prepareExportClone(clone, { mode: 'print' });
    host.appendChild(clone);
    document.body.appendChild(host);

    const origImgs = element.querySelectorAll('img');
    const cloneImgs = clone.querySelectorAll('img');
    origImgs.forEach((img, i) => {
      if (cloneImgs[i]) cloneImgs[i].src = img.currentSrc || img.src;
    });

    return { host, clone, landscape: useLandscape };
  },

  _maxCanvasDevicePx() {
    return this.MAX_CANVAS_DEVICE_PX || 8192;
  },

  _pickCaptureScale(widthPx, heightPx, { fast = false } = {}) {
    const max = this._maxCanvasDevicePx();
    let scale = fast ? 1 : this.CAPTURE_SCALE;
    if (!fast) {
      if (heightPx > 2500) scale = Math.min(scale, 1.5);
      if (heightPx > 4500) scale = Math.min(scale, 1.25);
    }
    while (scale > 1 && (widthPx * scale > max || heightPx * scale > max)) {
      scale = Math.round((scale - 0.25) * 100) / 100;
    }
    return Math.max(1, scale);
  },

  async _html2canvasRegion(el, { scale, widthPx, heightPx, y = 0, fullHeightPx = null }) {
    const fullH = Math.ceil(fullHeightPx || (heightPx + y) || heightPx);
    return html2canvas(el, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      x: 0,
      y: Math.max(0, Math.floor(y)),
      width: Math.ceil(widthPx),
      height: Math.ceil(heightPx),
      windowWidth: Math.ceil(widthPx),
      windowHeight: fullH,
      scrollX: 0,
      scrollY: 0,
      onclone: (doc, clonedEl) => {
        const style = doc.createElement('style');
        style.textContent = this._getExportStyles({ mode: 'capture', pageContentPx: widthPx });
        doc.head.appendChild(style);
        this._prepareCaptureClone(clonedEl, widthPx);
      },
    });
  },

  /**
   * Capture one vertical band using a clipped viewport (more reliable than html2canvas y-crop alone).
   */
  async _captureClippedBand(sourceElement, { widthPx, landscape, y, h, totalH, scale }) {
    const { host, clone } = this._buildCaptureHost(sourceElement, { landscape, targetWidth: widthPx });
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      this._prepareCaptureClone(clone, widthPx);
      this._sizeCaptureRoot(clone, widthPx, totalH);

      const frame = document.createElement('div');
      frame.setAttribute('data-export-band-frame', '1');
      frame.style.cssText = [
        `width:${widthPx}px`,
        `height:${h}px`,
        'overflow:hidden',
        'position:relative',
        'background:#ffffff',
        'box-sizing:border-box',
      ].join(';');

      const mover = document.createElement('div');
      mover.style.cssText = [
        `width:${widthPx}px`,
        `height:${totalH}px`,
        `margin-top:${-Math.floor(y)}px`,
        'box-sizing:border-box',
      ].join(';');

      host.appendChild(frame);
      frame.appendChild(mover);
      mover.appendChild(clone);

      return await html2canvas(frame, {
        scale,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: Math.ceil(widthPx),
        height: Math.ceil(h),
        windowWidth: Math.ceil(widthPx),
        windowHeight: Math.ceil(h),
        scrollX: 0,
        scrollY: 0,
      });
    } finally {
      this._removeCaptureStyles();
      if (host.parentElement) document.body.removeChild(host);
    }
  },

  /**
   * Capture report for export. Tall reports use short bands only when needed.
   * Summer "All" prefers a single scale-1 capture for speed.
   */
  async _captureExport(element) {
    const hasImgs = !!element?.querySelector?.('img');
    if (hasImgs) await this._prepareExportImages(element);
    await this._waitForImages(element);
    const fast = this._isFastTallExport(element);
    const landscape = this._isWideExport(element);
    const widthPx = this._capturePageWidth(landscape);
    const { host, clone } = this._buildCaptureHost(element, { landscape, targetWidth: widthPx });

    let heightPx = 200;
    let scale = fast ? 1 : this.CAPTURE_SCALE;
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      ({ heightPx } = this._prepareCaptureClone(clone, widthPx));
      scale = this._pickCaptureScale(widthPx, heightPx, { fast });
      const rowZones = this._pdfTableRowZones(clone, scale);
      this._lastCaptureMeta = { heightPx, scale, rowZones, widthPx };

      const maxDevice = this._maxCanvasDevicePx();
      const fitsSingle = (widthPx * scale <= maxDevice) && (heightPx * scale <= maxDevice);
      if (fitsSingle) {
        const canvas = await this._html2canvasRegion(clone, {
          scale,
          widthPx,
          heightPx,
          y: 0,
          fullHeightPx: heightPx,
        });
        return { mode: 'single', canvas, scale, widthPx, heightPx, landscape };
      }
    } finally {
      this._removeCaptureStyles();
      if (host.parentElement) document.body.removeChild(host);
    }

    /* Fewer, taller bands when a single shot does not fit. */
    const bandH = fast ? 1800 : 900;
    const bands = [];
    for (let y = 0; y < heightPx; y += bandH) {
      const h = Math.min(bandH, heightPx - y);
      const canvas = await this._captureClippedBand(element, {
        widthPx,
        landscape,
        y,
        h,
        totalH: heightPx,
        scale,
      });
      bands.push({ canvas, y, h });
    }
    return { mode: 'bands', bands, scale, widthPx, heightPx, landscape };
  },

  /**
   * Merge multiple report elements into one PDF (used for Summer "All" sections).
   */
  async downloadPdfFromElements(elements, filenameBase) {
    if (!elements?.length) return;
    if (!window.jspdf?.jsPDF) {
      await this.printElement(elements[0]);
      return;
    }
    const { jsPDF } = window.jspdf;
    let pdf = null;
    const maxPageH = 1123;

    for (const el of elements) {
      if (!el) continue;
      const capture = await this._captureExport(el);
      const pieces = capture.mode === 'single'
        ? [{ canvas: capture.canvas }]
        : (capture.bands || []);
      const scale = capture.scale || this.CAPTURE_SCALE;

      for (const piece of pieces) {
        const canvas = piece.canvas;
        if (!canvas?.width) continue;
        const logicalW = canvas.width / scale;
        const pageHeightDevice = maxPageH * scale;
        const starts = this._pdfSliceStarts(canvas.height, pageHeightDevice, [], [], []);
        const sliceCanvas = document.createElement('canvas');
        const ctx = sliceCanvas.getContext('2d');

        starts.forEach((start, index) => {
          const end = starts[index + 1] ?? canvas.height;
          const sliceDeviceH = end - start;
          if (sliceDeviceH <= 0) return;
          const sliceLogicalH = sliceDeviceH / scale;
          const orient = this._pageOrientation(logicalW, sliceLogicalH);
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceDeviceH;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, sliceDeviceH);
          ctx.drawImage(canvas, 0, start, canvas.width, sliceDeviceH, 0, 0, canvas.width, sliceDeviceH);

          if (!pdf) {
            pdf = new jsPDF({
              unit: 'px',
              format: [logicalW, sliceLogicalH],
              orientation: orient,
              hotfixes: ['px_scaling'],
            });
          } else {
            pdf.addPage([logicalW, sliceLogicalH], orient);
          }
          pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 0, 0, logicalW, sliceLogicalH);
        });
      }
    }

    if (pdf) pdf.save(`${filenameBase}.pdf`);
    else throw new Error('No PDF pages generated');
  },

  _stitchBandCanvases(bands) {
    if (!bands?.length) return null;
    if (bands.length === 1) return bands[0].canvas;
    const width = bands[0].canvas.width;
    const totalH = bands.reduce((sum, b) => sum + b.canvas.height, 0);
    const max = this._maxCanvasDevicePx();
    if (width > max || totalH > max) return null;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = totalH;
    const ctx = out.getContext('2d');
    let dy = 0;
    for (const band of bands) {
      ctx.drawImage(band.canvas, 0, dy);
      dy += band.canvas.height;
    }
    return out;
  },

  async downloadImage(element, filenameBase) {
    if (!element || typeof html2canvas === 'undefined') {
      alert('Image export is not available.');
      return;
    }
    try {
      const capture = await this._captureExport(element);
      if (capture.mode === 'single') {
        const link = document.createElement('a');
        link.download = `${filenameBase}.png`;
        link.href = capture.canvas.toDataURL('image/png');
        link.click();
        return;
      }

      const stitched = this._stitchBandCanvases(capture.bands);
      if (stitched) {
        const link = document.createElement('a');
        link.download = `${filenameBase}.png`;
        link.href = stitched.toDataURL('image/png');
        link.click();
        return;
      }

      for (let i = 0; i < capture.bands.length; i++) {
        const link = document.createElement('a');
        link.download = `${filenameBase}_part${i + 1}.png`;
        link.href = capture.bands[i].canvas.toDataURL('image/png');
        link.click();
        await new Promise((r) => setTimeout(r, 250));
      }
      alert(`Report is large — downloaded as ${capture.bands.length} image parts.`);
    } catch (e) {
      console.error('Image export failed', e);
      alert('Image download failed. Try Download PDF, or pick a single day filter.');
    }
  },

  async downloadPdf(element, filenameBase, options = {}) {
    if (!element || typeof html2canvas === 'undefined') {
      alert('PDF export is not available.');
      return;
    }
    if (options.preview !== false) {
      await this.previewBeforeDownload(element, filenameBase);
      return;
    }
    try {
      const capture = await this._captureExport(element);

      if (window.jspdf && window.jspdf.jsPDF) {
        this._saveCaptureAsPdf(capture, filenameBase, element);
        return;
      }

      await this.printElement(element);
    } catch (e) {
      console.error('PDF export failed', e);
      try {
        await this.printElement(element);
      } catch (_) {
        alert('PDF download failed. Try Print, or pick a single day filter.');
      }
    }
  },

  _ensurePreviewModal() {
    if (document.getElementById('exportPreviewModal')) return;
    const el = document.createElement('div');
    el.id = 'exportPreviewModal';
    el.className = 'portal-modal-overlay';
    el.style.zIndex = '3010';
    el.innerHTML = `
      <div class="portal-modal-card portal-modal-card--lg" style="max-width:min(960px,96vw);max-height:92vh;display:flex;flex-direction:column;">
        <div class="portal-modal-head" style="flex-shrink:0;">
          <h3 id="exportPreviewTitle">Report preview</h3>
          <button type="button" class="portal-modal-close" id="exportPreviewClose" aria-label="Close">&times;</button>
        </div>
        <div id="exportPreviewBody" style="overflow-x:auto;overflow-y:auto;flex:1;padding:8px;background:#f8fafc;border-radius:12px;-webkit-overflow-scrolling:touch;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:14px;flex-shrink:0;">
          <button type="button" class="btn btn-outline" id="exportPreviewPrint"><i class="fa-solid fa-print"></i> Print</button>
          <button type="button" class="btn btn-outline" id="exportPreviewImage"><i class="fa-solid fa-image"></i> Download Image</button>
          <button type="button" class="btn btn-primary" id="exportPreviewPdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    const close = () => {
      el.classList.remove('is-open');
      document.getElementById('exportPreviewBody').innerHTML = '';
      el._previewSheet = null;
      el._previewSource = null;
      el._previewName = '';
      document.body.style.overflow = '';
    };
    el.querySelector('#exportPreviewClose')?.addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('#exportPreviewPrint')?.addEventListener('click', async () => {
      const source = el._previewSource || el._previewSheet;
      if (source) await this.printElement(source);
    });
    el.querySelector('#exportPreviewImage')?.addEventListener('click', async () => {
      const source = el._previewSource || el._previewSheet;
      if (source) await this.downloadImage(source, el._previewName);
    });
    el.querySelector('#exportPreviewPdf')?.addEventListener('click', async () => {
      const source = el._previewSource || el._previewSheet;
      if (source) await this.downloadPdf(source, el._previewName, { preview: false });
    });
  },

  async previewBeforeDownload(element, filenameBase, title) {
    if (!element) return;
    this._ensurePreviewModal();
    const modal = document.getElementById('exportPreviewModal');
    const body = document.getElementById('exportPreviewBody');
    const titleEl = document.getElementById('exportPreviewTitle');
    if (body) {
      body.style.overflowX = 'auto';
      body.style.overflowY = 'auto';
      body.style.webkitOverflowScrolling = 'touch';
    }

    if (!body.querySelector('#exportPreviewStyles')) {
      const style = document.createElement('style');
      style.id = 'exportPreviewStyles';
      style.textContent = this._getExportStyles({ mode: 'preview' });
      document.head.appendChild(style);
    }

    const sheet = element.cloneNode(true);
    this._prepareExportClone(sheet, { mode: 'preview' });
    sheet.style.margin = '0 auto';
    body.innerHTML = '';
    body.appendChild(sheet);
    body.style.overflowX = 'auto';
    body.style.overflowY = 'auto';
    titleEl.textContent = title || 'Report preview';
    modal._previewSource = element;
    modal._previewSheet = sheet;
    modal._previewName = filenameBase;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  },

  _pageOrientation(pageW, pageH) {
    return pageW >= pageH ? 'l' : 'p';
  },

  _pdfFooterZones(element, scaleY) {
    if (!element) return [];
    const rootRect = element.getBoundingClientRect();
    const rootTop = rootRect.top + (element.scrollTop || 0);
    return [...element.querySelectorAll('.report-footer-bar')].map((footer) => {
      const r = footer.getBoundingClientRect();
      return {
        top: (r.top - rootTop) * scaleY,
        bottom: (r.bottom - rootTop) * scaleY,
      };
    });
  },

  _pdfTableRowZones(element, scaleY) {
    if (!element) return [];
    const rootRect = element.getBoundingClientRect();
    const rootTop = rootRect.top + (element.scrollTop || 0);
    const nodes = [
      ...element.querySelectorAll('.contest-report-participants-table tbody tr'),
      ...element.querySelectorAll('.report-table tbody tr'),
      ...element.querySelectorAll('.summer-report-break-avoid'),
      ...element.querySelectorAll('.summer-report-dufcad-block'),
      ...element.querySelectorAll('.summer-report-day-list li'),
    ];
    return nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return {
        top: (r.top - rootTop) * scaleY,
        bottom: (r.bottom - rootTop) * scaleY,
      };
    }).filter((z) => z.bottom > z.top + 1);
  },

  _pdfSectionBreaks(element, scaleY) {
    if (!element) return [];
    const rootRect = element.getBoundingClientRect();
    const rootTop = rootRect.top + (element.scrollTop || 0);
    const sections = [
      ...element.querySelectorAll('.report-month-section'),
      ...element.querySelectorAll('.report-meeting-section'),
    ].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (sections.length < 2) return [];
    return sections.slice(0, -1).map((section, index) => {
      const bottom = section.getBoundingClientRect().bottom;
      const top = sections[index + 1].getBoundingClientRect().top;
      return ((bottom + top) / 2 - rootTop) * scaleY;
    });
  },

  _snapSliceAwayFromRows(next, y, pageHeight, rowZones) {
    if (!rowZones?.length) return next;
    let cut = next;

    for (const row of rowZones) {
      if (cut > row.top + 1 && cut < row.bottom - 1) {
        if (row.top - y >= pageHeight * 0.22) {
          cut = Math.floor(row.top);
        } else {
          cut = Math.ceil(row.bottom);
        }
        break;
      }
    }

    const snapWindow = pageHeight * 0.1;
    let best = null;
    for (const row of rowZones) {
      const edge = row.bottom;
      if (edge <= y + 20 || edge > y + pageHeight + 4) continue;
      if (Math.abs(edge - cut) <= snapWindow) {
        if (best == null || Math.abs(edge - cut) < Math.abs(best - cut)) best = edge;
      }
    }
    if (best != null) cut = Math.round(best);
    return cut;
  },

  _pdfSliceStarts(totalHeight, pageHeight, footerZones, sectionBreaks, rowZones = []) {
    const starts = [0];
    let y = 0;
    while (y + pageHeight < totalHeight - 1) {
      let next = y + pageHeight;

      for (const zone of footerZones) {
        if (next <= zone.top + 4 || next >= zone.bottom - 4) continue;
        const spaceBefore = zone.top - y;
        if (spaceBefore >= pageHeight * 0.15) {
          next = Math.floor(zone.top);
        } else {
          next = Math.ceil(zone.bottom);
        }
        break;
      }

      const snapWindow = pageHeight * 0.12;
      for (const br of sectionBreaks) {
        if (Math.abs(next - br) <= snapWindow && br > y + 24) {
          next = Math.round(br);
          break;
        }
      }

      next = this._snapSliceAwayFromRows(next, y, pageHeight, rowZones);

      if (next <= y) next = y + pageHeight;
      if (next >= totalHeight) break;
      starts.push(next);
      y = next;
    }
    return starts;
  },

  _saveCanvasAsPdf(canvas, filenameBase, sourceElement, options = {}) {
    const { jsPDF } = window.jspdf;
    const scale = options.scale || this.CAPTURE_SCALE;
    const logicalW = canvas.width / scale;
    const logicalH = canvas.height / scale;
    const maxPageH = 1123;

    if (logicalH <= maxPageH) {
      const pdf = new jsPDF({
        unit: 'px',
        format: [logicalW, logicalH],
        orientation: this._pageOrientation(logicalW, logicalH),
        hotfixes: ['px_scaling'],
      });
      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        0,
        0,
        logicalW,
        logicalH,
      );
      pdf.save(`${filenameBase}.pdf`);
      return;
    }

    const meta = this._lastCaptureMeta;
    const scaleY = meta?.heightPx
      ? (canvas.height / Math.max(meta.heightPx, 1))
      : (sourceElement
        ? canvas.height / Math.max(this._measureContentHeight(sourceElement), 1)
        : scale);
    const pageHeightDevice = maxPageH * scale;
    const footerZones = sourceElement ? this._pdfFooterZones(sourceElement, scaleY) : [];
    const sectionBreaks = sourceElement ? this._pdfSectionBreaks(sourceElement, scaleY) : [];
    let rowZones = [];
    if (meta?.rowZones?.length) {
      const expected = Math.max(meta.heightPx * (meta.scale || scale), 1);
      const adjust = canvas.height / expected;
      rowZones = meta.rowZones.map((z) => ({
        top: z.top * adjust,
        bottom: z.bottom * adjust,
      }));
    } else if (sourceElement) {
      rowZones = this._pdfTableRowZones(sourceElement, scaleY);
    }
    const sliceStarts = this._pdfSliceStarts(
      canvas.height,
      pageHeightDevice,
      footerZones,
      sectionBreaks,
      rowZones,
    );

    const sliceCanvas = document.createElement('canvas');
    const ctx = sliceCanvas.getContext('2d');
    let pdf = null;

    sliceStarts.forEach((start, index) => {
      const end = sliceStarts[index + 1] ?? canvas.height;
      const sliceDeviceH = end - start;
      if (sliceDeviceH <= 0) return;
      const sliceLogicalH = sliceDeviceH / scale;
      const orient = this._pageOrientation(logicalW, sliceLogicalH);

      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceDeviceH;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, sliceDeviceH);
      ctx.drawImage(canvas, 0, start, canvas.width, sliceDeviceH, 0, 0, canvas.width, sliceDeviceH);

      if (index === 0) {
        pdf = new jsPDF({
          unit: 'px',
          format: [logicalW, sliceLogicalH],
          orientation: orient,
          hotfixes: ['px_scaling'],
        });
      } else {
        pdf.addPage([logicalW, sliceLogicalH], orient);
      }

      pdf.addImage(
        sliceCanvas.toDataURL('image/png'),
        'PNG',
        0,
        0,
        logicalW,
        sliceLogicalH,
      );
    });

    pdf.save(`${filenameBase}.pdf`);
  },

  /**
   * Build PDF from one or more capture bands (tall Summer "All" reports).
   * Each band is sliced into page-sized chunks like a single canvas.
   */
  _saveCaptureAsPdf(capture, filenameBase, sourceElement) {
    if (!capture) return;
    if (capture.mode === 'single') {
      this._saveCanvasAsPdf(capture.canvas, filenameBase, sourceElement, { scale: capture.scale });
      return;
    }

    const stitched = this._stitchBandCanvases(capture.bands);
    if (stitched) {
      this._saveCanvasAsPdf(stitched, filenameBase, sourceElement, { scale: capture.scale });
      return;
    }

    const { jsPDF } = window.jspdf;
    const scale = capture.scale || this.CAPTURE_SCALE;
    const maxPageH = 1123;
    const logicalW = (capture.bands[0]?.canvas.width || 0) / scale;
    let pdf = null;
    const sliceCanvas = document.createElement('canvas');
    const ctx = sliceCanvas.getContext('2d');

    for (const band of capture.bands) {
      const canvas = band.canvas;
      const pageHeightDevice = maxPageH * scale;
      /* Band-local row snap: zones shifted by band.y */
      const meta = this._lastCaptureMeta;
      let rowZones = [];
      if (meta?.rowZones?.length) {
        const bandTop = band.y * scale;
        const bandBottom = (band.y + band.h) * scale;
        rowZones = meta.rowZones
          .filter((z) => z.bottom > bandTop && z.top < bandBottom)
          .map((z) => ({
            top: Math.max(0, z.top - bandTop),
            bottom: Math.min(canvas.height, z.bottom - bandTop),
          }));
      }
      const sliceStarts = this._pdfSliceStarts(
        canvas.height,
        pageHeightDevice,
        [],
        [],
        rowZones,
      );

      sliceStarts.forEach((start, index) => {
        const end = sliceStarts[index + 1] ?? canvas.height;
        const sliceDeviceH = end - start;
        if (sliceDeviceH <= 0) return;
        const sliceLogicalH = sliceDeviceH / scale;
        const orient = this._pageOrientation(logicalW, sliceLogicalH);

        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceDeviceH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, sliceDeviceH);
        ctx.drawImage(canvas, 0, start, canvas.width, sliceDeviceH, 0, 0, canvas.width, sliceDeviceH);

        if (!pdf) {
          pdf = new jsPDF({
            unit: 'px',
            format: [logicalW, sliceLogicalH],
            orientation: orient,
            hotfixes: ['px_scaling'],
          });
        } else {
          pdf.addPage([logicalW, sliceLogicalH], orient);
        }

        pdf.addImage(
          sliceCanvas.toDataURL('image/png'),
          'PNG',
          0,
          0,
          logicalW,
          sliceLogicalH,
        );
      });
    }

    if (pdf) pdf.save(`${filenameBase}.pdf`);
  },

  menuHtml(id) {
    return `
      <div class="export-dropdown">
        <button type="button" class="btn btn-primary export-btn" id="${id}-toggle" style="height:42px;">
          <i class="fa-solid fa-file-export"></i> Export
        </button>
        <div class="export-options" id="${id}-menu">
          <div class="export-item" data-export-action="print"><i class="fa-solid fa-print"></i> Print</div>
          <div class="export-item" data-export-action="image"><i class="fa-solid fa-image"></i> Download Image</div>
          <div class="export-item" data-export-action="pdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</div>
        </div>
      </div>`;
  },
};

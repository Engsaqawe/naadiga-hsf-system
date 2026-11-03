/**

 * Reports tab bootstrap for Quran Contest + Summer Course shared admin modules.

 */

(function () {

  function ensureQuranGlobals() {

    if (typeof QuranContestAdmin === 'undefined') return;

    window.saveFormSettings = () => QuranContestAdmin.saveFormSettings();

    QuranContestAdmin.bindModalCloses?.();

  }



  function ensureSummerGlobals() {

    if (typeof SummerCourseAdmin === 'undefined') return;

    window.saveSummerFormSettings = () => SummerCourseAdmin.saveFormSettings();

    SummerCourseAdmin.bindModalCloses?.();

  }



  async function loadQuranReport() {

    if (!document.getElementById('quran-tab-content')) return;

    if (typeof QuranContestAdmin === 'undefined') {

      console.error('QuranContestAdmin script missing');

      return;

    }

    ensureQuranGlobals();

    try {

      QuranContestAdmin.bindEvents();

      await QuranContestAdmin.refresh();

    } catch (e) {

      console.error('Quran report tab failed', e);

      QuranContestAdmin.showLoadError?.();

    }

  }



  async function loadSummerReport() {

    if (!document.getElementById('summer-tab-content')) return;

    if (typeof SummerCourseAdmin === 'undefined') {

      console.error('SummerCourseAdmin script missing');

      return;

    }

    ensureSummerGlobals();

    try {

      SummerCourseAdmin.bindEvents();

      await SummerCourseAdmin.refresh();

    } catch (e) {

      console.error('Summer report tab failed', e);

      SummerCourseAdmin.showLoadError?.();

    }

  }



  function initQuranWholeExport() {

    const toggle = document.getElementById('quran-report-export-toggle');

    const menu = document.getElementById('quran-report-export-menu');

    if (!toggle || !menu || menu.dataset.quranWholeExportBound === '1') return;

    menu.dataset.quranWholeExportBound = '1';

    ReportExport.initDropdown(toggle, menu);

    menu.querySelectorAll('.export-item').forEach((item) => {

      item.addEventListener('click', async () => {

        if (typeof ReportExport.closeAllDropdowns === 'function') {
          ReportExport.closeAllDropdowns();
        } else {
          menu.classList.remove('active');
        }

        const action = item.dataset.exportAction;

        if (typeof QuranContestAdmin?.exportWholeReport !== 'function') return;

        await QuranContestAdmin.exportWholeReport(action);

      });

    });

  }



  function initSummerWholeExport() {

    const toggle = document.getElementById('summer-report-export-toggle');

    const menu = document.getElementById('summer-report-export-menu');

    if (!toggle || !menu || menu.dataset.summerWholeExportBound === '1') return;

    menu.dataset.summerWholeExportBound = '1';

    ReportExport.initDropdown(toggle, menu);

    menu.querySelectorAll('.export-item').forEach((item) => {

      item.addEventListener('click', async () => {

        if (typeof ReportExport.closeAllDropdowns === 'function') {
          ReportExport.closeAllDropdowns();
        } else {
          menu.classList.remove('active');
        }

        const action = item.dataset.exportAction;

        if (typeof SummerCourseAdmin?.exportWholeReport !== 'function') return;

        await SummerCourseAdmin.exportWholeReport(action);

      });

    });

  }



  function initExports() {

    if (typeof ReportExport === 'undefined') return;



    initQuranWholeExport();

    initSummerWholeExport();

  }



  window.AppReports = {

    loadQuranReport,

    loadSummerReport,

    init() {

      initExports();

      ensureQuranGlobals();

      ensureSummerGlobals();

    },

  };

})();



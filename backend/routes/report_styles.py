"""Shared print/PDF styles — preserves brand colors when printing or saving as PDF."""

REPORT_PRINT_BASE = """
html, body, * {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
}
body {
  font-family: 'Segoe UI', Arial, sans-serif;
  color: #0f172a;
  margin: 0;
  padding: 16px;
  background: #e8f2ef;
  height: auto;
  min-height: 0;
}
.sheet {
  max-width: 960px;
  margin: 0 auto;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  border: 3px solid #2E946A;
  box-shadow: 0 12px 40px rgba(20,95,64,.15);
}
.header {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 28px 34px;
  background: linear-gradient(135deg, #2E946A, #1A92D4 50%, #1e4a6d) !important;
  color: #fff !important;
}
.header img {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: #fff;
  padding: 10px;
  object-fit: contain;
  box-shadow: 0 6px 20px rgba(0,0,0,.2);
}
.header h1 { margin: 0; font-size: 1.32rem; font-weight: 800; color: #fff !important; }
.header p { margin: 8px 0 0; font-size: 0.95rem; opacity: .95; color: #fff !important; }
.meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 20px;
  padding: 22px 34px;
  background: linear-gradient(180deg, #ecfdf5, #f8fafc) !important;
  border-bottom: 3px solid #2E946A !important;
}
.meta .lbl {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #1e4a6d !important;
  font-weight: 700;
}
.meta .val { font-weight: 700; margin-top: 4px; color: #0f172a !important; }
.report-block { padding: 0 34px 24px; }
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 22px 0 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e2e8f0;
}
.block-head h3 { margin: 0; font-size: 1.05rem; color: #1e4a6d !important; }
.head-paid .badge {
  background: #d1fae5 !important;
  color: #145f40 !important;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 700;
}
.head-unpaid .badge {
  background: #fee2e2 !important;
  color: #b91c1c !important;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 700;
}
table { width: 100%; border-collapse: collapse; font-size: 0.86rem; table-layout: fixed; }
.payment-members-table th:nth-child(1), .payment-members-table td:nth-child(1) { width: 22%; }
.payment-members-table th:nth-child(2), .payment-members-table td:nth-child(2) { width: 12%; }
.payment-members-table th:nth-child(3), .payment-members-table td:nth-child(3) { width: 10%; }
.payment-members-table th:nth-child(4), .payment-members-table td:nth-child(4) { width: 18%; }
.payment-members-table th:nth-child(5), .payment-members-table td:nth-child(5) { width: 10%; }
.payment-members-table th:nth-child(6), .payment-members-table td:nth-child(6) { width: 28%; }
th {
  background: linear-gradient(90deg, #145f40, #1e4a6d) !important;
  color: #fff !important;
  padding: 11px 12px;
  text-align: left;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: .04em;
}
td { padding: 11px 12px; border-bottom: 1px solid #e2e8f0; }
tr.row-paid td { background: #f0fdf9 !important; }
tr.row-unpaid td { background: #fff8f8 !important; }
tr.row-excused td { background: #fffbeb !important; }
td.paid, .paid { color: #145f40 !important; font-weight: 700; }
td.unpaid, .unpaid { color: #dc2626 !important; font-weight: 700; }
.status-tag { font-weight: 600; font-size: 0.88em; }
.status-tag--paid { color: #145f40 !important; }
.status-tag--unpaid { color: #dc2626 !important; }
.status-tag--excused { color: #b45309 !important; }
.sub { font-size: 0.78rem; color: #64748b; }
.empty { text-align: center; color: #64748b; padding: 20px !important; }
.footer {
  padding: 22px 34px;
  background: linear-gradient(90deg, #1e4a6d, #0f172a) !important;
  color: #e2e8f0 !important;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.footer strong { color: #fff !important; }
.total { font-size: 1.35rem; font-weight: 800; color: #6ee7b7 !important; }
.print-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.print-actions button {
  background: linear-gradient(135deg, #2E946A, #1A92D4);
  color: #fff;
  border: none;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.88rem;
}
@media print {
  @page { size: auto; margin: 10mm; }
  .print-actions { display: none !important; }
  html, body { background: #fff; padding: 0; height: auto !important; min-height: 0 !important; }
  .sheet { border: 3px solid #2E946A; box-shadow: none; page-break-after: avoid; }
}
"""

REPORT_EXPORT_BAR = """
    <div class="print-actions no-print">
      <button type="button" onclick="window.print()">Print</button>
      <button type="button" onclick="downloadReportImage()">Download Image</button>
      <button type="button" onclick="downloadReportPdf()">Download PDF</button>
    </div>"""

REPORT_EXPORT_SCRIPTS = """
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script>
async function captureSheet() {
  const el = document.querySelector('.sheet');
  return html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
}
async function downloadReportImage() {
  const c = await captureSheet();
  const a = document.createElement('a');
  a.download = (document.title || 'report').replace(/[^\\w-]+/g, '_') + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}
async function downloadReportPdf() {
  const c = await captureSheet();
  const img = c.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: c.width >= c.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [c.width, c.height],
    hotfixes: ['px_scaling']
  });
  pdf.addImage(img, 'PNG', 0, 0, c.width, c.height);
  pdf.save((document.title || 'report').replace(/[^\\w-]+/g, '_') + '.pdf');
}
</script>"""

/**
 * In-page payment report viewer (dynamic from API data).
 */
const ReportViewer = {
    _lastPrintUrl: null,
    _previewLoader: null,
    _meetingsReportData: null,
    _meetingsReportFiltersBound: false,

    clearPreview() {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (preview) preview.style.display = 'none';
        if (body) body.innerHTML = '';
        if (title) title.textContent = 'Report';
        this._lastPrintUrl = null;
        this._previewLoader = null;
        this._meetingsReportData = null;
        this._setMeetingsFiltersVisible(false);
    },

    setPreviewLoader(loader) {
        this._previewLoader = typeof loader === 'function' ? loader : null;
    },

    _resetMeetingsPreviewMode() {
        this._meetingsReportData = null;
        this._setMeetingsFiltersVisible(false);
    },

    async refreshPreviewIfOpen() {
        const preview = document.getElementById('report-preview');
        if (!preview || preview.style.display === 'none') return;
        if (this._previewLoader) {
            try {
                await this._previewLoader();
            } catch (err) {
                console.error('Failed to refresh report preview', err);
            }
            return;
        }
        this.clearPreview();
    },

    showMonthly(data) {
        this._resetMeetingsPreviewMode();
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const periodTitle = data.periodLabel || (data.year ? `${data.month} ${data.year}` : data.month);
        title.textContent = `${data.convocation} — ${periodTitle}`;
        this._lastPrintUrl = data.isRange ? null : this._printUrl('monthly-payments', {
            convocation: data.convocation,
            month: data.month,
            year: data.year,
            collector: data.collector,
        });

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._monthlyRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        body.innerHTML = this._monthlySheetHtml(data, periodTitle);

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _monthlyUnpaidOnlyBlocks(data) {
        const { blocks } = this._monthlyTableBlocks(data);
        return [blocks.find((b) => b.title === 'Unpaid Members') || blocks[blocks.length - 1]];
    },

    showMonthlyUnpaidOnly(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const periodTitle = data.periodLabel || (data.year ? `${data.month} ${data.year}` : data.month);
        title.textContent = `${data.convocation} — Unpaid Only — ${periodTitle}`;
        this._lastPrintUrl = null;

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._monthlyUnpaidRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        body.innerHTML = this._sheetHtml({
            subtitle: 'Unpaid Members Report',
            meta: [
                ['Convocation', data.convocation],
                ['Report Period', periodTitle],
                ['Collector', data.collector],
                ['Generated', data.generated],
                ['Unpaid Count', data.unpaid_count ?? (data.unpaid || []).length],
            ],
            blocks: this._monthlyUnpaidOnlyBlocks(data),
            footerLeft: `REPORTED BY ${(data.collector || 'COLLECTOR').toUpperCase()}`,
            footerRight: `${data.unpaid_count ?? (data.unpaid || []).length} unpaid member(s)`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _monthlyUnpaidRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const sectionsHtml = data.monthSections.map((section) => {
            const blocks = this._monthlyUnpaidOnlyBlocks(section);
            const blocksHtml = blocks.map((b) => {
                const headers = b.headers || [];
                const tableClass = b.tableClass ? ` ${b.tableClass}` : '';
                return `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>${b.title}</h4>
                    <span class="report-badge ${b.badgeClass}">${b.badge}</span>
                </div>
                <table class="report-table${tableClass}">
                    <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${b.rows}</tbody>
                </table>
            </div>`;
            }).join('');
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">${this._esc(data.convocation)} — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Unpaid</div><div class="val">${section.unpaid_count}</div></div>
                </div>
                ${blocksHtml}
            </section>`;
        }).join('');

        const totalUnpaid = data.monthSections.reduce((sum, s) => sum + (s.unpaid_count || 0), 0);
        const collectorName = (data.collector || 'COLLECTOR').toUpperCase();
        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Unpaid Members Report (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Convocation</div><div class="val">${this._esc(data.convocation)}</div></div>
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Collector</div><div class="val">${this._esc(data.collector)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Total Unpaid</div><div class="val">${totalUnpaid}</div></div>
            </div>
            ${sectionsHtml}
            ${this._footerBarHtml(
                `REPORTED BY ${collectorName}`,
                `Total Unpaid (selected period) = ${totalUnpaid}`,
                'report-footer-bar--grand'
            )}
        </div>`;
    },

    _dufcadUnpaidBlockHtml(dufcad) {
        const unpaid = dufcad.unpaid || [];
        const rows = this._dufcadUnpaidRows(unpaid)
            || '<tr><td colspan="5" class="report-empty">All members paid.</td></tr>';
        return `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>${this._esc(dufcad.name)} — Unpaid Members</h4>
                    <span class="report-badge report-badge--unpaid">${unpaid.length} unpaid</span>
                </div>
                <table class="report-table">
                    <thead><tr>
                        <th>Member</th><th>ID</th><th>Phone</th><th>Period</th><th>Status</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    },

    _unpaidAllDufcadsRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const sectionsHtml = (data.monthSections || []).map((monthSection) => {
            const dufcadBlocks = (monthSection.dufcads || [])
                .map((d) => this._dufcadUnpaidBlockHtml(d))
                .join('');
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">All Dufcads — ${this._esc(monthSection.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(monthSection.periodLabel)}</div></div>
                    <div><div class="lbl">Unpaid (all dufcads)</div><div class="val">${monthSection.grand_unpaid ?? 0}</div></div>
                </div>
                ${dufcadBlocks || '<p class="report-empty">No unpaid members this month.</p>'}
            </section>`;
        }).join('');

        const totalUnpaid = data.grand_unpaid ?? (data.monthSections || []).reduce(
            (sum, m) => sum + (m.grand_unpaid || 0),
            0,
        );
        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>HSF All (DUFCAD) PAYMENT REPORT — Unpaid Only</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${(data.monthSections || []).length}</div></div>
                <div><div class="lbl">Total Unpaid</div><div class="val">${totalUnpaid}</div></div>
            </div>
            ${sectionsHtml}
            ${this._footerBarHtml(
                'HSF All (DUFCAD) PAYMENT REPORT',
                `Total Unpaid (selected period) = ${totalUnpaid}`,
                'report-footer-bar--grand'
            )}
        </div>`;
    },

    showUnpaidAllDufcads(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        title.textContent = `Unpaid by Dufcad — ${period}`;
        this._lastPrintUrl = null;

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._unpaidAllDufcadsRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        this.showDufcadMemberReport({ ...data, focus: 'unpaid' });
    },

    _monthlyTableBlocks(data) {
        const monthlyHeaders = ['Member Name', 'Month', 'ID', 'Phone', 'Amount', 'Status'];
        const tableClass = 'report-table--payment-members';
        const paidRows = (data.paid || []).map(s => `
            <tr class="row-paid">
                <td><strong>${this._esc(s.name)}</strong></td>
                <td>${this._esc(s.month)}</td>
                <td>${this._esc(s.id)}</td>
                <td>${this._esc(s.phone)}</td>
                <td class="amt">${this._esc(s.amount)}</td>
                <td><span class="status-tag status-tag--paid">(paid)</span></td>
            </tr>`).join('') || '<tr><td colspan="6" class="report-empty">No paid members this month.</td></tr>';

        const unpaidRows = (data.unpaid || []).map(s => `
            <tr class="row-unpaid">
                <td><strong>${this._esc(s.name)}</strong></td>
                <td>${this._esc(s.month)}</td>
                <td>${this._esc(s.id)}</td>
                <td>${this._esc(s.phone)}</td>
                <td class="unpaid-txt">-</td>
                <td><span class="status-tag status-tag--unpaid">(unpaid)</span></td>
            </tr>`).join('') || '<tr><td colspan="6" class="report-empty">All members paid — hambalyo!</td></tr>';

        return {
            monthlyHeaders,
            tableClass,
            blocks: [
                { title: 'Paid Members', badge: `${data.paid_count} paid`, badgeClass: 'report-badge--paid', rows: paidRows, headers: monthlyHeaders, tableClass },
                { title: 'Unpaid Members', badge: `${data.unpaid_count} unpaid`, badgeClass: 'report-badge--unpaid', rows: unpaidRows, headers: monthlyHeaders, tableClass },
            ],
        };
    },

    _monthlySheetHtml(data, periodTitle) {
        const { blocks } = this._monthlyTableBlocks(data);
        return this._sheetHtml({
            subtitle: 'Monthly Payment Collection Report',
            meta: [
                ['Convocation', data.convocation],
                ['Report Period', periodTitle],
                ['Collector', data.collector],
                ['Generated', data.generated],
                ['Total Members', data.total_students],
                ['Paid / Unpaid', `${data.paid_count} / ${data.unpaid_count}`],
            ],
            blocks,
            footerLeft: `REPORTED BY ${(data.collector || 'COLLECTOR').toUpperCase()}`,
            footerRight: `Total Collected = $${Number(data.total_collected || 0).toFixed(2)}`,
        });
    },

    _monthlyRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const sectionsHtml = data.monthSections.map((section) => {
            const { blocks } = this._monthlyTableBlocks(section);
            const blocksHtml = blocks.map((b) => {
                const headers = b.headers || [];
                const tableClass = b.tableClass ? ` ${b.tableClass}` : '';
                return `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>${b.title}</h4>
                    <span class="report-badge ${b.badgeClass}">${b.badge}</span>
                </div>
                <table class="report-table${tableClass}">
                    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${b.rows}</tbody>
                </table>
            </div>`;
            }).join('');
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">${this._esc(data.convocation)} — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Total Members</div><div class="val">${section.total_students ?? '—'}</div></div>
                    <div><div class="lbl">Paid / Unpaid</div><div class="val">${section.paid_count} / ${section.unpaid_count}</div></div>
                    <div><div class="lbl">Collected</div><div class="val">$${Number(section.total_collected || 0).toFixed(2)}</div></div>
                </div>
                ${blocksHtml}
                ${this._footerBarHtml(
                    `REPORTED BY ${(section.collector || data.collector || 'COLLECTOR').toUpperCase()}`,
                    `Total Collected = $${Number(section.total_collected || 0).toFixed(2)}`,
                    'report-footer-bar--month'
                )}
            </section>`;
        }).join('');

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Payment Collection Report (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Convocation</div><div class="val">${this._esc(data.convocation)}</div></div>
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Collector</div><div class="val">${this._esc(data.collector)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${data.monthSections.length}</div></div>
            </div>
            ${sectionsHtml}
            ${this._footerBarHtml(
                `REPORTED BY ${(data.collector || 'COLLECTOR').toUpperCase()}`,
                `Total Collected (All Months) = $${Number(data.total_collected || 0).toFixed(2)}`,
                'report-footer-bar--grand'
            )}
        </div>`;
    },

    _footerBarHtml(footerLeft, footerRight, extraClass = '') {
        const cls = extraClass ? `report-footer-bar ${extraClass}` : 'report-footer-bar';
        return `
            <div class="${cls}">
                <div><strong>${footerLeft}</strong></div>
                <div class="total">${footerRight}</div>
            </div>`;
    },

    showAllConvocations(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const periodTitle = data.periodLabel || (data.year ? `${data.month} ${data.year}` : data.month);
        title.textContent = `All Convocations — ${periodTitle}`;
        const printParams = { month: data.month, year: data.year };
        if (data.admin_name) printParams.admin = data.admin_name;
        this._lastPrintUrl = data.isRange ? null : this._printUrl('all-convocations-summary', printParams);

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._allConvocationsRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        body.innerHTML = this._allConvocationsSheetHtml(data, periodTitle);

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _allConvocationsTableRows(convocations) {
        return (convocations || []).map(r => `
            <tr>
                <td><strong>${this._esc(r.name)}</strong></td>
                <td>${r.students}</td>
                <td class="amt">${r.paid}</td>
                <td class="unpaid-txt">${r.unpaid}</td>
                <td class="amt">$${Number(r.total || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="report-empty">No convocations found.</td></tr>';
    },

    _allConvocationsTableBlock(convocations) {
        const rows = this._allConvocationsTableRows(convocations);
        return `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>By Convocation</h4>
                    <span class="report-badge report-badge--paid">${(convocations || []).length} dufcad</span>
                </div>
                <table class="report-table report-table--convocation-summary">
                    <thead>
                        <tr>
                            <th>Convocation</th>
                            <th>Members</th>
                            <th>Paid</th>
                            <th>Unpaid</th>
                            <th>Collected</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    },

    _allConvocationsSheetHtml(data, periodTitle) {
        return this._sheetHtml({
            subtitle: 'All Convocations — Payment Summary',
            meta: [
                ['Report Period', periodTitle],
                ['Generated', data.generated],
                ['Convocations', (data.convocations || []).length],
                ['Total Members', data.grand_students],
                ['Paid / Unpaid', `${data.grand_paid} / ${data.grand_unpaid}`],
                ['Grand Total', `$${Number(data.grand_total || 0).toFixed(2)}`],
            ],
            blocks: [{
                title: 'By Convocation',
                badge: `${(data.convocations || []).length} dufcad`,
                badgeClass: 'report-badge--paid',
                rows: this._allConvocationsTableRows(data.convocations),
                headers: ['Convocation', 'Members', 'Paid', 'Unpaid', 'Collected'],
                tableClass: 'report-table--convocation-summary',
            }],
            footerLeft: `HSF PAYMENT ADMIN : ${data.admin_name || 'Admin'}`,
            footerRight: `Total Collected (All) = $${Number(data.grand_total || 0).toFixed(2)}`,
        });
    },

    _allConvocationsRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const adminLabel = data.admin_name || 'Admin';
        const sectionsHtml = data.monthSections.map((section) => `
            <section class="report-month-section">
                <h3 class="report-month-section-title">All Convocations — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Total Members</div><div class="val">${section.grand_students ?? '—'}</div></div>
                    <div><div class="lbl">Paid / Unpaid</div><div class="val">${section.grand_paid} / ${section.grand_unpaid}</div></div>
                    <div><div class="lbl">Collected</div><div class="val">$${Number(section.grand_total || 0).toFixed(2)}</div></div>
                </div>
                ${this._allConvocationsTableBlock(section.convocations)}
                ${this._footerBarHtml(
                    `HSF PAYMENT ADMIN : ${adminLabel}`,
                    `Total Collected = $${Number(section.grand_total || 0).toFixed(2)}`,
                    'report-footer-bar--month'
                )}
            </section>`).join('');

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>All Convocations — Payment Summary (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${data.monthSections.length}</div></div>
                <div><div class="lbl">Convocations</div><div class="val">${(data.convocations || []).length}</div></div>
                <div><div class="lbl">Grand Total</div><div class="val">$${Number(data.grand_total || 0).toFixed(2)}</div></div>
            </div>
            ${sectionsHtml}
            ${this._footerBarHtml(
                `HSF PAYMENT ADMIN : ${adminLabel}`,
                `Total Collected (All Months) = $${Number(data.grand_total || 0).toFixed(2)}`,
                'report-footer-bar--grand'
            )}
        </div>`;
    },

    _fundEntryRows(entries) {
        return (entries || []).map((e) => `
            <tr>
                <td>${this._esc(typeof formatFundEntryDate === 'function' ? formatFundEntryDate(e) : `${e.month} ${e.year}`)}</td>
                <td>${this._esc(e.description || '—')}</td>
                <td class="amt">$${Number(e.amount || 0).toFixed(2)}</td>
            </tr>`).join('')
            || '<tr><td colspan="3" class="report-empty">No support entries for this period.</td></tr>';
    },

    _expenseRows(expenses) {
        return (expenses || []).map((e) => `
            <tr>
                <td>${this._esc(typeof formatExpenseDate === 'function' ? formatExpenseDate(e) : `${e.month} ${e.year}`)}</td>
                <td>${this._esc(e.description)}</td>
                <td class="amt">$${Number(e.amount || 0).toFixed(2)}</td>
            </tr>`).join('')
            || '<tr><td colspan="3" class="report-empty">No expenses for this period.</td></tr>';
    },

    _fundEntriesRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const sectionsHtml = data.monthSections.map((section) => {
            const rows = this._fundEntryRows(section.entries);
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">Support &amp; Contributions — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Entries</div><div class="val">${section.count ?? 0}</div></div>
                    <div><div class="lbl">Total Received</div><div class="val">$${Number(section.total || 0).toFixed(2)}</div></div>
                </div>
                <div class="report-block">
                    <div class="report-block-head">
                        <h4>Recorded Support</h4>
                        <span class="report-badge report-badge--paid">${section.count || 0} entries</span>
                    </div>
                    <table class="report-table">
                        <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                ${this._footerBarHtml(
                    'HSF SUPPORT & CONTRIBUTIONS',
                    `Total Received = $${Number(section.total || 0).toFixed(2)}`,
                    'report-footer-bar--month'
                )}
            </section>`;
        }).join('');

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Support &amp; Contributions (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${data.monthSections.length}</div></div>
                <div><div class="lbl">Total Entries</div><div class="val">${data.count ?? 0}</div></div>
                <div><div class="lbl">Grand Total</div><div class="val">$${Number(data.total || 0).toFixed(2)}</div></div>
            </div>
            ${sectionsHtml}
            ${this._footerBarHtml(
                'HSF SUPPORT & CONTRIBUTIONS',
                `Total Received (All Months) = $${Number(data.total || 0).toFixed(2)}`,
                'report-footer-bar--grand'
            )}
        </div>`;
    },

    _expensesRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const sectionsHtml = data.monthSections.map((section) => {
            const rows = this._expenseRows(section.expenses);
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">Expense Report — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Entries</div><div class="val">${section.count ?? 0}</div></div>
                    <div><div class="lbl">Total Spent</div><div class="val">$${Number(section.total || 0).toFixed(2)}</div></div>
                </div>
                <div class="report-block">
                    <div class="report-block-head">
                        <h4>Recorded Expenses</h4>
                        <span class="report-badge report-badge--unpaid">${section.count || 0} entries</span>
                    </div>
                    <table class="report-table">
                        <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                ${this._footerBarHtml(
                    'HSF EXPENSE REPORT',
                    `Total Expenses = $${Number(section.total || 0).toFixed(2)}`,
                    'report-footer-bar--month'
                )}
            </section>`;
        }).join('');

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Expense Report (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${data.monthSections.length}</div></div>
                <div><div class="lbl">Total Entries</div><div class="val">${data.count ?? 0}</div></div>
                <div><div class="lbl">Grand Total</div><div class="val">$${Number(data.total || 0).toFixed(2)}</div></div>
            </div>
            ${sectionsHtml}
            ${this._footerBarHtml(
                'HSF EXPENSE REPORT',
                `Total Expenses (All Months) = $${Number(data.total || 0).toFixed(2)}`,
                'report-footer-bar--grand'
            )}
        </div>`;
    },

    showFundEntries(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || (data.month && data.month !== 'All'
            ? (data.year ? `${data.month} ${data.year}` : data.month)
            : `Year ${data.year}`);
        title.textContent = `Support & Contributions — ${period}`;
        this._lastPrintUrl = data.isRange ? null : this._printUrl('fund-entries-report', {
            month: data.month && data.month !== 'All' ? data.month : '',
            year: data.year,
        });

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._fundEntriesRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        const rows = this._fundEntryRows(data.entries);

        body.innerHTML = this._sheetHtml({
            subtitle: 'Support & Contributions — External / Manual Money In',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Entries', data.count],
                ['Total Received', `$${Number(data.total || 0).toFixed(2)}`],
            ],
            blocks: [{
                title: 'Recorded Support',
                badge: `${data.count || 0} entries`,
                badgeClass: 'report-badge--paid',
                rows,
                headers: ['Date', 'Description', 'Amount'],
            }],
            footerLeft: 'HSF SUPPORT & CONTRIBUTIONS',
            footerRight: `Total Received = $${Number(data.total || 0).toFixed(2)}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showMeetingAttendance(data) {
        this._resetMeetingsPreviewMode();
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        title.textContent = `${data.topic} — ${data.date}`;
        this._lastPrintUrl = this._printUrl('meeting-attendance', {
            meeting_id: data.meeting_id,
        });

        const headers = ['Member Name', 'ID', 'Convocation', 'Phone', 'Status'];
        const rowHtml = (m, kind) => {
            const attended = kind === 'present';
            const excused = kind === 'excused';
            const rowClass = attended ? 'row-paid' : (excused ? 'row-excused' : 'row-unpaid');
            const tagClass = attended ? 'status-tag--paid' : (excused ? 'status-tag--excused' : 'status-tag--unpaid');
            const label = attended ? (m.status || 'Present') : (excused ? 'Absent (excused)' : (m.status || 'Absent'));
            return `
            <tr class="${rowClass}">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id)}</td>
                <td>${this._esc(m.convocation)}</td>
                <td>${this._esc(m.phone)}</td>
                <td><span class="status-tag ${tagClass}">${this._esc(label)}</span></td>
            </tr>`;
        };

        const attendedRows = (data.attended || []).map((m) => rowHtml(m, 'present')).join('')
            || '<tr><td colspan="5" class="report-empty">No attended members.</td></tr>';
        const missedRows = (data.missed || []).map((m) => rowHtml(m, 'absent')).join('')
            || '<tr><td colspan="5" class="report-empty">No absent members.</td></tr>';
        const excusedRows = (data.excused || []).map((m) => rowHtml(m, 'excused')).join('')
            || '<tr><td colspan="5" class="report-empty">No excused absences.</td></tr>';

        body.innerHTML = this._sheetHtml({
            subtitle: 'Single Meeting Attendance Report',
            meta: [
                ['Meeting', data.topic],
                ['Date', data.date],
                ['Place | Goobta', data.place],
                ['Presenter | Soo Jeediye', data.presenter],
                ['Convocation | Dufcad', data.convocation],
                ['Target Members', data.target_audience],
                ['Present / Absent / Excused', `${data.attended_count} / ${data.missed_count} / ${data.excused_count ?? 0}`],
                ['Generated', data.generated],
            ],
            blocks: [
                {
                    title: 'Present',
                    badge: `${data.attended_count} present`,
                    badgeClass: 'report-badge--paid',
                    rows: attendedRows,
                    headers,
                },
                {
                    title: 'Absent',
                    badge: `${data.missed_count} absent`,
                    badgeClass: 'report-badge--unpaid',
                    rows: missedRows,
                    headers,
                },
                {
                    title: 'Absent (Excused)',
                    badge: `${data.excused_count ?? 0} excused`,
                    badgeClass: 'report-badge--paid',
                    rows: excusedRows,
                    headers,
                },
            ],
            footerLeft: 'HSF MEETING ATTENDANCE REPORT',
            footerRight: `Total Expected = ${data.total} members`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _graduatedEmploymentFooterRight(data) {
        const total = data?.total ?? data?.graduated_count ?? 0;
        const working = data?.working_count ?? 0;
        const notWorking = data?.not_working_count ?? 0;
        return `Total Graduated = ${total} members · Working = ${working} · Not working = ${notWorking}`;
    },

    _graduatedEmploymentBlocks(data) {
        const headers = [
            'Member Name', 'ID', 'Convocation', 'University', 'Faculty',
            'Phone', 'Status', 'Place of Work', 'Job Role', 'Started',
        ];
        const rowHtml = (m, working) => `
            <tr class="${working ? 'row-paid' : 'row-unpaid'}">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id)}</td>
                <td>${this._esc(m.convocation)}</td>
                <td>${this._esc(m.university)}</td>
                <td>${this._esc(m.faculty)}</td>
                <td class="report-cell-phone">${this._esc(m.phone)}</td>
                <td class="report-cell-status"><span class="status-tag ${working ? 'status-tag--paid' : 'status-tag--unpaid'}">${this._esc(m.work_status)}</span></td>
                <td>${this._esc(m.work_place)}</td>
                <td>${this._esc(m.work_role)}</td>
                <td>${this._esc(m.work_started)}</td>
            </tr>`;

        const blocks = [];
        const filter = (data.status_filter || 'all').toLowerCase();
        if (filter === 'all' || filter === 'working') {
            blocks.push({
                title: 'Working',
                badge: `${data.working_count || 0} working`,
                badgeClass: 'report-badge--paid',
                rows: (data.working || []).map((m) => rowHtml(m, true)).join('')
                    || '<tr><td colspan="10" class="report-empty">No working members recorded.</td></tr>',
                headers,
            });
        }
        if (filter === 'all' || filter === 'not_working') {
            blocks.push({
                title: 'Not Working',
                badge: `${data.not_working_count || 0} not working`,
                badgeClass: 'report-badge--unpaid',
                rows: (data.not_working || []).map((m) => rowHtml(m, false)).join('')
                    || '<tr><td colspan="10" class="report-empty">No members marked as not working.</td></tr>',
                headers,
            });
        }
        return blocks;
    },

    _graduatedEmploymentBlocksHtml(blocks) {
        return blocks.map((b) => {
            const headers = b.headers || [];
            return `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>${b.title}</h4>
                    <span class="report-badge ${b.badgeClass}">${b.badge}</span>
                </div>
                <table class="report-table report-table--employment">
                    <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${b.rows}</tbody>
                </table>
            </div>`;
        }).join('');
    },

    _graduatedEmploymentRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const sectionsHtml = data.monthSections.map((section) => {
            const blocksHtml = this._graduatedEmploymentBlocksHtml(this._graduatedEmploymentBlocks(section));
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">Graduated Employment — ${this._esc(section.convocation)} — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Convocation</div><div class="val">${this._esc(section.convocation)}</div></div>
                    <div><div class="lbl">Total Graduated</div><div class="val">${section.graduated_count ?? section.total ?? 0}</div></div>
                    <div><div class="lbl">Working / Not Working</div><div class="val">${section.working_count ?? 0} / ${section.not_working_count ?? 0}</div></div>
                </div>
                ${blocksHtml}
                ${this._footerBarHtml(
                    'HSF GRADUATED EMPLOYMENT REPORT',
                    this._graduatedEmploymentFooterRight(section),
                    'report-footer-bar--month'
                )}
            </section>`;
        }).join('');

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Graduated Employment (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Convocation</div><div class="val">${this._esc(data.convocation || 'All Convocations')}</div></div>
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${data.monthSections.length}</div></div>
                <div><div class="lbl">Employment Filter</div><div class="val">${this._esc(data.status_label || 'All')}</div></div>
            </div>
            ${sectionsHtml}
        </div>`;
    },

    showGraduatedEmployment(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const periodTitle = data.periodLabel || data.period_label || 'Selected period';
        title.textContent = data.isRange && data.monthSections?.length
            ? `Graduated Employment — ${data.convocation} — ${periodTitle}`
            : `Graduated Employment — ${data.convocation}`;
        this._lastPrintUrl = data.isRange ? null : this._printUrl('graduated-employment', {
            convocation: data.convocation_filter || 'all',
            status: data.status_filter || 'all',
            ...(data.month_key ? { month_key: data.month_key } : {}),
            ...(data.month_from ? { month_from: data.month_from } : {}),
            ...(data.month_to ? { month_to: data.month_to } : {}),
        });

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._graduatedEmploymentRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        const blocks = this._graduatedEmploymentBlocks(data);

        body.innerHTML = this._sheetHtml({
            subtitle: 'Graduated Members — Employment Report',
            meta: [
                ['Convocation', data.convocation],
                ['Period', data.period_label || 'Current snapshot'],
                ['Employment', data.status_label],
                ['Total Graduated', data.graduated_count ?? data.total],
                ['Working / Not Working', `${data.working_count} / ${data.not_working_count}`],
                ['Generated', data.generated],
            ],
            blocks,
            footerLeft: 'HSF GRADUATED EMPLOYMENT REPORT',
            footerRight: this._graduatedEmploymentFooterRight(data),
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _dufcadPaidRows(members) {
        return (members || []).map((m) => `
            <tr class="row-paid">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id || '—')}</td>
                <td>${this._esc(m.phone || '—')}</td>
                <td>${this._esc(m.month || '—')}</td>
                <td class="amt">${this._esc(m.amount || '—')}</td>
            </tr>`).join('');
    },

    _dufcadUnpaidRows(members) {
        return (members || []).map((m) => `
            <tr class="row-unpaid">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id || '—')}</td>
                <td>${this._esc(m.phone || '—')}</td>
                <td>${this._esc(m.month || '—')}</td>
                <td><span class="status-tag status-tag--unpaid">(unpaid)</span></td>
            </tr>`).join('');
    },

    _buildDufcadReportBlocks(dufcadData, focus) {
        const dufcads = dufcadData?.dufcads || [];
        const blocks = [];
        const summaryRows = dufcads.map((d) => `
            <tr>
                <td><strong>${this._esc(d.name)}</strong></td>
                <td>${d.total_students ?? '—'}</td>
                <td class="amt">${d.paid_count ?? 0}</td>
                <td class="unpaid-txt">${d.unpaid_count ?? 0}</td>
                <td class="amt">$${Number(d.total_collected || 0).toFixed(2)}</td>
            </tr>`).join('');

        if (summaryRows && focus !== 'paid-only-list' && focus !== 'unpaid-only-list') {
            blocks.push({
                title: 'Summary by Dufcad',
                badge: `${dufcads.length} dufcad`,
                badgeClass: 'report-badge--paid',
                rows: summaryRows,
                headers: ['Dufcad', 'Members', 'Paid', 'Unpaid', 'Collected'],
            });
        }

        dufcads.forEach((d) => {
            if (focus === 'paid' || focus === 'all' || focus === 'paid-only-list') {
                const paid = d.paid || [];
                if (focus === 'paid' || focus === 'paid-only-list' || paid.length) {
                    blocks.push({
                        title: `${d.name} — Paid Members`,
                        badge: `${paid.length} paid`,
                        badgeClass: 'report-badge--paid',
                        rows: this._dufcadPaidRows(paid) || '<tr><td colspan="5" class="report-empty">No paid members.</td></tr>',
                        headers: ['Member', 'ID', 'Phone', 'Period', 'Amount'],
                    });
                }
            }
            if (focus === 'unpaid' || focus === 'all' || focus === 'unpaid-only-list') {
                const unpaid = d.unpaid || [];
                if (focus === 'unpaid' || focus === 'unpaid-only-list' || unpaid.length) {
                    blocks.push({
                        title: `${d.name} — Unpaid Members`,
                        badge: `${unpaid.length} unpaid`,
                        badgeClass: 'report-badge--unpaid',
                        rows: this._dufcadUnpaidRows(unpaid) || '<tr><td colspan="5" class="report-empty">All members paid.</td></tr>',
                        headers: ['Member', 'ID', 'Phone', 'Period', 'Status'],
                    });
                }
            }
        });
        return blocks;
    },

    showDufcadMemberReport(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        const focus = data.focus || 'all';
        const focusLabel = focus === 'paid' ? 'Paid by Dufcad' : focus === 'unpaid' ? 'Unpaid by Dufcad' : 'Paid & Unpaid by Dufcad';
        title.textContent = `${focusLabel} — ${period}`;
        this._lastPrintUrl = null;

        const blocks = this._buildDufcadReportBlocks(data, focus === 'paid' ? 'paid-only-list' : focus === 'unpaid' ? 'unpaid-only-list' : 'all');
        if (!blocks.length) {
            blocks.push({
                title: 'No data',
                badge: '0',
                badgeClass: 'report-badge--unpaid',
                rows: '<tr><td colspan="5" class="report-empty">No dufcad data for this period.</td></tr>',
                headers: ['Dufcad', 'Members', 'Paid', 'Unpaid', 'Collected'],
            });
        }

        body.innerHTML = this._sheetHtml({
            subtitle: focusLabel,
            meta: [
                ['Report Period', period],
                ['Generated', data.generated],
                ['Dufcad', (data.dufcads || []).length],
                ['Total Paid / Unpaid', `${data.grand_paid ?? 0} / ${data.grand_unpaid ?? 0}`],
            ],
            blocks,
            footerLeft: 'HSF All (DUFCAD) PAYMENT REPORT',
            footerRight: `Paid ${data.grand_paid ?? 0} · Unpaid ${data.grand_unpaid ?? 0}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showCollectionsSummary(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        title.textContent = `Collections — ${period}`;
        this._lastPrintUrl = null;

        const txnRows = (data.transactions || []).map(t => `
            <tr>
                <td>${this._esc(t.month && t.year ? `${t.month} ${t.year}` : (t.date || '—'))}</td>
                <td><strong>${this._esc(t.name || '—')}</strong><br><span class="sub">${this._esc(t.student_id || '')}</span></td>
                <td>${this._esc(t.convocation || '—')}</td>
                <td class="amt">$${Number(typeof parseTxnAmount === 'function' ? parseTxnAmount(t.amount) : parseFloat(String(t.amount || 0).replace(/[$,]/g, '')) || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="report-empty">No collections for this period.</td></tr>';

        body.innerHTML = this._sheetHtml({
            subtitle: 'Member Collections — Payment Report',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Payments', data.collectionCount || 0],
                ['Total Collected', `$${Number(data.totalCollected || 0).toFixed(2)}`],
            ],
            blocks: [{
                title: 'Recorded Collections',
                badge: `${data.collectionCount || 0} payments`,
                badgeClass: 'report-badge--paid',
                rows: txnRows,
                headers: ['Period', 'Member', 'Convocation', 'Amount'],
            }],
            footerLeft: 'HSF COLLECTIONS REPORT',
            footerRight: `Total Collected = $${Number(data.totalCollected || 0).toFixed(2)}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showDufcadPayments(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        const focus = data.focus || 'all';
        const focusLabel = focus === 'paid' ? 'Paid Members by Dufcad' : focus === 'unpaid' ? 'Unpaid Units by Dufcad' : 'Paid & Unpaid by Dufcad';
        title.textContent = `${focusLabel} — ${period}`;
        this._lastPrintUrl = data.isRange ? null : this._printUrl('all-convocations-summary', {
            month: data.month && data.month !== 'All' ? data.month : '',
            year: data.year,
        });

        const rows = (data.convocations || []).map(r => `
            <tr>
                <td><strong>${this._esc(r.name)}</strong></td>
                <td>${r.students}</td>
                <td class="amt">${r.paid}</td>
                <td class="unpaid-txt">${r.unpaid}</td>
                <td class="amt">$${Number(r.total || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="report-empty">No convocation data for this period.</td></tr>';

        body.innerHTML = this._sheetHtml({
            subtitle: focusLabel,
            meta: [
                ['Report Period', period],
                ['Generated', data.generated],
                ['Convocations', (data.convocations || []).length],
                ['Total Paid / Unpaid', `${data.grand_paid} / ${data.grand_unpaid}`],
                ['Grand Total', `$${Number(data.grand_total || 0).toFixed(2)}`],
            ],
            blocks: [{
                title: 'By Convocation (Dufcad)',
                badge: `${(data.convocations || []).length} dufcad`,
                badgeClass: focus === 'unpaid' ? 'report-badge--unpaid' : 'report-badge--paid',
                rows,
                headers: ['Convocation', 'Members', 'Paid', 'Unpaid', 'Collected'],
            }],
            footerLeft: 'HSF All (DUFCAD) PAYMENT REPORT',
            footerRight: `Total Collected = $${Number(data.grand_total || 0).toFixed(2)}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _dufcadAttendedRows(members) {
        return (members || []).map((m) => `
            <tr class="row-paid">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id || '—')}</td>
                <td>${this._esc(m.phone || '—')}</td>
                <td>${this._esc(m.meeting_date || '—')}<br><span class="sub">${this._esc(m.meeting_topic || '')}</span></td>
                <td>${this._esc(m.target_audience || '—')}</td>
                <td><span class="status-tag status-tag--paid">${this._esc(m.status || 'Present')}</span></td>
            </tr>`).join('');
    },

    _dufcadMissedRows(members) {
        return (members || []).map((m) => {
            const excused = m.is_excused || m.status === 'Absent (excused)';
            const tagClass = excused ? 'status-tag--excused' : 'status-tag--unpaid';
            return `
            <tr class="${excused ? 'row-excused' : 'row-unpaid'}">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id || '—')}</td>
                <td>${this._esc(m.phone || '—')}</td>
                <td>${this._esc(m.meeting_date || '—')}<br><span class="sub">${this._esc(m.meeting_topic || '')}</span></td>
                <td>${this._esc(m.target_audience || '—')}</td>
                <td><span class="status-tag ${tagClass}">${this._esc(m.status || 'Absent')}</span></td>
            </tr>`;
        }).join('');
    },

    _buildDufcadAttendanceBlocks(dufcadData, focus) {
        const dufcads = dufcadData?.dufcads || [];
        const blocks = [];
        const headers = ['Member', 'ID', 'Phone', 'Meeting', 'Target', 'Status'];

        const summaryRows = dufcads.map((d) => `
            <tr>
                <td><strong>${this._esc(d.name)}</strong></td>
                <td class="amt">${(d.attended || []).length}</td>
                <td class="unpaid-txt">${(d.missed || []).length}</td>
            </tr>`).join('');

        if (summaryRows && focus !== 'attended-only' && focus !== 'missed-only') {
            blocks.push({
                title: 'Summary by Dufcad',
                badge: `${dufcads.length} dufcad`,
                badgeClass: 'report-badge--paid',
                rows: summaryRows,
                headers: ['Dufcad', 'Attended', 'Missed'],
            });
        }

        dufcads.forEach((d) => {
            if (focus === 'attended' || focus === 'all' || focus === 'attended-only') {
                const attended = d.attended || [];
                if (focus === 'attended' || focus === 'attended-only' || attended.length) {
                    blocks.push({
                        title: `${d.name} — Attended`,
                        badge: `${attended.length} attended`,
                        badgeClass: 'report-badge--paid',
                        rows: this._dufcadAttendedRows(attended) || '<tr><td colspan="6" class="report-empty">No attended members.</td></tr>',
                        headers,
                    });
                }
            }
            if (focus === 'missed' || focus === 'all' || focus === 'missed-only') {
                const missed = d.missed || [];
                if (focus === 'missed' || focus === 'missed-only' || missed.length) {
                    blocks.push({
                        title: `${d.name} — Missed`,
                        badge: `${missed.length} missed`,
                        badgeClass: 'report-badge--unpaid',
                        rows: this._dufcadMissedRows(missed) || '<tr><td colspan="6" class="report-empty">No missed members.</td></tr>',
                        headers,
                    });
                }
            }
        });
        return blocks;
    },

    showMeetingsDufcadAttendanceReport(data) {
        this._resetMeetingsPreviewMode();
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        const focus = data.focus || 'all';
        const focusLabel = focus === 'attended' ? 'Attended by Dufcad' : focus === 'missed' ? 'Missed by Dufcad' : 'Attended & Missed by Dufcad';
        title.textContent = `${focusLabel} — ${period}`;
        this._lastPrintUrl = null;

        const blocks = this._buildDufcadAttendanceBlocks(data, focus === 'attended' ? 'attended-only' : focus === 'missed' ? 'missed-only' : 'all');

        body.innerHTML = this._sheetHtml({
            subtitle: focusLabel,
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Meetings', data.meeting_count ?? 0],
                ['Attended / Missed', `${data.grand_attended ?? 0} / ${data.grand_missed ?? 0}`],
            ],
            blocks: blocks.length ? blocks : [{
                title: 'No data',
                badge: '0',
                badgeClass: 'report-badge--unpaid',
                rows: '<tr><td colspan="3" class="report-empty">No attendance data for this period.</td></tr>',
                headers: ['Dufcad', 'Attended', 'Missed'],
            }],
            footerLeft: 'HSF MEETING ATTENDANCE BY DUFCAD',
            footerRight: `Attended ${data.grand_attended ?? 0} · Missed ${data.grand_missed ?? 0}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _meetingAttendanceMemberRows(members, kind) {
        const headers = ['Member Name', 'ID', 'Convocation', 'Phone', 'Status'];
        const rows = (members || []).map((m) => {
            const attended = kind === 'present';
            const excused = kind === 'excused';
            const rowClass = attended ? 'row-paid' : (excused ? 'row-excused' : 'row-unpaid');
            const tagClass = attended ? 'status-tag--paid' : (excused ? 'status-tag--excused' : 'status-tag--unpaid');
            const label = attended ? (m.status || 'Present') : (excused ? 'Absent (excused)' : (m.status || 'Absent'));
            return `
            <tr class="${rowClass}">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id)}</td>
                <td>${this._esc(m.convocation)}</td>
                <td>${this._esc(m.phone)}</td>
                <td><span class="status-tag ${tagClass}">${this._esc(label)}</span></td>
            </tr>`;
        }).join('');
        return { headers, rows: rows || `<tr><td colspan="5" class="report-empty">None recorded.</td></tr>` };
    },

    _meetingDetailSectionHtml(report) {
        if (!report) return '';
        const present = this._meetingAttendanceMemberRows(report.attended, 'present');
        const absent = this._meetingAttendanceMemberRows(report.missed, 'absent');
        const excused = this._meetingAttendanceMemberRows(report.excused, 'excused');
        const blockHtml = (b) => `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>${b.title}</h4>
                    <span class="report-badge ${b.badgeClass}">${b.badge}</span>
                </div>
                <table class="report-table">
                    <thead><tr>${b.headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${b.rows}</tbody>
                </table>
            </div>`;
        const blocks = [
            { title: 'Present', badge: `${report.attended_count} present`, badgeClass: 'report-badge--paid', ...present },
            { title: 'Absent', badge: `${report.missed_count} absent`, badgeClass: 'report-badge--unpaid', ...absent },
            { title: 'Absent (Excused)', badge: `${report.excused_count ?? 0} excused`, badgeClass: 'report-badge--paid', ...excused },
        ];
        return `
        <section class="report-meeting-section">
            <h3 class="report-month-section-title">${this._esc(report.topic)} — ${this._esc(report.date)}</h3>
            <div class="report-meta-grid report-meta-grid--compact">
                <div><div class="lbl">Presenter | Soo Jeediye</div><div class="val">${this._esc(report.presenter)}</div></div>
                <div><div class="lbl">Place | Goobta</div><div class="val">${this._esc(report.place)}</div></div>
                <div><div class="lbl">Convocation | Dufcad</div><div class="val">${this._esc(report.convocation)}</div></div>
                <div><div class="lbl">Target Members</div><div class="val">${this._esc(report.target_audience)}</div></div>
            </div>
            ${blocks.map(blockHtml).join('')}
        </section>`;
    },

    _meetingsOverviewTableRows(meetings) {
        return (meetings || []).map((m) => `
            <tr>
                <td>${this._esc(m.date || '—')}</td>
                <td><strong>${this._esc(m.topic || '—')}</strong></td>
                <td>${this._esc(m.presenter || '—')}</td>
                <td>${this._esc(m.place || '—')}</td>
                <td>${this._esc(m.convocation || 'All')}</td>
                <td>${this._esc(m.target_audience || 'Active members')}</td>
            </tr>`).join('');
    },

    _setMeetingsFiltersVisible(visible) {
        const bar = document.getElementById('meetings-report-filters');
        if (!bar) return;
        bar.classList.toggle('is-visible', !!visible);
        if (!visible) return;
        const focus = document.getElementById('meetingsReportFocus');
        const order = document.getElementById('meetingsReportOrder');
        const view = document.getElementById('meetingsReportView')?.value || 'overview';
        const showMissedControls = view === 'missed_attended';
        if (focus) focus.disabled = !showMissedControls;
        if (order) order.disabled = !showMissedControls;
    },

    _bindMeetingsReportFilters() {
        if (this._meetingsReportFiltersBound) return;
        const view = document.getElementById('meetingsReportView');
        const focus = document.getElementById('meetingsReportFocus');
        const order = document.getElementById('meetingsReportOrder');
        if (!view || !focus || !order) return;
        const rerender = () => {
            if (!this._meetingsReportData) return;
            this._renderMeetingsReportFromFilters();
        };
        view.addEventListener('change', () => {
            this._setMeetingsFiltersVisible(true);
            rerender();
        });
        focus.addEventListener('change', rerender);
        order.addEventListener('change', rerender);
        this._meetingsReportFiltersBound = true;
    },

    _filterMissedAttendedMembers(members, focus, order) {
        let list = [...(members || [])];
        if (focus === 'most_present') {
            list = list.filter((m) => Number(m.missed || 0) === 0);
        } else if (focus === 'most_absent') {
            list = list.filter((m) => Number(m.missed || 0) > 0);
            list.sort((a, b) => {
                const md = Number(b.missed || 0) - Number(a.missed || 0);
                if (md !== 0) return md;
                return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
            });
        }
        if (focus !== 'most_absent' || order === 'alpha') {
            if (focus !== 'most_absent') {
                list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
            }
        }
        if (order === 'dufcad' && focus !== 'most_absent') {
            list.sort((a, b) => {
                const dc = String(a.convocation || '').localeCompare(String(b.convocation || ''), undefined, { sensitivity: 'base' });
                if (dc !== 0) return dc;
                return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
            });
        }
        if (order === 'dufcad' && focus === 'most_absent') {
            list.sort((a, b) => {
                const dc = String(a.convocation || '').localeCompare(String(b.convocation || ''), undefined, { sensitivity: 'base' });
                if (dc !== 0) return dc;
                const md = Number(b.missed || 0) - Number(a.missed || 0);
                if (md !== 0) return md;
                return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
            });
        }
        return list;
    },

    _groupMembersByDufcad(members) {
        const map = new Map();
        (members || []).forEach((m) => {
            const key = (m.convocation || '—').trim() || '—';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(m);
        });
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
    },

    _missedAttendedMemberRows(members) {
        return (members || []).map((m, i) => `
            <tr class="${Number(m.missed || 0) > 0 ? 'row-unpaid' : 'row-paid'}">
                <td>${i + 1}</td>
                <td>${this._esc(m.id || '—')}</td>
                <td><strong>${this._esc(m.name || '—')}</strong></td>
                <td>${this._esc(m.convocation || '—')}</td>
                <td>${this._esc(m.phone || '—')}</td>
                <td class="${Number(m.missed || 0) > 0 ? 'unpaid-txt' : 'amt'}">${Number(m.missed || 0)}</td>
            </tr>`).join('');
    },

    _missedAttendedFocusLabel(focus) {
        if (focus === 'most_present') return 'Most present (unabsent — missed = 0)';
        if (focus === 'most_absent') return 'Most absent (highest missed first)';
        return 'All members with finalized meeting attendance';
    },

    _meetingsMissedAttendedSheetHtml(data, focus, order) {
        const logo = '../../img/logo.png';
        const period = data.periodLabel || 'Selected period';
        const filtered = this._filterMissedAttendedMembers(data.missedAttendedMembers || [], focus, order);
        const groups = this._groupMembersByDufcad(filtered);
        const headers = ['#', 'ID', 'Name', 'Dufcada', 'Phone', 'Missed'];
        const focusLabel = this._missedAttendedFocusLabel(focus);
        const orderLabel = order === 'dufcad' ? 'By dufcad, then name' : 'Alphabetical';

        const sections = groups.length
            ? groups.map(([dufcad, rows]) => {
                const titleSuffix = focus === 'most_absent'
                    ? '— Most absent'
                    : focus === 'most_present'
                        ? '— Most present (unabsent)'
                        : '— Members';
                return `
                <div class="report-block">
                    <div class="report-block-head">
                        <h4>${this._esc(dufcad)} ${titleSuffix}</h4>
                        <span class="report-badge ${focus === 'most_absent' ? 'report-badge--unpaid' : 'report-badge--paid'}">${rows.length} member(s)</span>
                    </div>
                    <table class="report-table report-table--cols-6">
                        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                        <tbody>${this._missedAttendedMemberRows(rows) || '<tr><td colspan="6" class="report-empty">No members.</td></tr>'}</tbody>
                    </table>
                </div>`;
            }).join('')
            : `<p class="report-empty" style="padding:1.25rem 28px;">No members match this filter for the selected period.</p>`;

        const presentCount = filtered.filter((m) => Number(m.missed || 0) === 0).length;
        const absentCount = filtered.filter((m) => Number(m.missed || 0) > 0).length;

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Missed / Attended Meetings Report</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(period)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Members Shown</div><div class="val">${filtered.length}</div></div>
                <div><div class="lbl">Unabsent / With Misses</div><div class="val">${presentCount} / ${absentCount}</div></div>
                <div><div class="lbl">Filter</div><div class="val">${this._esc(focusLabel)}</div></div>
                <div><div class="lbl">Order</div><div class="val">${this._esc(orderLabel)}</div></div>
            </div>
            <div class="report-block">
                <div class="report-block-head">
                    <h4>Missed / Attended — by Dufcad</h4>
                    <span class="report-badge report-badge--paid">${groups.length} dufcad</span>
                </div>
            </div>
            ${sections}
            ${this._footerBarHtml('HSF MISSED / ATTENDED REPORT', period, 'report-footer-bar--month')}
        </div>`;
    },

    _meetingsFullReportSheetHtml(data) {
        const logo = '../../img/logo.png';
        const period = data.periodLabel || 'Selected period';
        const monthSections = (data.monthSections || []).map((section) => {
            const rows = this._meetingsOverviewTableRows(section.meetings);
            const tableHtml = section.meeting_count
                ? `<table class="report-table">
                    <thead><tr><th>Date</th><th>Topic</th><th>Presenter</th><th>Place</th><th>Convocation</th><th>Target</th></tr></thead>
                    <tbody>${rows}</tbody>
                   </table>`
                : `<p class="report-empty" style="padding:1rem 0;margin:0;">No meetings this month.</p>`;
            return `
            <section class="report-month-section">
                <h3 class="report-month-section-title">${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Meetings</div><div class="val">${section.meeting_count}</div></div>
                </div>
                ${tableHtml}
            </section>`;
        }).join('');

        const meetingDetailsHtml = (data.meetingDetails || [])
            .map((item) => this._meetingDetailSectionHtml(item.report))
            .join('');

        const overviewMonthCount = (data.monthSections || []).length;
        const hasMeetings = Number(data.totalMeetings || 0) > 0 || (data.meetingDetails || []).length > 0;
        const overviewHtml = monthSections
            || (hasMeetings ? '' : `<p class="report-empty">No meetings in this period.</p>`);

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>Meetings & Attendance — Period Overview</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(period)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Total Meetings</div><div class="val">${data.totalMeetings ?? 0}</div></div>
                <div><div class="lbl">With Attendance</div><div class="val">${(data.meetingDetails || []).length}</div></div>
            </div>
            <div class="report-block">
                <div class="report-block-head">
                    <h4>Overview — by Month</h4>
                    <span class="report-badge report-badge--paid">${overviewMonthCount} month(s)</span>
                </div>
            </div>
            ${overviewHtml}
            ${meetingDetailsHtml || `<p class="report-empty" style="margin-top:1.5rem;">No meetings with finalized attendance in this period.</p>`}
            ${this._footerBarHtml('HSF MEETINGS REPORT', period, 'report-footer-bar--month')}
        </div>`;
    },

    _renderMeetingsReportFromFilters() {
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!body || !this._meetingsReportData) return;
        const view = document.getElementById('meetingsReportView')?.value || 'overview';
        const focus = document.getElementById('meetingsReportFocus')?.value || 'all';
        const order = document.getElementById('meetingsReportOrder')?.value || 'alpha';
        const period = this._meetingsReportData.periodLabel || 'Selected period';

        if (view === 'missed_attended') {
            if (title) title.textContent = `Missed / Attended — ${period}`;
            body.innerHTML = this._meetingsMissedAttendedSheetHtml(this._meetingsReportData, focus, order);
        } else {
            if (title) title.textContent = `Meetings Report — ${period}`;
            body.innerHTML = this._meetingsFullReportSheetHtml(this._meetingsReportData);
        }
        this._setMeetingsFiltersVisible(true);
        this._bindPrint();
    },

    showMeetingsFullReport(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        this._meetingsReportData = data;
        this._lastPrintUrl = null;
        this._bindMeetingsReportFilters();

        const viewEl = document.getElementById('meetingsReportView');
        if (viewEl) viewEl.value = 'overview';
        const focusEl = document.getElementById('meetingsReportFocus');
        if (focusEl) focusEl.value = 'all';
        const orderEl = document.getElementById('meetingsReportOrder');
        if (orderEl) orderEl.value = 'alpha';

        this._renderMeetingsReportFromFilters();
        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    showMeetingsPeriodSummary(data) {
        this._resetMeetingsPreviewMode();
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        title.textContent = `Meetings — ${period}`;
        this._lastPrintUrl = null;

        const students = data.students || [];
        const attendance = data.attendance || [];
        const meetings = (data.meetings || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const finalized = meetings.filter((m) => typeof isMeetingAttendanceFinalized === 'function' && isMeetingAttendanceFinalized(m));

        const rows = finalized.map((m) => {
            const rate = typeof getMeetingParticipationRate === 'function'
                ? (getMeetingParticipationRate(m, students, attendance) ?? 0)
                : 0;
            return `
            <tr>
                <td>${this._esc(m.date || '—')}</td>
                <td><strong>${this._esc(m.topic || '—')}</strong></td>
                <td>${this._esc(m.presenter || '—')}</td>
                <td>${this._esc(m.convocation || 'All')}</td>
                <td class="amt">${rate}%</td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="report-empty">No finalized meetings in this period.</td></tr>';

        body.innerHTML = this._sheetHtml({
            subtitle: 'Meetings Report — Period Summary',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Total Meetings', meetings.length],
                ['Finalized', finalized.length],
            ],
            blocks: [{
                title: 'Meetings in Period',
                badge: `${finalized.length} finalized`,
                badgeClass: 'report-badge--paid',
                rows,
                headers: ['Date', 'Topic', 'Presenter', 'Convocation', 'Attendance %'],
            }],
            footerLeft: 'HSF MEETINGS REPORT',
            footerRight: `${meetings.length} meetings in period`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showMeetingsAttendanceSummary(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        const students = data.students || [];
        const attendance = data.attendance || [];
        const meetings = (data.meetings || []).filter((m) => typeof isMeetingAttendanceFinalized === 'function' && isMeetingAttendanceFinalized(m));
        const rates = meetings.map((m) => (typeof getMeetingParticipationRate === 'function'
            ? getMeetingParticipationRate(m, students, attendance)
            : null)).filter((r) => r !== null);
        const avg = rates.length ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length) : 0;

        title.textContent = `Attendance Summary — ${period}`;
        this._lastPrintUrl = null;

        const rows = meetings.map((m) => {
            const rate = typeof getMeetingParticipationRate === 'function'
                ? (getMeetingParticipationRate(m, students, attendance) ?? 0)
                : 0;
            return `
            <tr>
                <td>${this._esc(m.date || '—')}</td>
                <td><strong>${this._esc(m.topic || '—')}</strong></td>
                <td class="amt">${rate}%</td>
            </tr>`;
        }).join('') || '<tr><td colspan="3" class="report-empty">No attendance data for this period.</td></tr>';

        body.innerHTML = this._sheetHtml({
            subtitle: 'Attendance Trends — Period Summary',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Meetings with attendance', meetings.length],
                ['Average attendance', `${avg}%`],
            ],
            blocks: [{
                title: 'Attendance by Meeting',
                badge: `${meetings.length} meetings`,
                badgeClass: 'report-badge--paid',
                rows,
                headers: ['Date', 'Topic', 'Attendance %'],
            }],
            footerLeft: 'HSF ATTENDANCE REPORT',
            footerRight: `Average = ${avg}%`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _buildFinanceSummaryBlocks(finance, period) {
        if (!finance) return [];
        const txnRows = (finance.transactions || []).map(t => `
            <tr>
                <td>${this._esc(t.month && t.year ? `${t.month} ${t.year}` : (t.date || '—'))}</td>
                <td><strong>${this._esc(t.name || '—')}</strong><br><span class="sub">${this._esc(t.student_id || '')}</span></td>
                <td>${this._esc(t.convocation || '—')}</td>
                <td class="amt">$${Number(typeof parseTxnAmount === 'function' ? parseTxnAmount(t.amount) : parseFloat(String(t.amount || 0).replace(/[$,]/g, '')) || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="report-empty">No member collections recorded.</td></tr>';

        const fundRows = (finance.fundEntries || []).map(e => `
            <tr>
                <td>${this._esc(typeof formatFundEntryDate === 'function' ? formatFundEntryDate(e) : `${e.month} ${e.year}`)}</td>
                <td>${this._esc(e.description || '—')}</td>
                <td class="amt">$${Number(e.amount || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="3" class="report-empty">No money-in entries recorded.</td></tr>';

        const expenseRows = (finance.expenses || []).map(e => `
            <tr>
                <td>${this._esc(typeof formatExpenseDate === 'function' ? formatExpenseDate(e) : `${e.month} ${e.year}`)}</td>
                <td>${this._esc(e.description || '—')}</td>
                <td class="amt">$${Number(e.amount || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="3" class="report-empty">No expenses recorded.</td></tr>';

        const dufcadBlocks = finance.dufcadMembers
            ? this._buildDufcadReportBlocks(finance.dufcadMembers, 'all')
            : [];

        return [
            ...dufcadBlocks,
            {
                title: `Member Collections (${period})`,
                badge: `${finance.collectionCount || 0} payments`,
                badgeClass: 'report-badge--paid',
                rows: txnRows,
                headers: ['Period', 'Member', 'Convocation', 'Amount'],
            },
            {
                title: 'Money In — Support & Contributions',
                badge: `${finance.moneyInCount || 0} entries`,
                badgeClass: 'report-badge--paid',
                rows: fundRows,
                headers: ['Date', 'Description', 'Amount'],
            },
            {
                title: 'Expenses',
                badge: `${finance.expenseCount || 0} entries`,
                badgeClass: 'report-badge--unpaid',
                rows: expenseRows,
                headers: ['Date', 'Description', 'Amount'],
            },
        ];
    },

    _buildEmploymentBlocks(data) {
        if (!data || data.error) return [];
        const headers = [
            'Member Name', 'ID', 'Convocation', 'University', 'Faculty',
            'Phone', 'Status', 'Place of Work', 'Job Role', 'Started',
        ];
        const rowHtml = (m, working) => `
            <tr class="${working ? 'row-paid' : 'row-unpaid'}">
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.id)}</td>
                <td>${this._esc(m.convocation)}</td>
                <td>${this._esc(m.university)}</td>
                <td>${this._esc(m.faculty)}</td>
                <td class="report-cell-phone">${this._esc(m.phone)}</td>
                <td class="report-cell-status"><span class="status-tag ${working ? 'status-tag--paid' : 'status-tag--unpaid'}">${this._esc(m.work_status)}</span></td>
                <td>${this._esc(m.work_place)}</td>
                <td>${this._esc(m.work_role)}</td>
                <td>${this._esc(m.work_started)}</td>
            </tr>`;
        const blocks = [];
        const filter = (data.status_filter || 'all').toLowerCase();
        if (filter === 'all' || filter === 'working') {
            blocks.push({
                title: 'Working',
                badge: `${data.working_count || 0} working`,
                badgeClass: 'report-badge--paid',
                rows: (data.working || []).map((m) => rowHtml(m, true)).join('')
                    || '<tr><td colspan="10" class="report-empty">No working members recorded.</td></tr>',
                headers,
            });
        }
        if (filter === 'all' || filter === 'not_working') {
            blocks.push({
                title: 'Not Working',
                badge: `${data.not_working_count || 0} not working`,
                badgeClass: 'report-badge--unpaid',
                rows: (data.not_working || []).map((m) => rowHtml(m, false)).join('')
                    || '<tr><td colspan="10" class="report-empty">No members marked as not working.</td></tr>',
                headers,
            });
        }
        return blocks;
    },

    _buildMeetingsExportBlocks(dufcadData) {
        if (!dufcadData) return [];
        const meetingRows = (dufcadData.meetings || []).map((m) => `
            <tr>
                <td>${this._esc(m.date || '—')}</td>
                <td><strong>${this._esc(m.topic || '—')}</strong></td>
                <td>${this._esc(m.presenter || '—')}</td>
                <td>${this._esc(m.convocation || '—')}</td>
                <td>${this._esc(m.target_audience || '—')}</td>
                <td class="amt">${m.attended_count ?? 0}</td>
                <td class="unpaid-txt">${m.absent_count ?? m.missed_count ?? 0}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="report-empty">No finalized meetings in this period.</td></tr>';

        return [
            {
                title: 'Meetings in Period',
                badge: `${dufcadData.meeting_count ?? 0} meetings`,
                badgeClass: 'report-badge--paid',
                rows: meetingRows,
                headers: ['Date', 'Topic', 'Presenter', 'Convocation', 'Target', 'Attended', 'Missed'],
            },
            ...this._buildDufcadAttendanceBlocks(dufcadData, 'all'),
        ];
    },

    _systemDashboardMetricRows(dash) {
        const dashMetric = (label, value) => `
            <tr><td><strong>${this._esc(label)}</strong></td><td>${this._esc(String(value ?? '—'))}</td></tr>`;
        return [
            dashMetric('Total Members', dash.total_members),
            dashMetric('Total Convocations', dash.total_convocations),
            dashMetric('Quran Contest ever made', dash.quran_contests),
            dashMetric('Summer Course ever made', dash.summer_programs),
            dashMetric('Total Meetings', dash.total_meetings),
            dashMetric('Graduated', dash.graduated),
            dashMetric('Working (employment)', dash.working),
            dashMetric('Not Working (employment)', dash.not_working),
            dashMetric('Active Members', dash.active_members),
        ].join('');
    },

    _systemReportRangeSheetHtml(data) {
        const logo = '../../img/logo.png';
        const grandMeetings = data.monthSections.reduce((sum, s) => sum + Number(s.total_meetings || 0), 0);
        const sectionsHtml = data.monthSections.map((section) => `
            <section class="report-month-section">
                <h3 class="report-month-section-title">System Report — ${this._esc(section.periodLabel)}</h3>
                <div class="report-meta-grid report-meta-grid--compact">
                    <div><div class="lbl">Report Period</div><div class="val">${this._esc(section.periodLabel)}</div></div>
                    <div><div class="lbl">Total Members</div><div class="val">${section.total_members ?? 0}</div></div>
                    <div><div class="lbl">Meetings This Month</div><div class="val">${section.total_meetings ?? 0}</div></div>
                    <div><div class="lbl">Active Members</div><div class="val">${section.active_members ?? 0}</div></div>
                </div>
                <div class="report-block">
                    <div class="report-block-head">
                        <h4>Dashboard — Key Metrics</h4>
                        <span class="report-badge report-badge--paid">Overview</span>
                    </div>
                    <table class="report-table">
                        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
                        <tbody>${this._systemDashboardMetricRows(section)}</tbody>
                    </table>
                </div>
                ${this._footerBarHtml(
                    'HSF SYSTEM REPORT',
                    section.periodLabel,
                    'report-footer-bar--month'
                )}
            </section>`).join('');

        return `
        <div class="report-sheet report-sheet--range">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>System Report (Month by Month)</p>
                </div>
            </div>
            <div class="report-meta-grid">
                <div><div class="lbl">Report Period</div><div class="val">${this._esc(data.periodLabel)}</div></div>
                <div><div class="lbl">Generated</div><div class="val">${this._esc(data.generated)}</div></div>
                <div><div class="lbl">Months</div><div class="val">${data.monthSections.length}</div></div>
                <div><div class="lbl">Total Meetings</div><div class="val">${grandMeetings}</div></div>
            </div>
            ${sectionsHtml}
        </div>`;
    },

    _membersListRows(members) {
        return (members || []).map((m) => `
            <tr>
                <td>${this._esc(m.cardNumber || '')}</td>
                <td><strong>${this._esc(m.name)}</strong></td>
                <td>${this._esc(m.university)}</td>
                <td>${this._esc(m.faculty)}</td>
                <td>${this._esc(m.phone)}</td>
            </tr>`).join('');
    },

    showMembersList(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        title.textContent = `Members List — ${data.statusFilter || 'Active'} — ${data.dufcadFilter || 'All Dufcads'}`;
        this._lastPrintUrl = null;

        const headers = ['Card Number', 'Name', 'University', 'Faculty', 'Phone'];
        const blocks = (data.sections || []).map((section) => ({
            title: section.year ? `${section.name} (${section.year})` : section.name,
            badge: `${section.count} members`,
            badgeClass: 'report-badge--paid',
            headers,
            rows: this._membersListRows(section.members)
                || '<tr><td colspan="5" class="report-empty">No members in this dufcad.</td></tr>',
        }));

        body.innerHTML = this._sheetHtml({
            subtitle: `${data.statusFilter || 'Active'} Members — Convocation Roster`,
            meta: [
                ['Status', data.statusFilter || 'Active'],
                ['Dufcad', data.dufcadFilter || 'All Dufcads'],
                ['Total Members', data.totalMembers ?? 0],
                ['Dufcads', (data.sections || []).length],
                ['Generated', data.generated],
            ],
            blocks,
            footerLeft: 'HSF MEMBERS LIST',
            footerRight: `Total Members = ${data.totalMembers ?? 0}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showWholeSystemReport(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'Selected period';
        const dash = data.dashboard || {};
        title.textContent = `System Report — ${period}`;
        this._lastPrintUrl = null;

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._systemReportRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        const dashboardBlock = {
            title: 'Dashboard — Key Metrics',
            badge: 'Overview',
            badgeClass: 'report-badge--paid',
            rows: this._systemDashboardMetricRows(dash),
            headers: ['Metric', 'Value'],
        };

        body.innerHTML = this._sheetHtml({
            subtitle: 'System Report — Organisation Overview',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Total Members', dash.total_members ?? 0],
                ['Total Convocations', dash.total_convocations ?? 0],
                ['Quran / Summer programs', `${dash.quran_contests ?? 0} / ${dash.summer_programs ?? 0}`],
                ['Total Meetings', dash.total_meetings ?? 0],
            ],
            blocks: [dashboardBlock],
            footerLeft: 'HSF SYSTEM REPORT',
            footerRight: period,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showFinanceSummary(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || 'All time (ever recorded)';
        title.textContent = `Finance Report — ${period}`;
        this._lastPrintUrl = null;

        const txnRows = (data.transactions || []).map(t => `
            <tr>
                <td>${this._esc(t.month && t.year ? `${t.month} ${t.year}` : (t.date || '—'))}</td>
                <td><strong>${this._esc(t.name || '—')}</strong><br><span class="sub">${this._esc(t.student_id || '')}</span></td>
                <td>${this._esc(t.convocation || '—')}</td>
                <td class="amt">$${Number(typeof parseTxnAmount === 'function' ? parseTxnAmount(t.amount) : parseFloat(String(t.amount || 0).replace(/[$,]/g, '')) || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="report-empty">No member collections recorded.</td></tr>';

        const fundRows = (data.fundEntries || []).map(e => `
            <tr>
                <td>${this._esc(typeof formatFundEntryDate === 'function' ? formatFundEntryDate(e) : `${e.month} ${e.year}`)}</td>
                <td>${this._esc(e.description || '—')}</td>
                <td class="amt">$${Number(e.amount || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="3" class="report-empty">No money-in entries recorded.</td></tr>';

        const expenseRows = (data.expenses || []).map(e => `
            <tr>
                <td>${this._esc(typeof formatExpenseDate === 'function' ? formatExpenseDate(e) : `${e.month} ${e.year}`)}</td>
                <td>${this._esc(e.description || '—')}</td>
                <td class="amt">$${Number(e.amount || 0).toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="3" class="report-empty">No expenses recorded.</td></tr>';

        const dufcadBlocks = data.dufcadMembers
            ? this._buildDufcadReportBlocks(data.dufcadMembers, 'all')
            : [];

        const blocks = [
            ...dufcadBlocks,
            {
                title: `Member Collections (${period})`,
                badge: `${data.collectionCount || 0} payments`,
                badgeClass: 'report-badge--paid',
                rows: txnRows,
                headers: ['Period', 'Member', 'Convocation', 'Amount'],
            },
            {
                title: 'Money In — Support & Contributions',
                badge: `${data.moneyInCount || 0} entries`,
                badgeClass: 'report-badge--paid',
                rows: fundRows,
                headers: ['Date', 'Description', 'Amount'],
            },
            {
                title: 'Expenses',
                badge: `${data.expenseCount || 0} entries`,
                badgeClass: 'report-badge--unpaid',
                rows: expenseRows,
                headers: ['Date', 'Description', 'Amount'],
            },
        ];

        const dufcadMeta = data.dufcadMembers
            ? [['Paid / Unpaid (Dufcad)', `${data.dufcadMembers.grand_paid ?? 0} / ${data.dufcadMembers.grand_unpaid ?? 0}`]]
            : [];

        body.innerHTML = this._sheetHtml({
            subtitle: 'Finance Summary — Collections, Money In, Expenses & Dufcad',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Total Collected', `$${Number(data.totalCollected || 0).toFixed(2)}`],
                ['Total Money In', `$${Number(data.totalMoneyIn || 0).toFixed(2)}`],
                ['Total Expenses', `$${Number(data.totalExpenses || 0).toFixed(2)}`],
                ['Net Balance', `$${Number(data.netBalance || 0).toFixed(2)}`],
                ...dufcadMeta,
                ['Collections / Money In / Expenses', `${data.collectionCount || 0} / ${data.moneyInCount || 0} / ${data.expenseCount || 0}`],
            ],
            blocks,
            footerLeft: `HSF FINANCE REPORT — ${period}`,
            footerRight: `Net Balance = $${Number(data.netBalance || 0).toFixed(2)}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    showExpenses(data) {
        const preview = document.getElementById('report-preview');
        const body = document.getElementById('report-preview-body');
        const title = document.getElementById('report-preview-title');
        if (!preview || !body) return;

        const period = data.periodLabel || (data.month && data.month !== 'All'
            ? (data.year ? `${data.month} ${data.year}` : data.month)
            : `Year ${data.year}`);
        title.textContent = `Expense Report — ${period}`;
        this._lastPrintUrl = data.isRange ? null : this._printUrl('expenses-report', {
            month: data.month && data.month !== 'All' ? data.month : '',
            year: data.year,
        });

        if (data.isRange && data.monthSections?.length) {
            body.innerHTML = this._expensesRangeSheetHtml(data);
            preview.style.display = 'block';
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this._bindPrint();
            return;
        }

        const rows = this._expenseRows(data.expenses);

        body.innerHTML = this._sheetHtml({
            subtitle: 'Expense Report — Payment Admin',
            meta: [
                ['Period', period],
                ['Generated', data.generated],
                ['Entries', data.count],
                ['Total Spent', `$${Number(data.total || 0).toFixed(2)}`],
            ],
            blocks: [{
                title: 'Recorded Expenses',
                badge: `${data.count || 0} entries`,
                badgeClass: 'report-badge--unpaid',
                rows,
                headers: ['Date', 'Description', 'Amount'],
            }],
            footerLeft: 'HSF EXPENSE REPORT',
            footerRight: `Total Expenses = $${Number(data.total || 0).toFixed(2)}`,
        });

        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._bindPrint();
    },

    _sheetHtml({ subtitle, meta, blocks, footerLeft, footerRight }) {
        const logo = '../../img/logo.png';
        const metaHtml = meta.map(([l, v]) => `
            <div><div class="lbl">${l}</div><div class="val">${this._esc(String(v))}</div></div>`).join('');

        const blocksHtml = blocks.map(b => {
            const headers = b.headers || ['Member Name', 'Month', 'ID', 'Phone', 'Status'];
            const tableClass = b.tableClass ? ` ${b.tableClass}` : '';
            return `
            <div class="report-block">
                <div class="report-block-head">
                    <h4>${b.title}</h4>
                    <span class="report-badge ${b.badgeClass}">${b.badge}</span>
                </div>
                <table class="report-table${tableClass}">
                    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${b.rows}</tbody>
                </table>
            </div>`;
        }).join('');

        return `
        <div class="report-sheet">
            <div class="report-sheet-header">
                <img src="${logo}" alt="HSF Logo">
                <div>
                    <h2>Naadiga Ardayda Deeqda Waxbarasho HSF</h2>
                    <p>${subtitle}</p>
                </div>
            </div>
            <div class="report-meta-grid">${metaHtml}</div>
            ${blocksHtml}
            ${this._footerBarHtml(footerLeft, footerRight)}
        </div>`;
    },

    _printUrl(path, params) {
        const base = (typeof API_BASE !== 'undefined' ? API_BASE : '/api').replace(/\/api\/?$/, '');
        const qs = new URLSearchParams(params).toString();
        return `${base}/api/reports/${path}?${qs}`;
    },

    _bindPrint() {
        if (this._previewExportBound || typeof ReportExport === 'undefined') return;
        const toggle = document.getElementById('payment-export-toggle')
            || document.getElementById('meeting-export-toggle');
        const menu = document.getElementById('payment-export-menu')
            || document.getElementById('meeting-export-menu');
        if (!toggle || !menu) return;

        ReportExport.initDropdown(toggle, menu);
        ReportExport.bindActions(menu, {
            targetSelector: '#report-preview-body .report-sheet',
            directPdf: true,
            filenameBase: () => {
                const title = document.getElementById('report-preview-title')?.textContent || 'Payment_Report';
                return title.replace(/[^\w\-]+/g, '_').slice(0, 80);
            },
        });
        this._previewExportBound = true;
    },

    _esc(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
};

import base64
import os
from datetime import datetime
from flask import Blueprint, request, Response, jsonify, current_app
from models import db, User, Transaction, Convocation, Expense, FundEntry, Meeting, Attendance
from .report_styles import REPORT_PRINT_BASE, REPORT_EXPORT_BAR, REPORT_EXPORT_SCRIPTS

bp = Blueprint('reports', __name__)

MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

# All paying dufcad members (same set as dashboard stats)
MEMBER_ROLES = ('Student', 'Main Leader', 'Leader', 'Payment Sub Admin', 'Payment Admin', 'Media Admin')


def _convocation_members(convocation):
    """All paying members in a dufcad (matches Payment Management list)."""
    return User.query.filter(
        db.func.lower(User.convocation) == convocation.lower(),
        User.role.in_(MEMBER_ROLES),
    ).order_by(User.name).all()


def _parse_month_year(month_arg, year_arg):
    month = (month_arg or '').strip()
    year = int(year_arg) if year_arg and str(year_arg).isdigit() else datetime.utcnow().year
    if not month and request.args.get('month_key'):
        parts = request.args.get('month_key', '').split('-')
        if len(parts) == 2:
            year = int(parts[0])
            idx = int(parts[1]) - 1
            if 0 <= idx < 12:
                month = MONTH_NAMES[idx]
    return month, year


def _logo_data_uri():
    candidates = [
        os.path.join(current_app.root_path, '..', 'portal', 'img', 'logo.svg'),
        os.path.join(current_app.root_path, 'portal', 'img', 'logo.svg'),
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, 'rb') as f:
                    raw = f.read()
                b64 = base64.b64encode(raw).decode('ascii')
                return f'data:image/svg+xml;base64,{b64}'
            except OSError:
                pass
    return request.url_root.rstrip('/') + '/portal/img/logo.svg'


def _student_row(s, month, year, paid_map):
    month_label = f'{month} {year}'
    phone = s.phone or '—'
    t = paid_map.get(s.id)
    if t:
        amt = str(t.amount or '$1')
        return f"""
        <tr class="row-paid">
          <td><strong>{s.name}</strong></td>
          <td>{month_label}</td>
          <td>{s.id}</td>
          <td>{phone}</td>
          <td class="paid">{amt}</td>
          <td><span class="status-tag status-tag--paid">(paid)</span></td>
        </tr>""", amt
    return f"""
        <tr class="row-unpaid">
          <td><strong>{s.name}</strong></td>
          <td>{month_label}</td>
          <td>{s.id}</td>
          <td>{phone}</td>
          <td class="unpaid">-</td>
          <td><span class="status-tag status-tag--unpaid">(unpaid)</span></td>
        </tr>""", None


def _monthly_report_data(convocation, month, year, collector='Collector'):
    students = _convocation_members(convocation)

    txns = Transaction.query.filter(
        db.func.lower(Transaction.convocation) == convocation.lower(),
        Transaction.month == month,
        Transaction.year == year,
    ).all()
    paid_statuses = {'paid', 'success'}
    paid_map = {
        t.student_id: t for t in txns
        if str(t.status or '').lower() in paid_statuses
    }

    paid_rows = ''
    unpaid_rows = ''
    total_collected = 0.0
    paid_list = []
    unpaid_list = []

    for s in students:
        row_html, amt = _student_row(s, month, year, paid_map)
        entry = {
            'id': s.id,
            'name': s.name,
            'phone': s.phone or '—',
            'month': f'{month} {year}',
        }
        if amt is not None:
            paid_rows += row_html
            paid_list.append({**entry, 'amount': str(amt)})
            try:
                total_collected += float(str(amt).replace('$', '').replace(',', ''))
            except ValueError:
                total_collected += 1.0
        else:
            unpaid_rows += row_html
            unpaid_list.append(entry)

    return {
        'convocation': convocation,
        'month': month,
        'year': year,
        'collector': collector,
        'generated': datetime.utcnow().strftime('%d %b %Y %H:%M UTC'),
        'total_students': len(students),
        'paid_count': len(paid_list),
        'unpaid_count': len(unpaid_list),
        'total_collected': round(total_collected, 2),
        'paid': paid_list,
        'unpaid': unpaid_list,
        'paid_rows_html': paid_rows,
        'unpaid_rows_html': unpaid_rows,
    }


@bp.route('/monthly-payments-data', methods=['GET'])
def monthly_payments_data():
    convocation = (request.args.get('convocation') or '').strip()
    collector = (request.args.get('collector') or 'Collector').strip()
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    if not convocation:
        return jsonify({'error': 'convocation is required'}), 400
    if not month:
        return jsonify({'error': 'month is required'}), 400
    return jsonify(_monthly_report_data(convocation, month, year, collector))


@bp.route('/all-convocations-data', methods=['GET'])
def all_convocations_data():
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    if not month:
        return jsonify({'error': 'month is required'}), 400
    convocations = Convocation.query.order_by(Convocation.name).all()
    rows = [_convocation_stats(c.name, month, year) for c in convocations]
    return jsonify({
        'month': month,
        'year': year,
        'generated': datetime.utcnow().strftime('%d %b %Y %H:%M UTC'),
        'convocations': rows,
        'grand_paid': sum(r['paid'] for r in rows),
        'grand_unpaid': sum(r['unpaid'] for r in rows),
        'grand_total': round(sum(r['total'] for r in rows), 2),
        'grand_students': sum(r['students'] for r in rows),
    })


@bp.route('/monthly-payments', methods=['GET'])
def monthly_payments_report():
    convocation = (request.args.get('convocation') or '').strip()
    collector = (request.args.get('collector') or 'Collector').strip()
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))

    if not convocation:
        return jsonify({'error': 'convocation is required'}), 400
    if not month:
        return jsonify({'error': 'month is required'}), 400

    data = _monthly_report_data(convocation, month, year, collector)
    paid_rows = data['paid_rows_html']
    unpaid_rows = data['unpaid_rows_html']
    total_collected = data['total_collected']
    paid_students = data['paid']
    unpaid_students = data['unpaid']
    students_count = data['total_students']

    generated = datetime.utcnow().strftime('%d %b %Y %H:%M UTC')
    logo_src = _logo_data_uri()

    def table_block(title, badge_class, badge_text, rows, empty_msg):
        body = rows or f'<tr><td colspan="6" class="empty">{empty_msg}</td></tr>'
        return f"""
    <section class="report-block">
      <div class="block-head {badge_class}">
        <h3>{title}</h3>
        <span class="badge">{badge_text}</span>
      </div>
      <table class="payment-members-table">
        <thead>
          <tr>
            <th>Member Name</th>
            <th>Month</th>
            <th>ID</th>
            <th>Phone</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </section>"""

    paid_section = table_block(
        'Paid Members',
        'head-paid',
        f'{len(paid_students)} paid',
        paid_rows,
        'No paid members this month.',
    )
    unpaid_section = table_block(
        'Unpaid Members',
        'head-unpaid',
        f'{len(unpaid_students)} unpaid',
        unpaid_rows,
        'All members paid — hambalyo!',
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Monthly Payment Report — {convocation}</title>
  <style>
    {REPORT_PRINT_BASE}
  </style>
</head>
<body>
  <div class="sheet">
    {REPORT_EXPORT_BAR}
    <div class="header">
      <img src="{logo_src}" alt="HSF Logo">
      <div>
        <h1>Naadiga Ardayda Deeqda Waxbarasho HSF</h1>
        <p>Monthly Payment Collection Report</p>
      </div>
    </div>
    <div class="meta">
      <div><div class="lbl">Convocation</div><div class="val">{convocation}</div></div>
      <div><div class="lbl">Report Month</div><div class="val">{month} {year}</div></div>
      <div><div class="lbl">Collector</div><div class="val">{collector}</div></div>
      <div><div class="lbl">Generated</div><div class="val">{generated}</div></div>
      <div><div class="lbl">Total Members</div><div class="val">{students_count}</div></div>
      <div><div class="lbl">Paid / Unpaid</div><div class="val">{data['paid_count']} / {data['unpaid_count']}</div></div>
    </div>
    {paid_section}
    {unpaid_section}
    <div class="footer">
      <div><strong>REPORTED BY {collector.upper()}</strong></div>
      <div class="total">Total Collected = ${total_collected:.2f}</div>
    </div>
  </div>
  {REPORT_EXPORT_SCRIPTS}
</body>
</html>"""
    return Response(html, mimetype='text/html')


def _convocation_stats(conv_name, month, year):
    students = _convocation_members(conv_name)
    txns = Transaction.query.filter(
        db.func.lower(Transaction.convocation) == conv_name.lower(),
        Transaction.month == month,
        Transaction.year == year,
    ).all()
    paid_statuses = {'paid', 'success'}
    paid_ids = {
        t.student_id for t in txns
        if str(t.status or '').lower() in paid_statuses
    }
    paid_count = sum(1 for s in students if s.id in paid_ids)
    unpaid_count = len(students) - paid_count
    total_collected = 0.0
    for t in txns:
        try:
            total_collected += float(str(t.amount or '1').replace('$', '').replace(',', ''))
        except ValueError:
            total_collected += 1.0
    return {
        'name': conv_name,
        'students': len(students),
        'paid': paid_count,
        'unpaid': unpaid_count,
        'total': total_collected,
    }


@bp.route('/all-convocations-summary', methods=['GET'])
def all_convocations_summary():
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    if not month:
        return jsonify({'error': 'month is required'}), 400

    convocations = Convocation.query.order_by(Convocation.name).all()
    rows = []
    grand_paid = 0
    grand_unpaid = 0
    grand_total = 0.0
    grand_students = 0

    for conv in convocations:
        stats = _convocation_stats(conv.name, month, year)
        rows.append(stats)
        grand_paid += stats['paid']
        grand_unpaid += stats['unpaid']
        grand_total += stats['total']
        grand_students += stats['students']

    generated = datetime.utcnow().strftime('%d %b %Y %H:%M UTC')
    logo_src = _logo_data_uri()
    admin_name = (request.args.get('admin') or 'Admin').strip() or 'Admin'

    table_rows = ''.join(
        f"""<tr>
          <td><strong>{r['name']}</strong></td>
          <td>{r['students']}</td>
          <td class="paid">{r['paid']}</td>
          <td class="unpaid">{r['unpaid']}</td>
          <td class="paid">${r['total']:.2f}</td>
        </tr>"""
        for r in rows
    ) or '<tr><td colspan="5" class="empty">No convocations found.</td></tr>'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>All Convocations Payment Summary — {month} {year}</title>
  <style>
    {REPORT_PRINT_BASE}
    table {{ margin: 0 34px 28px; width: calc(100% - 68px); }}
  </style>
</head>
<body>
  <div class="sheet">
    {REPORT_EXPORT_BAR}
    <div class="header">
      <img src="{logo_src}" alt="HSF Logo">
      <div>
        <h1>Naadiga Ardayda Deeqda Waxbarasho HSF</h1>
        <p>All Convocations — Payment Summary</p>
      </div>
    </div>
    <div class="meta">
      <div><div class="lbl">Report Month</div><div class="val">{month} {year}</div></div>
      <div><div class="lbl">Generated</div><div class="val">{generated}</div></div>
      <div><div class="lbl">Convocations</div><div class="val">{len(rows)}</div></div>
      <div><div class="lbl">Total Members</div><div class="val">{grand_students}</div></div>
      <div><div class="lbl">Paid / Unpaid</div><div class="val">{grand_paid} / {grand_unpaid}</div></div>
      <div><div class="lbl">Grand Total</div><div class="val">${grand_total:.2f}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Convocation</th>
          <th>Members</th>
          <th>Paid</th>
          <th>Unpaid</th>
          <th>Collected</th>
        </tr>
      </thead>
      <tbody>{table_rows}</tbody>
    </table>
    <div class="footer">
      <div><strong>HSF PAYMENT ADMIN : {admin_name}</strong></div>
      <div class="total">Total Collected (All) = ${grand_total:.2f}</div>
    </div>
  </div>
  {REPORT_EXPORT_SCRIPTS}
</body>
</html>"""
    return Response(html, mimetype='text/html')


def _format_expense_date(expense):
    if expense.expense_date:
        try:
            return datetime.strptime(expense.expense_date, '%Y-%m-%d').strftime('%d %b %Y')
        except ValueError:
            return expense.expense_date
    return f'{expense.month} {expense.year}'


def _expenses_for_period(month, year):
    q = Expense.query
    if month:
        q = q.filter(Expense.month == month)
    if year:
        q = q.filter(Expense.year == year)
    return q.order_by(Expense.id).all()


@bp.route('/expenses-data', methods=['GET'])
def expenses_data():
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    expenses = _expenses_for_period(month, year)
    rows = []
    total = 0.0
    for e in expenses:
        amt = float(e.amount or 0)
        total += amt
        rows.append({
            'id': e.id,
            'month': e.month,
            'year': e.year,
            'date': e.expense_date or '',
            'amount': amt,
            'description': e.description or '—',
        })
    return jsonify({
        'month': month or 'All',
        'year': year,
        'expenses': rows,
        'total': round(total, 2),
        'count': len(rows),
        'generated': datetime.utcnow().strftime('%d %b %Y %H:%M UTC'),
    })


@bp.route('/expenses-report', methods=['GET'])
def expenses_report():
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    expenses = _expenses_for_period(month, year)
    logo_src = _logo_data_uri()
    generated = datetime.utcnow().strftime('%d %b %Y %H:%M UTC')
    period_label = f'{month} {year}' if month else f'Year {year}' if year else 'All periods'

    total = 0.0
    table_rows = ''
    for e in expenses:
        amt = float(e.amount or 0)
        total += amt
        desc = (e.description or '—').replace('<', '&lt;')
        table_rows += f"""<tr>
          <td>{_format_expense_date(e)}</td>
          <td>{desc}</td>
          <td class="paid">${amt:.2f}</td>
        </tr>"""
    if not table_rows:
        table_rows = '<tr><td colspan="3" class="empty">No expenses recorded for this period.</td></tr>'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Expense Report — {period_label}</title>
  <style>
    {REPORT_PRINT_BASE}
    table {{ margin: 0 34px 28px; width: calc(100% - 68px); }}
  </style>
</head>
<body>
  <div class="sheet">
    {REPORT_EXPORT_BAR}
    <div class="header">
      <img src="{logo_src}" alt="HSF Logo">
      <div>
        <h1>Naadiga Ardayda Deeqda Waxbarasho HSF</h1>
        <p>Expense Report — Payment Admin</p>
      </div>
    </div>
    <div class="meta">
      <div><div class="lbl">Period</div><div class="val">{period_label}</div></div>
      <div><div class="lbl">Generated</div><div class="val">{generated}</div></div>
      <div><div class="lbl">Entries</div><div class="val">{len(expenses)}</div></div>
      <div><div class="lbl">Total Spent</div><div class="val">${total:.2f}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>{table_rows}</tbody>
    </table>
    <div class="footer">
      <div><strong>HSF EXPENSE REPORT</strong></div>
      <div class="total">Total Expenses = ${total:.2f}</div>
    </div>
  </div>
  {REPORT_EXPORT_SCRIPTS}
</body>
</html>"""
    return Response(html, mimetype='text/html')


def _format_fund_date(entry):
    if entry.entry_date:
        try:
            return datetime.strptime(entry.entry_date, '%Y-%m-%d').strftime('%d %b %Y')
        except ValueError:
            return entry.entry_date
    return f'{entry.month} {entry.year}'


def _fund_entries_for_period(month, year):
    q = FundEntry.query
    if month:
        q = q.filter(FundEntry.month == month)
    if year:
        q = q.filter(FundEntry.year == year)
    return q.order_by(FundEntry.id).all()


@bp.route('/fund-entries-data', methods=['GET'])
def fund_entries_data():
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    entries = _fund_entries_for_period(month, year)
    rows = []
    total = 0.0
    for e in entries:
        amt = float(e.amount or 0)
        total += amt
        rows.append({
            'id': e.id,
            'month': e.month,
            'year': e.year,
            'date': e.entry_date or '',
            'amount': amt,
            'source_type': e.source_type or 'Supported',
            'description': e.description or '—',
            'recorded_by': e.recorded_by or '',
        })
    return jsonify({
        'month': month or 'All',
        'year': year,
        'entries': rows,
        'total': round(total, 2),
        'count': len(rows),
        'generated': datetime.utcnow().strftime('%d %b %Y %H:%M UTC'),
    })


@bp.route('/fund-entries-report', methods=['GET'])
def fund_entries_report():
    month, year = _parse_month_year(request.args.get('month'), request.args.get('year'))
    entries = _fund_entries_for_period(month, year)
    logo_src = _logo_data_uri()
    generated = datetime.utcnow().strftime('%d %b %Y %H:%M UTC')
    period_label = f'{month} {year}' if month else f'Year {year}' if year else 'All periods'

    total = 0.0
    table_rows = ''
    for e in entries:
        amt = float(e.amount or 0)
        total += amt
        desc = (e.description or '—').replace('<', '&lt;')
        table_rows += f"""<tr>
          <td>{_format_fund_date(e)}</td>
          <td>{desc}</td>
          <td class="paid">${amt:.2f}</td>
        </tr>"""
    if not table_rows:
        table_rows = '<tr><td colspan="3" class="empty">No support entries for this period.</td></tr>'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Support & Contributions — {period_label}</title>
  <style>
    {REPORT_PRINT_BASE}
    table {{ margin: 0 34px 28px; width: calc(100% - 68px); }}
  </style>
</head>
<body>
  <div class="sheet">
    {REPORT_EXPORT_BAR}
    <div class="header">
      <img src="{logo_src}" alt="HSF Logo">
      <div>
        <h1>Naadiga Ardayda Deeqda Waxbarasho HSF</h1>
        <p>Support & Contributions Report</p>
      </div>
    </div>
    <div class="meta">
      <div><div class="lbl">Period</div><div class="val">{period_label}</div></div>
      <div><div class="lbl">Generated</div><div class="val">{generated}</div></div>
      <div><div class="lbl">Entries</div><div class="val">{len(entries)}</div></div>
      <div><div class="lbl">Total Received</div><div class="val">${total:.2f}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>{table_rows}</tbody>
    </table>
    <div class="footer">
      <div><strong>HSF SUPPORT & CONTRIBUTIONS</strong></div>
      <div class="total">Total Received = ${total:.2f}</div>
    </div>
  </div>
  {REPORT_EXPORT_SCRIPTS}
</body>
</html>"""
    return Response(html, mimetype='text/html')


def _parse_meeting_date(date_str):
    if not date_str:
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(str(date_str)[:10], fmt).date()
        except ValueError:
            continue
    return None


def _meeting_attendance_finalized(meet):
    return bool(meet and (meet.attendance_taken or (meet.participantsCount and meet.participantsCount > 0)))


def _meeting_applies_to_student(meet, student, attendance_rows):
    """Finalized meetings: member counts if they have a saved attendance row."""
    if not meet or not student or not _meeting_attendance_finalized(meet):
        return False
    return any(a.student_id == student.id for a in attendance_rows)


def _member_row_from_attendance(rec, student=None):
    is_excused = bool(rec and getattr(rec, 'is_excused', False))
    status_label = rec.status if rec else 'Absent'
    if is_excused and status_label not in ('Present', 'Late'):
        status_label = 'Absent (excused)'
    sid = rec.student_id if rec else ''
    if student:
        name = student.name
        phone = student.phone or '—'
        conv = student.convocation or '—'
    else:
        name = sid or 'Unknown member'
        phone = '—'
        conv = '—'
    return {
        'id': sid,
        'name': name,
        'phone': phone,
        'convocation': conv,
        'status': status_label,
        'is_excused': is_excused,
    }


def _build_meeting_attendance_payload(meeting_id):
    meet = db.session.get(Meeting, meeting_id)
    if not meet:
        return None, 'Meeting not found.'
    if not _meeting_attendance_finalized(meet):
        return None, 'Attendance has not been recorded for this meeting yet.'

    attendance_rows = Attendance.query.filter_by(meeting_id=meeting_id).all()
    student_ids = {a.student_id for a in attendance_rows}
    students = (
        User.hsf_members_query().filter(User.id.in_(student_ids)).all()
        if student_ids else []
    )
    student_map = {s.id: s for s in students}

    attended = []
    missed = []
    excused = []
    for rec in attendance_rows:
        row = _member_row_from_attendance(rec, student_map.get(rec.student_id))
        if rec.status in ('Present', 'Late'):
            attended.append(row)
        elif row['is_excused']:
            excused.append(row)
        else:
            missed.append(row)

    sort_key = lambda m: (m.get('name') or '').lower()
    attended.sort(key=sort_key)
    missed.sort(key=sort_key)
    excused.sort(key=sort_key)

    conv_label = meet.convocation if meet.convocation and meet.convocation != 'All' else 'All Convocations'
    audience = (meet.target_audience or 'active').lower()
    audience_label = 'Graduated members' if audience == 'graduated' else 'Active members'

    return {
        'meeting_id': meet.id,
        'topic': meet.topic,
        'date': meet.date,
        'place': meet.place or '—',
        'presenter': meet.presenter or '—',
        'convocation': conv_label,
        'target_audience': audience_label,
        'attended': attended,
        'missed': missed,
        'excused': excused,
        'attended_count': len(attended),
        'missed_count': len(missed),
        'excused_count': len(excused),
        'absent_count': len(missed) + len(excused),
        'total': len(attendance_rows),
        'generated': datetime.utcnow().strftime('%d %b %Y %H:%M UTC'),
    }, None


def _meeting_member_row_html(member, row_class):
    name = (member.get('name') or '').replace('<', '&lt;')
    mid = (member.get('id') or '').replace('<', '&lt;')
    phone = (member.get('phone') or '—').replace('<', '&lt;')
    conv = (member.get('convocation') or '—').replace('<', '&lt;')
    is_excused = bool(member.get('is_excused'))
    status = (member.get('status') or 'Absent').replace('<', '&lt;')
    if is_excused and status not in ('Present', 'Late', 'Absent (excused)'):
        status = 'Absent (excused)'
    if status in ('Present', 'Late'):
        tag_class = 'status-tag--paid'
    elif is_excused or status == 'Absent (excused)':
        tag_class = 'status-tag--excused'
    else:
        tag_class = 'status-tag--unpaid'
    return f"""<tr class="{row_class}">
      <td><strong>{name}</strong></td>
      <td>{mid}</td>
      <td>{conv}</td>
      <td>{phone}</td>
      <td><span class="status-tag {tag_class}">{status}</span></td>
    </tr>"""


@bp.route('/meeting-attendance-data', methods=['GET'])
def meeting_attendance_data():
    meeting_id = request.args.get('meeting_id', type=int)
    if not meeting_id:
        return jsonify({'error': 'meeting_id is required.'}), 400
    payload, err = _build_meeting_attendance_payload(meeting_id)
    if err:
        return jsonify({'error': err}), 404
    return jsonify(payload)


@bp.route('/meeting-attendance', methods=['GET'])
def meeting_attendance_report():
    meeting_id = request.args.get('meeting_id', type=int)
    if not meeting_id:
        return Response('meeting_id is required.', status=400)

    payload, err = _build_meeting_attendance_payload(meeting_id)
    if err:
        return Response(err, status=404)

    logo_src = _logo_data_uri()
    attended_rows = ''.join(
        _meeting_member_row_html(m, 'row-paid') for m in payload['attended']
    ) or '<tr><td colspan="5" class="empty">No attended members.</td></tr>'
    missed_rows = ''.join(
        _meeting_member_row_html(m, 'row-unpaid') for m in payload['missed']
    ) or '<tr><td colspan="5" class="empty">No absent members.</td></tr>'
    excused_rows = ''.join(
        _meeting_member_row_html(m, 'row-excused') for m in payload.get('excused', [])
    ) or '<tr><td colspan="5" class="empty">No excused absences.</td></tr>'
    excused_count = payload.get('excused_count', 0)

    topic = (payload['topic'] or '').replace('<', '&lt;')
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Meeting Attendance — {topic}</title>
  <style>
    {REPORT_PRINT_BASE}
    table {{ margin: 0 34px 28px; width: calc(100% - 68px); }}
    .section-title {{
      margin: 18px 34px 8px;
      font-size: 0.95rem;
      font-weight: 800;
      color: #1e4a6d;
      text-transform: uppercase;
    }}
  </style>
</head>
<body>
  <div class="sheet">
    {REPORT_EXPORT_BAR}
    <div class="header">
      <img src="{logo_src}" alt="HSF Logo">
      <div>
        <h1>Naadiga Ardayda Deeqda Waxbarasho HSF</h1>
        <p>Single Meeting Attendance Report</p>
      </div>
    </div>
    <div class="meta">
      <div><div class="lbl">Meeting</div><div class="val">{topic}</div></div>
      <div><div class="lbl">Date</div><div class="val">{payload['date']}</div></div>
      <div><div class="lbl">Place</div><div class="val">{payload['place']}</div></div>
      <div><div class="lbl">Presenter</div><div class="val">{payload['presenter']}</div></div>
      <div><div class="lbl">Convocation</div><div class="val">{payload['convocation']}</div></div>
      <div><div class="lbl">Audience</div><div class="val">{payload['target_audience']}</div></div>
      <div><div class="lbl">Present / Absent / Excused</div><div class="val">{payload['attended_count']} / {payload['missed_count']} / {excused_count}</div></div>
      <div><div class="lbl">Generated</div><div class="val">{payload['generated']}</div></div>
    </div>
    <div class="section-title">Attended ({payload['attended_count']})</div>
    <table>
      <thead>
        <tr>
          <th>Member Name</th>
          <th>ID</th>
          <th>Convocation</th>
          <th>Phone</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>{attended_rows}</tbody>
    </table>
    <div class="section-title">Absent ({payload['missed_count']})</div>
    <table>
      <thead>
        <tr>
          <th>Member Name</th>
          <th>ID</th>
          <th>Convocation</th>
          <th>Phone</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>{missed_rows}</tbody>
    </table>
    <div class="section-title">Absent (Excused) ({excused_count})</div>
    <table>
      <thead>
        <tr>
          <th>Member Name</th>
          <th>ID</th>
          <th>Convocation</th>
          <th>Phone</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>{excused_rows}</tbody>
    </table>
    <div class="footer">
      <div><strong>HSF MEETING ATTENDANCE REPORT</strong></div>
      <div class="total">Total Expected = {payload['total']} members</div>
    </div>
  </div>
  {REPORT_EXPORT_SCRIPTS}
</body>
</html>"""
    return Response(html, mimetype='text/html')


def _graduated_members_query(convocation=None):
    """Paying members marked as graduated (admin employment report)."""
    q = User.query.filter(
        User.isGraduated.is_(True),
        User.role.in_(MEMBER_ROLES),
    )
    if convocation and str(convocation).strip().lower() not in ('', 'all'):
        q = q.filter(db.func.lower(User.convocation) == convocation.strip().lower())
    return q.order_by(User.convocation, User.name).all()


def _parse_work_started_date(value):
    if not value or str(value).strip() in ('', '—', '-'):
        return None
    raw = str(value).strip()[:10]
    for fmt in ('%Y-%m-%d', '%Y-%m', '%d/%m/%Y'):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _resolve_employment_period(month_key=None, month_from=None, month_to=None):
    """Return list of (year, month) tuples for period filter, or None for snapshot."""
    months = []
    if month_from and month_to:
        try:
            start_y, start_m = [int(x) for x in month_from.split('-')[:2]]
            end_y, end_m = [int(x) for x in month_to.split('-')[:2]]
            y, m = start_y, start_m
            while (y < end_y) or (y == end_y and m <= end_m):
                months.append((y, m))
                m += 1
                if m > 12:
                    m = 1
                    y += 1
        except (ValueError, TypeError):
            months = []
    elif month_key:
        try:
            y, m = [int(x) for x in month_key.split('-')[:2]]
            months = [(y, m)]
        except (ValueError, TypeError):
            months = []

    return months or None


def _work_started_in_period(work_started, period_months):
    started = _parse_work_started_date(work_started)
    if not started or not period_months:
        return False
    return (started.year, started.month) in period_months


def _employment_member_row(student, working_in_view=None):
    works = working_in_view if working_in_view is not None else bool(student.has_works)
    return {
        'id': student.id,
        'name': student.name,
        'phone': student.phone or '—',
        'convocation': student.convocation or '—',
        'university': student.university or '—',
        'faculty': student.faculty or '—',
        'has_works': works,
        'work_status': 'Working' if works else 'Not working',
        'work_place': (student.work_place or '—') if works else '—',
        'work_role': (student.work_role or '—') if works else '—',
        'work_started': (student.work_started or '—') if works else '—',
    }


def _employment_period_label(period_months):
    if not period_months:
        return 'Current snapshot'
    if len(period_months) == 1:
        y, m = period_months[0]
        return f'{MONTH_NAMES[m - 1]} {y}'
    y1, m1 = period_months[0]
    y2, m2 = period_months[-1]
    return f'{MONTH_NAMES[m1 - 1]} {y1} – {MONTH_NAMES[m2 - 1]} {y2}'


def _build_graduated_employment_payload(convocation=None, status='all', month_key=None, month_from=None, month_to=None):
    status = (status or 'all').strip().lower()
    if status not in ('all', 'working', 'not_working'):
        status = 'all'

    period_months = _resolve_employment_period(month_key, month_from, month_to)
    students = _graduated_members_query(convocation)
    members = []
    working = []
    not_working = []

    for student in students:
        if period_months:
            in_period = _work_started_in_period(student.work_started, period_months)
            working_now = bool(student.has_works) and in_period
        else:
            working_now = bool(student.has_works)
        row = _employment_member_row(student, working_now)
        members.append(row)
        if working_now:
            working.append(row)
        else:
            not_working.append(row)

    if status == 'working':
        not_working = []
        members = working[:]
    elif status == 'not_working':
        working = []
        members = not_working[:]

    conv_label = 'All Convocations'
    if convocation and str(convocation).strip().lower() not in ('', 'all'):
        conv_label = convocation.strip()

    status_labels = {
        'all': 'All',
        'working': 'Working only',
        'not_working': 'Not working only',
    }

    return {
        'convocation': conv_label,
        'convocation_filter': (convocation or 'all').strip() or 'all',
        'status_filter': status,
        'status_label': status_labels[status],
        'period_label': _employment_period_label(period_months),
        'month_key': month_key or '',
        'month_from': month_from or '',
        'month_to': month_to or '',
        'working': working,
        'not_working': not_working,
        'working_count': len(working),
        'not_working_count': len(not_working),
        'total': len(students),
        'graduated_count': len(students),
        'generated': datetime.utcnow().strftime('%d %b %Y %H:%M UTC'),
    }


def _graduated_employment_row_html(member, working):
    name = (member.get('name') or '').replace('<', '&lt;')
    mid = (member.get('id') or '').replace('<', '&lt;')
    conv = (member.get('convocation') or '—').replace('<', '&lt;')
    uni = (member.get('university') or '—').replace('<', '&lt;')
    faculty = (member.get('faculty') or '—').replace('<', '&lt;')
    phone = (member.get('phone') or '—').replace('<', '&lt;')
    status = (member.get('work_status') or '').replace('<', '&lt;')
    place = (member.get('work_place') or '—').replace('<', '&lt;')
    role = (member.get('work_role') or '—').replace('<', '&lt;')
    started = (member.get('work_started') or '—').replace('<', '&lt;')
    row_class = 'row-paid' if working else 'row-unpaid'
    tag_class = 'status-tag--paid' if working else 'status-tag--unpaid'
    return f"""<tr class="{row_class}">
      <td><strong>{name}</strong></td>
      <td>{mid}</td>
      <td>{conv}</td>
      <td>{uni}</td>
      <td>{faculty}</td>
      <td class="report-cell-phone">{phone}</td>
      <td class="report-cell-status"><span class="status-tag {tag_class}">{status}</span></td>
      <td>{place}</td>
      <td>{role}</td>
      <td>{started}</td>
    </tr>"""


@bp.route('/graduated-employment-data', methods=['GET'])
def graduated_employment_data():
    convocation = request.args.get('convocation')
    status = request.args.get('status', 'all')
    return jsonify(_build_graduated_employment_payload(
        convocation,
        status,
        month_key=request.args.get('month_key'),
        month_from=request.args.get('month_from'),
        month_to=request.args.get('month_to'),
    ))


@bp.route('/graduated-employment', methods=['GET'])
def graduated_employment_report():
    convocation = request.args.get('convocation')
    status = request.args.get('status', 'all')
    payload = _build_graduated_employment_payload(
        convocation,
        status,
        month_key=request.args.get('month_key'),
        month_from=request.args.get('month_from'),
        month_to=request.args.get('month_to'),
    )
    logo_src = _logo_data_uri()

    headers = (
        '<tr><th>Member Name</th><th>ID</th><th>Convocation</th>'
        '<th>University</th><th>Faculty</th><th>Phone</th>'
        '<th>Status</th><th>Place of Work</th><th>Job Role</th><th>Started</th></tr>'
    )

    def build_section(title, rows, working):
        body = ''.join(_graduated_employment_row_html(m, working) for m in rows)
        if not body:
            body = '<tr><td colspan="10" class="empty">No members in this group.</td></tr>'
        return f'<div class="section-title">{title} ({len(rows)})</div><table class="report-table report-table--employment"><thead>{headers}</thead><tbody>{body}</tbody></table>'

    sections = ''
    if payload['status_filter'] in ('all', 'working'):
        sections += build_section('Working', payload['working'], True)
    if payload['status_filter'] in ('all', 'not_working'):
        sections += build_section('Not Working', payload['not_working'], False)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Graduated Members Employment — {payload['convocation']}</title>
  <style>
    {REPORT_PRINT_BASE}
    table {{ margin: 0 34px 28px; width: calc(100% - 68px); font-size: 0.82rem; table-layout: fixed; }}
    .report-table--employment th:nth-child(6), .report-table--employment td:nth-child(6) {{ width: 13%; }}
    .report-table--employment th:nth-child(7), .report-table--employment td:nth-child(7) {{ width: 10%; }}
    .report-table--employment td {{ white-space: normal; overflow-wrap: break-word; vertical-align: top; }}
    .report-cell-phone {{ max-width: 0; word-break: break-all; overflow-wrap: anywhere; font-size: 0.82rem; line-height: 1.35; }}
    .report-cell-status {{ white-space: nowrap; }}
    .report-cell-status .status-tag {{ white-space: nowrap; }}
    .section-title {{
      margin: 18px 34px 8px;
      font-size: 0.95rem;
      font-weight: 800;
      color: #1e4a6d;
      text-transform: uppercase;
    }}
  </style>
</head>
<body>
  <div class="sheet">
    {REPORT_EXPORT_BAR}
    <div class="header">
      <img src="{logo_src}" alt="HSF Logo">
      <div>
        <h1>Naadiga Ardayda Deeqda Waxbarasho HSF</h1>
        <p>Graduated Members — Employment Report</p>
      </div>
    </div>
    <div class="meta">
      <div><div class="lbl">Convocation</div><div class="val">{payload['convocation']}</div></div>
      <div><div class="lbl">Period</div><div class="val">{payload['period_label']}</div></div>
      <div><div class="lbl">Employment</div><div class="val">{payload['status_label']}</div></div>
      <div><div class="lbl">Total Graduated</div><div class="val">{payload['graduated_count']}</div></div>
      <div><div class="lbl">Working / Not Working</div><div class="val">{payload['working_count']} / {payload['not_working_count']}</div></div>
      <div><div class="lbl">Generated</div><div class="val">{payload['generated']}</div></div>
    </div>
    {sections}
    <div class="footer">
      <div><strong>HSF GRADUATED EMPLOYMENT REPORT</strong></div>
      <div class="total">Total Graduated = {payload['total']} members · Working = {payload['working_count']} · Not working = {payload['not_working_count']}</div>
    </div>
  </div>
  {REPORT_EXPORT_SCRIPTS}
</body>
</html>"""
    return Response(html, mimetype='text/html')

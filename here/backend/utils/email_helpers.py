"""Safe email helpers — never raise to callers; log failures only."""
from datetime import datetime

def greet(name):
    n = (name or '').strip()
    return f'Dear {n},' if n else 'Dear Member,'


def club_official_name(app=None):
    default = 'Naadiga Ardayda Deeqda Waxbarasho HSF'
    if app is not None:
        return app.config.get('CLUB_OFFICIAL_NAME', default)
    try:
        from flask import current_app
        return current_app.config.get('CLUB_OFFICIAL_NAME', default)
    except Exception:
        return default


def club_official_email(app=None):
    """Public contact inbox only — not used as SMTP sender."""
    default = 'hsfstudentsclub@gmail.com'
    if app is not None:
        return app.config.get('CLUB_OFFICIAL_EMAIL', default)
    try:
        from flask import current_app
        return current_app.config.get('CLUB_OFFICIAL_EMAIL', default)
    except Exception:
        return default


def display_role(role):
    """User-facing role label — internal role values stay unchanged."""
    labels = {
        'Student': 'Member',
        'Main Leader': 'Main Member Leader',
        'Leader': 'Convocation Leader',
        'Payment Sub Admin': 'Payment Sub Admin',
        'Payment Admin': 'Payment Admin',
        'Media Admin': 'Media Admin',
    }
    return labels.get((role or '').strip(), (role or '').strip() or 'Member')


def email_closing(app=None, style='best'):
    """Standard email sign-off (single org line, no duplication)."""
    org = club_official_name(app)
    if style == 'warm':
        return f'Warm regards,\n{org}'
    if style == 'congrats':
        return f'Warm congratulations,\n{org}'
    return f'Best regards,\n{org}'


def club_mail_sender(app):
    addr = app.config.get('MAIL_DEFAULT_SENDER') or app.config.get('MAIL_USERNAME')
    if not addr:
        return None
    return (club_official_name(app), addr)


MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]


def _month_index(name):
    if not name:
        return None
    key = name.strip().capitalize()
    for i, m in enumerate(MONTH_NAMES):
        if m.lower() == key.lower() or m[:3].lower() == key[:3].lower():
            return i
    return None


def _meeting_attendance_finalized(meet):
    return bool(
        getattr(meet, 'attendance_taken', False)
        or (getattr(meet, 'participantsCount', 0) or 0) > 0
    )


def _parse_meeting_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(str(date_str)[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


def _meeting_applies_to_user(meet, user, attendance_keys):
    """Finalized meetings: member counts if they have a saved attendance row."""
    if not user or not meet or not meet.date:
        return False
    if not _meeting_attendance_finalized(meet):
        return False
    return (meet.id, user.id) in attendance_keys


def get_missed_meetings_count(user, meetings=None, attendance_records=None):
    """Count missed finalized meetings for active or graduated members."""
    from models import Meeting, Attendance

    if meetings is None:
        meetings = Meeting.query.all()
    if attendance_records is None:
        attendance_records = Attendance.query.all()

    attendance_keys = {(a.meeting_id, a.student_id) for a in attendance_records}
    attendance_map = {(a.meeting_id, a.student_id): a for a in attendance_records}
    today = datetime.utcnow().date()

    missed = 0
    for meet in meetings:
        if not _meeting_applies_to_user(meet, user, attendance_keys):
            continue
        m_date = _parse_meeting_date(meet.date)
        if not m_date or m_date > today:
            continue
        rec = attendance_map.get((meet.id, user.id))
        if not rec:
            continue
        if rec.status in ('Present', 'Late'):
            continue
        if getattr(rec, 'is_excused', False):
            continue
        missed += 1

    return missed


def get_unpaid_months_for_user(user, transactions=None):
    """Return list of 'Month Year' strings the student has not paid."""
    from models import Transaction

    if not user.created_at:
        return []

    if transactions is None:
        transactions = Transaction.query.filter_by(student_id=user.id).all()
    paid_statuses = {'paid', 'success'}
    paid_set = set()
    for t in transactions:
        if str(t.status or '').lower() not in paid_statuses:
            continue
        yr = t.year or datetime.utcnow().year
        paid_set.add((t.month.strip().lower(), int(yr)))

    start = user.created_at
    end = datetime.utcnow()
    cy, cm = start.year, start.month
    unpaid = []
    while (cy < end.year) or (cy == end.year and cm <= end.month):
        mname = MONTH_NAMES[cm - 1]
        if (mname.lower(), cy) not in paid_set:
            unpaid.append(f'{mname} {cy}')
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1
    return unpaid


def get_main_leader():
    from models import User
    return User.query.filter_by(role='Main Leader').first()


def notify_main_leader(app, title, body, category='system'):
    """In-app notification for Main Leader (portal bell) — no email required."""
    leader = get_main_leader()
    if leader and leader.id:
        record_notification(app, leader.id, title, body, category)


def notify_main_leader_with_email(app, title, body, category='system'):
    """In-app bell notification + Gmail to Main Leader."""
    leader = get_main_leader()
    if not leader:
        return
    if leader.id:
        record_notification(app, leader.id, title, body, category)
    if not leader.email or '@' not in leader.email:
        return

    # Already recorded above; skip duplicate notification from send_mail_now.
    send_mail_now(
        app,
        (title or f'{club_official_name(app)} Notification')[:200],
        [leader.email],
        body or '',
        user_id=None,
        category=category,
    )


def _user_id_for_email(email, user_id=None):
    if user_id:
        return user_id
    if not email or '@' not in str(email):
        return None
    from sqlalchemy import func
    from models import User
    user = User.query.filter(func.lower(User.email) == str(email).strip().lower()).first()
    return user.id if user else None


def record_notification(app, user_id, title, body, category='email'):
    if not user_id or not title:
        return
    try:
        with app.app_context():
            from models import Notification
            from extensions import db
            note = Notification(
                user_id=user_id,
                title=title[:200],
                body=body or '',
                category=category,
            )
            db.session.add(note)
            db.session.commit()
    except Exception as e:
        print(f'Notification record failed ({user_id}): {e}')
        try:
            from extensions import db
            db.session.rollback()
        except Exception:
            pass


def send_mail_now(app, subject, recipients, body, user_id=None, category='email'):
    """Send one email in the current request (reliable on Passenger/shared hosting)."""
    if not recipients:
        return False
    email = recipients[0] if isinstance(recipients, list) else recipients
    if not email or '@' not in str(email):
        return False
    email = str(email).strip()
    try:
        from flask_mail import Message
        from extensions import mail
        sender = club_mail_sender(app)
        kwargs = {
            'subject': subject or '',
            'recipients': [email],
            'body': body or '',
        }
        if sender:
            kwargs['sender'] = sender
        mail.send(Message(**kwargs))
        nid = _user_id_for_email(email, user_id)
        if nid:
            record_notification(app, nid, subject, body, category)
        return True
    except Exception as e:
        print(f'Email send failed ({subject} → {email}): {e}')
        try:
            nid = _user_id_for_email(email, user_id)
            if nid:
                record_notification(app, nid, subject, body, category)
        except Exception:
            pass
        return False


def safe_send_mail(app, subject, recipients, body, user_id=None, category='email'):
    """Send email now (sync). Prefer this over daemon threads on shared hosting."""
    return send_mail_now(app, subject, recipients, body, user_id=user_id, category=category)


def send_payment_confirmation(app, student, paid_month, paid_year=None, paid_amount=None):
    if not student or not student.email or '@' not in student.email:
        return
    from models import Transaction

    yr = paid_year or datetime.utcnow().year
    txns = Transaction.query.filter_by(student_id=student.id).all()
    unpaid = get_unpaid_months_for_user(student, txns)
    unpaid_after = [u for u in unpaid if not (u.startswith(paid_month) and str(yr) in u)]

    lines = [
        greet(student.name),
        '',
        f'Thank you — your payment for {paid_month} {yr} has been recorded.',
    ]
    if paid_amount:
        lines.append(f'Amount received: {paid_amount}')
    lines.append('')
    if unpaid_after:
        lines.append('You still have outstanding (kugu taagan) month(s):')
        lines.extend([f'  • {m}' for m in unpaid_after])
        lines.append('')
        lines.append('Please contact your Convocation Leader / Collector to clear remaining dues.')
    else:
        lines.append('You are fully up to date for all months. Hambalyo!')
    lines.extend(['', email_closing(app)])

    safe_send_mail(
        app,
        f'{club_official_name(app)} — Payment Received — {paid_month} {yr}',
        [student.email.strip()],
        '\n'.join(lines),
        user_id=student.id,
        category='payment',
    )


def send_welcome_email(app, user):
    if not user or not user.email or '@' not in user.email:
        return
    body = f"""{greet(user.name)}

Welcome to the Naadiga Ardayda Deeqda Waxbarasho HSF community!

Your public account has been created successfully. You can now sign in with your username and explore our programs, articles, and updates.

Username: {user.username}

If you did not create this account, please contact us at {club_official_email(app)}.

{email_closing(app, style='warm')}
"""
    safe_send_mail(
        app,
        f'{club_official_name(app)} — Registration Confirmed',
        [user.email.strip()],
        body,
        user_id=user.id,
        category='registration',
    )


def send_member_registration_email(app, user, plain_password=None):
    """Notify a portal member added by an admin (convocation, login, settings hint)."""
    if not user or not user.email or '@' not in user.email:
        return
    pwd = (plain_password or '').strip() or '(password set by your administrator)'
    conv = (user.convocation or '').strip() or 'your assigned convocation'
    role = display_role(user.role)
    body = f"""{greet(user.name)}

You have been registered as a member of Naadiga Ardayda Deeqda Waxbarasho HSF.

Convocation (Dufcad): {conv}
Role: {role}

You can sign in to the member portal using:
Username: {user.username}
Password: {pwd}

After your first login, you can update your password and profile details in Settings.

If you did not expect this registration, please contact your convocation leader or {club_official_email(app)}.

{email_closing(app)}
"""
    safe_send_mail(
        app,
        f'{club_official_name(app)} — Member Registration — {conv}',
        [user.email.strip()],
        body,
        user_id=user.id,
        category='registration',
    )


def _format_profile_value(field, value):
    if field == 'isGraduated':
        return 'Graduated' if value else 'Active'
    if field == 'has_works':
        return 'Yes' if value else 'No'
    if field == 'role':
        return display_role(value)
    if value is None or value == '':
        return '—'
    return str(value)


def send_member_profile_updated_email(app, user, change_lines, plain_password=None, recipients=None):
    """Notify a member when their portal profile is updated by an admin or themselves."""
    to_list = [e.strip() for e in (recipients or []) if e and '@' in str(e)]
    if not to_list and user and user.email and '@' in user.email:
        to_list = [user.email.strip()]
    if not user or not to_list or not change_lines:
        return False

    body_card_line = user.bodyCard or 'No'
    if user.bodyCard == 'Yes' and user.card_number:
        body_card_line = f'Yes — Card #{user.card_number}'

    lines = [
        greet(user.name),
        '',
        'Your HSF member account details were updated in the system.',
        '',
        'Changes made:',
    ]
    lines.extend([f'  • {line}' for line in change_lines])
    lines.append('')

    summary_lines = [
        'Current account summary:',
        f'  Username: {user.username}',
        f'  Role: {display_role(user.role)}',
        f'  Convocation (Dufcad): {user.convocation or "—"}',
        f'  Body card: {body_card_line}',
    ]
    if plain_password:
        summary_lines.append(f'  Password: {plain_password}')
    lines.extend(summary_lines)
    if plain_password:
        lines.extend([
            '',
            'You can change your password anytime under Settings after signing in.',
        ])
    lines.extend([
        '',
        f'If you did not request these changes, contact your convocation leader or {club_official_email(app)} immediately.',
        '',
        email_closing(app),
    ])

    safe_send_mail(
        app,
        f'{club_official_name(app)} — Account Updated',
        to_list,
        '\n'.join(lines),
        user_id=user.id,
        category='profile_update',
    )
    return True


def send_member_deleted_email(app, email, name, member_id, role=None, convocation=None):
    """Notify a member that their HSF portal account was removed."""
    if not email or '@' not in str(email):
        return

    body = f"""{greet(name)}

Your member account in the Naadiga Ardayda Deeqda Waxbarasho HSF portal has been removed by an administrator.

Account ID: {member_id}
Role: {display_role(role)}
Convocation (Dufcad): {convocation or '—'}

You will no longer be able to sign in with this account. If you believe this was a mistake, contact {club_official_email(app)} or your convocation leader as soon as possible.

{email_closing(app)}
"""
    safe_send_mail(
        app,
        f'{club_official_name(app)} — Account Removed',
        [str(email).strip()],
        body,
        user_id=None,
        category='account_deleted',
    )


def send_member_graduated_email(app, user):
    """Notify a member when an admin marks them as graduated."""
    if not user or not user.email or '@' not in user.email:
        return False

    conv = (user.convocation or '').strip() or 'your convocation'
    works_note = ''
    if user.has_works:
        parts = []
        if user.work_place:
            parts.append(user.work_place)
        if user.work_role:
            parts.append(user.work_role)
        if parts:
            works_note = f'\nEmployment on file: {" — ".join(parts)}'

    body = f"""{greet(user.name)}

Congratulations! You have been marked as a **Graduated Member** of Naadiga Ardayda Deeqda Waxbarasho HSF.

Convocation (Dufcad): {conv}
Status: Graduated

Your member portal account remains available so you can stay connected with the club. Some active-member features (such as monthly meeting attendance for current students) may no longer apply to you as a graduate.{works_note}

If you have questions about your status, contact your convocation leader or {club_official_email(app)}.

{email_closing(app, style='congrats')}
"""
    safe_send_mail(
        app,
        f'{club_official_name(app)} — Graduation — {conv}',
        [user.email.strip()],
        body.replace('**', ''),
        user_id=user.id,
        category='graduation',
    )
    return True


def send_meeting_notification(app, meeting, members):
    if not meeting or not members:
        return
    conv_label = meeting.convocation if meeting.convocation and meeting.convocation != 'All' else 'All convocations'
    target = getattr(meeting, 'target_audience', None) or 'active'
    audience_label = 'Graduated students (quarterly)' if target == 'graduated' else 'Active students (monthly)'
    for user in members:
        if not user.email or '@' not in user.email:
            continue
        body = f"""{greet(user.name)}

A new meeting has been scheduled for {audience_label} in {conv_label}.

Topic: {meeting.topic}
Date: {meeting.date}
Place: {meeting.place or 'TBA'}
Presenter: {meeting.presenter or 'TBA'}

Please attend on time. Contact your leader if you have questions.

{email_closing(app)}
"""
        safe_send_mail(
            app,
            f'{club_official_name(app)} — New Meeting: {meeting.topic}',
            [user.email.strip()],
            body,
            user_id=user.id,
            category='meeting',
        )


def send_absent_meeting_email(app, user, meeting):
    """Email member when marked absent for a meeting."""
    if not user or not user.email or '@' not in user.email or not meeting:
        return False
    body = f"""{greet(user.name)}

You were marked as **absent** for the following meeting:

Topic: {meeting.topic}
Date: {meeting.date}
Place: {meeting.place or 'TBA'}
Presenter: {meeting.presenter or 'TBA'}

If you have a valid reason for missing this meeting, open the HSF member help form (Cudurdaar maqnaanshaha) — the meeting date will be filled in automatically from this absence.

{email_closing(app)}
"""
    return safe_send_mail(
        app,
        f'{club_official_name(app)} — Absent: {meeting.topic}',
        [user.email.strip()],
        body.replace('**', ''),
        user_id=user.id,
        category='meeting_absent',
    )


def send_help_apology_response_email(app, user, request_row, action):
    """Notify member when admin approves or rejects an absence apology."""
    if not user or not user.email or '@' not in user.email:
        return False
    if not request_row:
        return False

    approved = action == 'approve'
    if approved:
        subject = f'{club_official_name(app)} — Cudurdaarkaaga waa la aqbalay'
        body = f"""{greet(user.name)}

Waxaa laguu aqbalay cudurdaarkaaga maqnaanshaha kulanka billaha ah.

Your absence apology has been approved. You remain recorded as absent for that meeting (your missed count is unchanged), but your absence is marked as excused in the system.

Please check with your dufcad leader for any meeting notes you missed.

{email_closing(app)}
"""
    else:
        subject = f'{club_official_name(app)} — Cudurdaarkaaga lama aqbalin'
        body = f"""{greet(user.name)}

Lama aqbalin cudurdaarkaaga maqnaanshaha kulanka billaha ah. Fadlan la xiriir maamulka haddii aad su'aalo qabtid.

Your absence apology was not approved. Please contact the club administration if you have questions.

{email_closing(app)}
"""

    return safe_send_mail(
        app,
        subject,
        [user.email.strip()],
        body,
        user_id=user.id,
        category='help_apology',
    )

"""Member-only application forms: Quran contest, Summer course, Help."""

import hmac
import hashlib
import random
import re
import string
import time
import uuid
from datetime import datetime, timedelta, time as dt_time

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import func, or_
from flask_mail import Message
from extensions import db, mail
from models import (
    User, Convocation, QuranContestApplication, SummerCourseApplication,
    MemberHelpRequest, ApplicationFormSettings, QuranContestYear, SummerCourseYear,
    Meeting, Attendance,
)
from utils.email_helpers import notify_main_leader, notify_main_leader_with_email, safe_send_mail
from org_constants import CLUB_OFFICIAL_NAME

bp = Blueprint('applications', __name__)

LEGACY_ORG_SUBTITLES = frozenset({
    'Naadiga Ardayda HSF',
    'Naadiga Arday Deeqda Waxbarasho HSF',
    'Hormuud Salaam Foundation',
    'Naadiga Ardayda Hormuud Salaam Foundation',
})


def _normalize_subtitle(value):
    v = (value or '').strip()
    if not v or v in LEGACY_ORG_SUBTITLES:
        return CLUB_OFFICIAL_NAME
    return v

MEMBER_ROLES = {'Student', 'Leader', 'Payment Sub Admin', 'Payment Admin', 'Main Leader', 'Media Admin'}
EXTRA_DUFCADS = ['Alnuur']

VALID_QURAN_SECTIONS = {
    'Qeybta 10-ka Jus',
    'Qeybta 20-ka Jus',
    'Qeybta 30-ka Jus',
}

QURAN_JUZ_SECTIONS = {
    'juz10': 'Qeybta 10-ka Jus',
    'juz20': 'Qeybta 20-ka Jus',
    'juz30': 'Qeybta 30-ka Jus',
}

QURAN_WINNER_FIELDS = [
    'winner_juz10_first', 'winner_juz10_second', 'winner_juz10_third',
    'winner_juz20_first', 'winner_juz20_second', 'winner_juz20_third',
    'winner_juz30_first', 'winner_juz30_second', 'winner_juz30_third',
]

QURAN_ERR_WON_SAME_CATEGORY = (
    '❌ You cannot register for this category because you previously won '
    '1st, 2nd, or 3rd place in this category.'
)
QURAN_ERR_PARTICIPATED_SAME_CATEGORY = (
    '❌ You cannot register for a category that you have already participated in before.'
)
QURAN_ERR_30_JUZ_FIRST = (
    '❌ Previous 1st place winners of the 30 Juz category are not eligible to participate again.'
)
QURAN_ERR_LOWER_SECTION = (
    '❌ You cannot register for a section lower than one you have already competed in before.'
)
QURAN_ERR_FIELD_TAMPER = (
    '❌ Cannot change profile data loaded from your member account. Only your name may be edited.'
)
QURAN_ERR_NOT_ELIGIBLE_SECTION = (
    '❌ You are not eligible to register for the selected section.'
)
QURAN_SUCCESS_MSG = 'Registration submitted successfully.'

QURAN_WON_BEFORE_RANKS = {
    'Kaalinta 1aad': 1,
    'Kaalinta 2aad': 2,
    'Kaalinta 3aad': 3,
}

FORM_TYPES = {
    'quran-contest': 'quran_contest_open',
    'summer-course': 'summer_course_open',
    'help': 'help_open',
}

CLOSED_MESSAGE_FIELDS = {
    'quran-contest': 'quran_closed_message',
    'summer-course': 'summer_closed_message',
}

NO_ACTIVE_QURAN_MSG = 'No active Quran contest at this time. Please contact HSF admin.'
NO_ACTIVE_SUMMER_MSG = 'No active summer course program at this time. Please contact HSF admin.'
SUMMER_ENDED_MSG = 'Summer course registration has closed.'
SUMMER_GUEST_DUFCAD = 'Guest'
QURAN_ENDED_MSG = 'Quran contest registration has closed.'
QURAN_TOGGLE_CLOSED_DEFAULT = (
    'Quran contest registration is closed now. Please check back when registration opens.'
)
SUMMER_TOGGLE_CLOSED_DEFAULT = (
    'Summer course registration is closed now. Please check back when registration opens.'
)
REGISTRATION_LOCK_HOURS = 6


def _generate_otp():
    return ''.join(random.choices(string.digits, k=6))


def _mask_email(email):
    if not email or '@' not in email:
        return 'your registered email'
    local, domain = email.split('@', 1)
    if len(local) <= 2:
        masked = local[0] + '***'
    else:
        masked = local[0] + '***' + local[-1]
    return f'{masked}@{domain}'


def _get_form_settings():
    row = ApplicationFormSettings.query.get(1)
    if not row:
        row = ApplicationFormSettings(id=1)
        db.session.add(row)
        db.session.commit()
    return row


def _is_form_open(form_type):
    settings = _get_form_settings()
    field = FORM_TYPES.get(form_type)
    if not field:
        return True, ''
    if getattr(settings, field, True):
        return True, ''
    msg_field = CLOSED_MESSAGE_FIELDS.get(form_type)
    raw = (getattr(settings, msg_field, '') or '').strip() if msg_field else ''
    if form_type == 'quran-contest':
        default = QURAN_TOGGLE_CLOSED_DEFAULT
    elif form_type == 'summer-course':
        default = SUMMER_TOGGLE_CLOSED_DEFAULT
    else:
        default = 'Registration is closed now.'
    msg = raw if raw and raw.lower() not in ('open', 'closed') else default
    return False, msg


def _registration_availability(form_type):
    """Single registration gate for public and admin (program state, then admin toggle)."""
    prog_blocked, prog_msg, no_prog = _member_program_gate(form_type)
    if prog_blocked:
        return {
            'open': False,
            'closed_message': prog_msg,
            'reason': 'no_program' if no_prog else 'program_ended',
        }
    toggle_open, toggle_msg = _is_form_open(form_type)
    if not toggle_open:
        return {
            'open': False,
            'closed_message': toggle_msg,
            'reason': 'toggle_closed',
        }
    return {'open': True, 'closed_message': '', 'reason': ''}


def _registration_closed_response(form_type):
    avail = _registration_availability(form_type)
    if avail['open']:
        return None
    return jsonify({'error': avail['closed_message'], 'closed': True}), 403


def _member_program_gate(form_type):
    """Block member self-registration when no admin program exists (or summer ended)."""
    if form_type == 'quran-contest':
        meta = _latest_quran_contest_meta()
        if meta is None:
            return True, NO_ACTIVE_QURAN_MSG, True
        if _quran_contest_ended(meta):
            return True, QURAN_ENDED_MSG, False
        return False, '', False
    if form_type == 'summer-course':
        meta = _latest_summer_program_meta()
        if meta is None:
            return True, NO_ACTIVE_SUMMER_MSG, True
        if _summer_program_ended(meta):
            return True, SUMMER_ENDED_MSG, False
        return False, '', False
    return False, '', False


def _send_form_otp_email(user, form_label):
    otp = _generate_otp()
    user.otp_code = otp
    user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    user.otp_attempts = 0
    db.session.commit()

    from utils.email_helpers import club_mail_sender, club_official_name
    app_obj = current_app._get_current_object()
    org = club_official_name(app_obj)
    sender = club_mail_sender(app_obj)
    msg = Message(
        subject=f'{org} — verification code — {form_label}',
        sender=sender,
        recipients=[user.email],
        body=(
            f'Hello {user.name},\n\n'
            f'Your verification code to access {form_label} is: {otp}\n\n'
            f'This code expires in 10 minutes.\n\n'
            f'If you did not request this, ignore this email.\n\n'
            f'— {org}'
        ),
    )
    mail.send(msg)


def _send_quran_confirmation_email(user, application):
    if not user.email or '@' not in user.email:
        return
    body = (
        f'Mahadsanid {user.name},\n\n'
        f'Diiwaangelintaada tartanka Quran-ka waa la helay.\n\n'
        f'Magac: {application.full_name}\n'
        f'Qeybta: {application.section_this_year}\n'
        f'Dufcad: {application.convocation}\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        'Naadiga Ardayda Deeqda Waxbarasho HSF — Diiwaangelinta Tartanka Quran-ka waa la helay',
        [user.email],
        body,
        user_id=user.id,
        category='registration',
    )


def _send_quran_update_email(user, application):
    if not user.email or '@' not in user.email:
        return
    body = (
        f'Mahadsanid {user.name},\n\n'
        f'Diiwaangelintaada tartanka Quran-ka waa la cusbooneysiiyay maamulka HSF.\n\n'
        f'Magac: {application.full_name}\n'
        f'Qeybta: {application.section_this_year}\n'
        f'Dufcad: {application.convocation}\n'
        f'WhatsApp: {application.whatsapp}\n'
        f'Telephone: {application.telephone}\n\n'
        f'Haddii wax aan sax ahayn, la xiriir maamulka.\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        'Naadiga Ardayda Deeqda Waxbarasho HSF — Diiwaangelinta Tartanka Quran-ka waa la cusbooneysiiyay',
        [user.email],
        body,
        user_id=user.id,
        category='registration',
    )


def _send_quran_delete_email(user, application):
    if not user.email or '@' not in user.email:
        return
    body = (
        f'Mahadsanid {user.name},\n\n'
        f'Diiwaangelintaada tartanka Quran-ka waa laga tirtiray maamulka HSF.\n\n'
        f'Magac: {application.full_name}\n'
        f'Qeybta: {application.section_this_year}\n'
        f'Dufcad: {application.convocation}\n\n'
        f'Haddii tani khalad tahay, la xiriir maamulka HSF.\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        'Naadiga Ardayda Deeqda Waxbarasho HSF — Diiwaangelinta Tartanka Quran-ka waa la tirtiray',
        [user.email],
        body,
        user_id=user.id,
        category='registration',
    )


def _send_summer_confirmation_email(user, application):
    if not user.email or '@' not in user.email:
        return
    body = (
        f'Mahadsanid {user.name},\n\n'
        f'Diiwaangelintaada koorsooyinka xagaaga waa la helay.\n\n'
        f'Magac: {application.name}\n'
        f'Dufcad: {application.convocation}\n'
        f'Jaamacad: {application.university}\n'
        f'Kuliyad: {application.faculty}\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        'Naadiga Ardayda Deeqda Waxbarasho HSF — Diiwaangelinta Koorsooyinka Xagaaga waa la helay',
        [user.email],
        body,
        user_id=user.id,
        category='registration',
    )


def _send_summer_update_email(user, application):
    if not user.email or '@' not in user.email:
        return
    body = (
        f'Mahadsanid {user.name},\n\n'
        f'Diiwaangelintaada koorsooyinka xagaaga waa la cusbooneysiiyay maamulka HSF.\n\n'
        f'Magac: {application.name}\n'
        f'Dufcad: {application.convocation}\n'
        f'Jaamacad: {application.university}\n'
        f'Kuliyad: {application.faculty}\n\n'
        f'Haddii wax aan sax ahayn, la xiriir maamulka.\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        'Naadiga Ardayda Deeqda Waxbarasho HSF — Diiwaangelinta Koorsooyinka Xagaaga waa la cusbooneysiiyay',
        [user.email],
        body,
        user_id=user.id,
        category='registration',
    )


def _send_summer_delete_email(user, application):
    if not user.email or '@' not in user.email:
        return
    body = (
        f'Mahadsanid {user.name},\n\n'
        f'Diiwaangelintaada koorsooyinka xagaaga waa laga tirtiray maamulka HSF.\n\n'
        f'Magac: {application.name}\n'
        f'Dufcad: {application.convocation}\n\n'
        f'Haddii tani khalad tahay, la xiriir maamulka HSF.\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        'Naadiga Ardayda Deeqda Waxbarasho HSF — Diiwaangelinta Koorsooyinka Xagaaga waa la tirtiray',
        [user.email],
        body,
        user_id=user.id,
        category='registration',
    )


def _summer_program_display_name(year):
    settings = ApplicationFormSettings.query.get(1)
    headline = (settings.summer_headline or '').strip() if settings else ''
    if headline:
        return headline
    return f'{year} Summer Course'


def _absence_notified_set(row):
    raw = (getattr(row, 'absence_notified_days', None) or '').strip()
    if not raw:
        return set()
    out = set()
    for part in raw.split(','):
        part = part.strip()
        if part.isdigit():
            d = int(part)
            if 1 <= d <= 6:
                out.add(d)
    return out


def _store_absence_notified(row, days_set):
    row.absence_notified_days = ','.join(str(d) for d in sorted(days_set)) if days_set else ''


def _send_summer_absence_email(application, day_num, program_name):
    """Email attendee that they missed a specific program day. Returns True if sent."""
    email = (application.email or '').strip()
    user = User.query.get(application.user_id)
    if user and user.email and '@' in user.email:
        email = user.email.strip()
    if not email or '@' not in email:
        return False
    name = (application.name or (user.name if user else '') or 'Member').strip()
    body = (
        f'Mahadsanid {name},\n\n'
        f'Waxaad ka maqneyd Maalinta {day_num} ee {program_name}.\n\n'
        f'You missed Day {day_num} of {program_name}.\n\n'
        f'Haddii tani khalad tahay, la xiriir maamulka HSF.\n\n'
        f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
    )
    safe_send_mail(
        current_app._get_current_object(),
        f'Naadiga Ardayda Deeqda Waxbarasho HSF — Maqnaansho: Maalinta {day_num}',
        [email],
        body,
        user_id=application.user_id,
        category='summer_absence',
    )
    return True


def _notify_summer_absences_for_days(rows, notify_days, year):
    """
    For each day in notify_days: email people who are absent and not yet notified.
    If marked present, clear that day from the notified set so a later absence can re-notify.
    Attendance must already be saved on the rows. Commits notified-days updates separately.
    """
    days = sorted({int(d) for d in (notify_days or []) if str(d).isdigit() and 1 <= int(d) <= 6})
    if not days or not rows:
        return 0
    program_name = _summer_program_display_name(year)
    sent = 0
    for row in rows:
        notified = _absence_notified_set(row)
        changed = False
        for day in days:
            present = bool(getattr(row, f'attendance_day{day}', False))
            if present:
                if day in notified:
                    notified.discard(day)
                    changed = True
                continue
            if day in notified:
                continue
            try:
                if _send_summer_absence_email(row, day, program_name):
                    notified.add(day)
                    changed = True
                    sent += 1
            except Exception as e:
                print(f'summer absence email failed (app {row.id} day {day}): {e}')
        if changed:
            _store_absence_notified(row, notified)
    try:
        db.session.commit()
    except Exception as e:
        print(f'summer absence_notified_days commit failed: {e}')
        db.session.rollback()
    return sent


def _make_access_token(user_id, form_type):
    secret = current_app.config.get('SECRET_KEY', 'hsf-secret')
    exp = int(time.time()) + 1800
    payload = f'{user_id}:{form_type}:{exp}'
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f'{payload}:{sig}'


def _verify_access_token(token, user_id, form_type):
    if not token:
        return False
    try:
        parts = token.rsplit(':', 1)
        if len(parts) != 2:
            return False
        payload, sig = parts
        uid, ft, exp_s = payload.split(':')
        if uid != str(user_id) or ft != form_type:
            return False
        if int(exp_s) < int(time.time()):
            return False
        secret = current_app.config.get('SECRET_KEY', 'hsf-secret')
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)
    except (ValueError, TypeError):
        return False


def _member_user(user_id=None, username=None):
    user = None
    if user_id:
        user = User.query.get(str(user_id).strip())
    elif username:
        user = User.query.filter(func.lower(User.username) == username.lower().strip()).first()
    if not user or user.role not in MEMBER_ROLES:
        return None
    return user


def _juz_level(section_label):
    if not section_label or section_label == 'Midna':
        return 0
    m = re.search(r'(\d+)', str(section_label))
    return int(m.group(1)) if m else 0


def _valid_phone(value):
    digits = re.sub(r'\D', '', value or '')
    return 7 <= len(digits) <= 15


def _allowed_convocations():
    names = {c.name for c in Convocation.query.all()}
    labels = {_dufcad_label(n) for n in names}
    labels.update(EXTRA_DUFCADS)
    return labels


def _quran_app_for_user_year(user_id, year=None):
    if year is None:
        year = _active_quran_year()
    if year is None:
        return None
    for row in QuranContestApplication.query.filter_by(user_id=user_id).all():
        if row.created_at and row.created_at.year == year:
            return row
    return None


def _summer_app_for_user_year(user_id, year=None):
    if year is None:
        year = _active_summer_year()
    if year is None:
        return None
    for row in SummerCourseApplication.query.filter_by(user_id=user_id).all():
        if row.created_at and row.created_at.year == year:
            return row
    return None


def _quran_reg_names_for_year(year):
    names = set()
    for row in QuranContestApplication.query.all():
        if row.created_at and row.created_at.year == year and row.full_name:
            names.add(row.full_name.strip())
    return names


def _quran_names_by_section(year):
    by_section = {k: set() for k in QURAN_JUZ_SECTIONS}
    for row in QuranContestApplication.query.all():
        if not row.created_at or row.created_at.year != year or not row.full_name:
            continue
        for key, label in QURAN_JUZ_SECTIONS.items():
            if row.section_this_year == label:
                by_section[key].add(row.full_name.strip())
    return by_section


def _registration_created_at(year=None, default_month=1, default_day=15):
    now = datetime.utcnow()
    if year is None or int(year) == now.year:
        return now
    return datetime(int(year), default_month, min(default_day, 28), 12, 0, 0)


def _won_before_rank(won_before):
    return QURAN_WON_BEFORE_RANKS.get(won_before)


def _juz_key_from_level(level):
    return {10: 'juz10', 20: 'juz20', 30: 'juz30'}.get(level)


def _contest_win_rank_for_name(meta, full_name, juz_key):
    if not meta or not full_name:
        return None
    fn = full_name.strip().lower()
    for rank, suffix in ((1, 'first'), (2, 'second'), (3, 'third')):
        val = (getattr(meta, f'winner_{juz_key}_{suffix}', None) or '').strip().lower()
        if val and val == fn:
            return rank
    if juz_key == 'juz30':
        legacy = (meta.winner_first or '').strip().lower()
        if legacy and legacy == fn:
            return 1
    return None


def _prev_section_short_label(level):
    return {10: '10 Juz', 20: '20 Juz', 30: '30 Juz'}.get(level)


def _won_before_from_rank(rank):
    return {
        1: 'Kaalinta 1aad',
        2: 'Kaalinta 2aad',
        3: 'Kaalinta 3aad',
    }.get(rank)


def _quran_past_apps(user_id, exclude_app_id=None):
    rows = []
    for row in QuranContestApplication.query.filter_by(user_id=user_id).all():
        if exclude_app_id and row.id == exclude_app_id:
            continue
        rows.append(row)
    return rows


def _quran_highest_past_level(user_id, exclude_app_id=None):
    highest = 0
    for row in _quran_past_apps(user_id, exclude_app_id):
        level = _juz_level(row.section_this_year)
        if level > highest:
            highest = level
    return highest


def _quran_win_rank_for_past_app(past_app, full_name=None):
    if not past_app.created_at:
        return None
    meta = QuranContestYear.query.get(past_app.created_at.year)
    if not meta:
        return None
    level = _juz_level(past_app.section_this_year)
    juz_key = _juz_key_from_level(level)
    if not juz_key:
        return None
    name = (past_app.full_name or full_name or '').strip()
    return _contest_win_rank_for_name(meta, name, juz_key)


def _quran_is_30_juz_first_winner(user, full_name=None, exclude_app_id=None, **_kwargs):
    """Permanent ban: ever won 1st place at 30 Juz (DB winners + past applications)."""
    for past in _quran_past_apps(user.id, exclude_app_id):
        if _juz_level(past.section_this_year) >= 30:
            rank = _quran_win_rank_for_past_app(past, full_name or user.name)
            if rank == 1:
                return True
        if past.won_before == 'Kaalinta 1aad' and _juz_level(past.previous_section) >= 30:
            return True
    check_name = (full_name or user.name or '').strip()
    if check_name:
        for meta in QuranContestYear.query.all():
            if _contest_win_rank_for_name(meta, check_name, 'juz30') == 1:
                return True
    return False


def _quran_best_win_rank_at_level(user_id, level, exclude_app_id=None, full_name=None):
    best = None
    for past in _quran_past_apps(user_id, exclude_app_id):
        if _juz_level(past.section_this_year) != level:
            continue
        rank = _quran_win_rank_for_past_app(past, full_name)
        if rank and (best is None or rank < best):
            best = rank
    return best


def _quran_past_summary_from_db(user, exclude_app_id=None):
    """Derive participated / previous section / won-before from registration history."""
    highest = _quran_highest_past_level(user.id, exclude_app_id)
    if not highest:
        return 'Maya', None, None
    previous_section = _prev_section_short_label(highest)
    won_before = _won_before_from_rank(
        _quran_best_win_rank_at_level(user.id, highest, exclude_app_id, user.name)
    )
    return 'Haa', previous_section, won_before


def _quran_allow_same_section_retry_below_30():
    """Admin toggle: treat 10/20 same-section retry like 30 (block only on 1st place)."""
    settings = _get_form_settings()
    return bool(getattr(settings, 'quran_allow_same_section_retry_below_30', False))


def _quran_section_level_error(user, this_level, highest_past, exclude_app_id=None, full_name=None):
    if _quran_is_30_juz_first_winner(user, full_name, exclude_app_id=exclude_app_id):
        return QURAN_ERR_30_JUZ_FIRST
    if not this_level:
        return None
    if highest_past == 0:
        return None
    if this_level < highest_past:
        return QURAN_ERR_LOWER_SECTION
    if this_level == highest_past:
        if highest_past < 30:
            rank = _quran_best_win_rank_at_level(
                user.id, this_level, exclude_app_id, full_name or user.name,
            )
            # Optional rule: 10/20 may retry same section unless they won 1st (like 30).
            if _quran_allow_same_section_retry_below_30():
                if rank == 1:
                    return QURAN_ERR_WON_SAME_CATEGORY
                return None
            if rank in (1, 2, 3):
                return QURAN_ERR_WON_SAME_CATEGORY
            return QURAN_ERR_PARTICIPATED_SAME_CATEGORY
        return None
    return None


def _quran_allowed_sections(user, exclude_app_id=None, full_name=None):
    if _quran_is_30_juz_first_winner(user, full_name, exclude_app_id=exclude_app_id):
        return []
    highest = _quran_highest_past_level(user.id, exclude_app_id)
    allowed = []
    for label in sorted(VALID_QURAN_SECTIONS, key=_juz_level):
        level = _juz_level(label)
        if level and not _quran_section_level_error(
            user, level, highest, exclude_app_id, full_name,
        ):
            allowed.append(label)
    return allowed


def _quran_category_eligibility_error(user, data, exclude_app_id=None):
    section_this_year = (data.get('section_this_year') or '').strip()
    this_level = _juz_level(section_this_year)
    if not this_level:
        return None
    highest = _quran_highest_past_level(user.id, exclude_app_id)
    full_name = (data.get('full_name') or user.name or '').strip()
    return _quran_section_level_error(
        user, this_level, highest, exclude_app_id, full_name,
    )


def _quran_juz30_first_winner_details(user, full_name=None, exclude_app_id=None):
    """Return (is_30_juz_first_winner, contest_year) from apps and winner records."""
    name = (full_name or user.name or '').strip()
    for past in _quran_past_apps(user.id, exclude_app_id):
        if _juz_level(past.section_this_year) >= 30:
            if _quran_win_rank_for_past_app(past, name) == 1:
                year = past.created_at.year if past.created_at else None
                return True, year
        if past.won_before == 'Kaalinta 1aad' and _juz_level(past.previous_section) >= 30:
            year = past.created_at.year if past.created_at else None
            return True, year
    if name:
        for meta in QuranContestYear.query.order_by(QuranContestYear.year.desc()).all():
            if _contest_win_rank_for_name(meta, name, 'juz30') == 1:
                return True, meta.year
    return False, None


def _quran_authoritative_past_summary(user, exclude_app_id=None, full_name=None):
    """Single source for participated / previous section / won-before shown in forms."""
    participated, previous_section, won_before = _quran_past_summary_from_db(
        user, exclude_app_id,
    )
    is_j30, j30_year = _quran_juz30_first_winner_details(
        user, full_name or user.name, exclude_app_id,
    )
    if is_j30:
        return 'Haa', '30 Juz', 'Kaalinta 1aad', j30_year
    return participated, previous_section, won_before, None


def _quran_eligibility_hint(user, exclude_app_id=None, full_name=None):
    """Human-readable hint for section dropdown (matches backend rules)."""
    is_j30, j30_year = _quran_juz30_first_winner_details(
        user, full_name or user.name, exclude_app_id,
    )
    if is_j30:
        if j30_year:
            return f'{QURAN_ERR_30_JUZ_FIRST} (winner record: {j30_year}).'
        return QURAN_ERR_30_JUZ_FIRST
    allowed = _quran_allowed_sections(user, exclude_app_id, full_name)
    if not allowed:
        return QURAN_ERR_NOT_ELIGIBLE_SECTION
    participated, prev, won, _ = _quran_authoritative_past_summary(
        user, exclude_app_id, full_name,
    )
    if participated == 'Haa' and prev:
        prev_level = _juz_level(prev)
        if prev_level >= 30 and won != 'Kaalinta 1aad':
            return (
                'Previously at 30 Juz — may register for 30 Juz again unless they won 1st place.'
            )
        if prev_level < 30 and _quran_allow_same_section_retry_below_30():
            if won == 'Kaalinta 1aad':
                return (
                    f'Won 1st place at {prev} — choose a higher section only '
                    '(same or lower is not allowed).'
                )
            return (
                f'Previously in {prev} — may register the same section again, or a higher one. '
                'Lower sections are not allowed.'
            )
        return (
            f'Previously in {prev} — choose a higher section only (same or lower is not allowed).'
        )
    return ''


def _quran_profile_snapshot(user, exclude_app_id=None):
    participated, previous_section, won_before, j30_year = _quran_authoritative_past_summary(
        user, exclude_app_id,
    )
    convocation = _dufcad_label(user.convocation or '') if user.convocation else ''
    phone = (user.phone or '').strip()
    highest = _quran_highest_past_level(user.id, exclude_app_id)
    if j30_year and highest < 30:
        highest = 30
    permanently_ineligible = _quran_is_30_juz_first_winner(
        user, exclude_app_id=exclude_app_id,
    )
    allowed_sections = _quran_allowed_sections(user, exclude_app_id)
    return {
        'full_name': (user.name or '').strip(),
        'email': (user.email or '').strip(),
        'whatsapp': phone,
        'telephone': phone,
        'convocation': convocation,
        'university': (user.university or '').strip(),
        'faculty': (user.faculty or '').strip(),
        'semester': 'Graduated' if user.isGraduated else ((user.semester or '').strip()),
        'participated_before': participated,
        'previous_section': previous_section,
        'won_before': won_before,
        'allowed_sections': allowed_sections,
        'highest_past_level': highest,
        'permanently_ineligible': permanently_ineligible,
        'juz30_first_winner_year': j30_year,
        'eligibility_hint': _quran_eligibility_hint(user, exclude_app_id),
    }


def _validate_quran_locked_fields(user, data, exclude_app_id=None, skip=False):
    """Reject when client changes profile/past fields that must come from the backend."""
    if skip or _is_alnuur_dufcad(user.convocation):
        return None
    snap = _quran_profile_snapshot(user, exclude_app_id)
    field_pairs = (
        ('convocation', snap['convocation']),
        ('university', snap['university']),
        ('faculty', snap['faculty']),
    )
    for field, expected in field_pairs:
        submitted = (data.get(field) or '').strip()
        if submitted != (expected or '').strip():
            return QURAN_ERR_FIELD_TAMPER
    sem_submitted = (data.get('semester') or '').strip()
    sem_expected = (snap['semester'] or '').strip()
    if sem_submitted and sem_submitted != sem_expected:
        return QURAN_ERR_FIELD_TAMPER
    participated, prev, won, _ = _quran_authoritative_past_summary(user, exclude_app_id)
    if (data.get('participated_before') or '').strip() != participated:
        return QURAN_ERR_FIELD_TAMPER
    if participated == 'Haa':
        if (data.get('previous_section') or '').strip() != (prev or '').strip():
            return QURAN_ERR_FIELD_TAMPER
        submitted_won = (data.get('won_before') or '').strip() or None
        expected_won = won or None
        if submitted_won != expected_won:
            return QURAN_ERR_FIELD_TAMPER
    return None


def _apply_quran_db_past_fields(user, data, exclude_app_id=None, skip=False):
    """Overwrite past-participation answers from DB (authoritative for HSF members)."""
    if skip or _is_alnuur_dufcad(user.convocation):
        return data
    participated, previous_section, won_before, _ = _quran_authoritative_past_summary(
        user, exclude_app_id,
    )
    data = dict(data)
    data['participated_before'] = participated
    data['previous_section'] = previous_section
    data['won_before'] = won_before
    return data


def _normalize_quran_past_fields(participated_before, previous_section, won_before):
    """Maya = never participated — previous section and wins must be empty."""
    participated_before = (participated_before or '').strip()
    if participated_before == 'Maya':
        return participated_before, None, None
    previous_section = (previous_section or '').strip() or None
    won_before = (won_before or '').strip() or None
    if previous_section == 'Midna':
        previous_section = None
    if won_before in ('Midna', ''):
        won_before = None
    return participated_before, previous_section, won_before


def _repair_stale_quran_past_fields():
    rows = QuranContestApplication.query.filter(
        QuranContestApplication.participated_before == 'Maya',
        or_(
            QuranContestApplication.previous_section.isnot(None),
            QuranContestApplication.won_before.isnot(None),
        ),
    ).all()
    if not rows:
        return
    for row in rows:
        row.previous_section = None
        row.won_before = None
    db.session.commit()


def _validate_quran_registration(user, data, existing_row=None, admin_edit=False, skip_locked=False):
    """Return list of error strings (empty if valid)."""
    errors = []
    exclude_id = existing_row.id if existing_row else None
    data = _apply_quran_db_past_fields(user, data, exclude_id, skip=skip_locked)

    full_name = (data.get('full_name') or '').strip()
    email = (data.get('email') or '').strip()
    whatsapp = (data.get('whatsapp') or '').strip()
    telephone = (data.get('telephone') or '').strip()
    convocation = (data.get('convocation') or '').strip()
    participated_before, previous_section, won_before = _normalize_quran_past_fields(
        data.get('participated_before'),
        data.get('previous_section'),
        data.get('won_before'),
    )
    section_this_year = (data.get('section_this_year') or '').strip()

    if section_this_year not in VALID_QURAN_SECTIONS:
        errors.append('Dooro qeyb sax ah: 10 Juz, 20 Juz, ama 30 Juz.')

    if not _is_alnuur_dufcad(convocation):
        allowed_dufcads = _allowed_convocations()
        if convocation not in allowed_dufcads:
            errors.append('Dufcad sax ah dooro (HSF ama Al-Nuur).')

    if not _valid_phone(whatsapp):
        errors.append('Geli WhatsApp number sax ah.')
    if not _valid_phone(telephone):
        errors.append('Geli telephone number sax ah.')

    locked_err = _validate_quran_locked_fields(
        user, data, exclude_app_id=exclude_id, skip=skip_locked,
    )
    if locked_err:
        errors.append(locked_err)

    allowed_sections = _quran_allowed_sections(user, exclude_id, full_name)
    if section_this_year and section_this_year not in allowed_sections:
        category_err = _quran_category_eligibility_error(user, data, exclude_app_id=exclude_id)
        errors.append(category_err or QURAN_ERR_NOT_ELIGIBLE_SECTION)
    elif section_this_year:
        category_err = _quran_category_eligibility_error(user, data, exclude_app_id=exclude_id)
        if category_err:
            errors.append(category_err)

    dup_email = QuranContestApplication.query.filter(
        func.lower(QuranContestApplication.email) == email.lower(),
        QuranContestApplication.user_id != user.id,
    ).first()
    if dup_email:
        errors.append('Email-kan waxaa hore u isticmaalay xubin kale. La xiriir maamulka.')

    return errors


def _validate_quran_winners(year, w1, w2, w3):
    """Legacy 3-winner validation (kept for backward compatibility)."""
    return _validate_quran_section_winners(year, {
        'winner_juz10_first': w1, 'winner_juz10_second': w2, 'winner_juz10_third': w3,
    })


def _validate_quran_section_winners(year, winners):
    errors = []
    by_section = _quran_names_by_section(year)
    filled = []
    section_labels = {
        'winner_juz10_first': ('10 Juz', '1st', 'juz10'),
        'winner_juz10_second': ('10 Juz', '2nd', 'juz10'),
        'winner_juz10_third': ('10 Juz', '3rd', 'juz10'),
        'winner_juz20_first': ('20 Juz', '1st', 'juz20'),
        'winner_juz20_second': ('20 Juz', '2nd', 'juz20'),
        'winner_juz20_third': ('20 Juz', '3rd', 'juz20'),
        'winner_juz30_first': ('30 Juz', '1st', 'juz30'),
        'winner_juz30_second': ('30 Juz', '2nd', 'juz30'),
        'winner_juz30_third': ('30 Juz', '3rd', 'juz30'),
    }
    for field, (section_name, place, key) in section_labels.items():
        val = (winners.get(field) or '').strip()
        if val:
            filled.append(val)
            reg_names = by_section.get(key) or set()
            if reg_names and val not in reg_names:
                errors.append(f'{section_name} {place} must be a registered member in that section for {year}.')
    if len(filled) != len(set(filled)):
        errors.append('Guuleystayaasha waa in ay kala duwan yihiin.')
    return errors


def _verify_member_credentials(username, password):
    from extensions import bcrypt
    user = User.query.filter(func.lower(User.username) == username.lower().strip()).first()
    if not user or user.role not in MEMBER_ROLES:
        return None
    pwd = user.password or ''
    if pwd == password:
        return user
    if pwd.startswith('$2b$'):
        try:
            if bcrypt.check_password_hash(pwd, password):
                return user
        except Exception:
            pass
    return None


def _dufcad_label(name):
    m = re.search(r'(\d+)', name or '')
    if m:
        n = int(m.group(1))
        return f'{n}aad'
    return name


def _dufcad_display_label(convocation):
    """Human label e.g. Dufcadda 1."""
    m = re.search(r'(\d+)', convocation or '')
    if m:
        return f'Dufcadda {int(m.group(1))}'
    return (convocation or '').strip()


def _normalize_summer_convocation(convocation):
    """One spelling for summer apps: Dufcadda N, Guest, or Alnuur."""
    raw = (convocation or '').strip()
    if not raw:
        return ''
    if _is_alnuur_dufcad(raw):
        return 'Alnuur'
    if raw.lower() == 'guest' or raw == SUMMER_GUEST_DUFCAD:
        return SUMMER_GUEST_DUFCAD
    labeled = _dufcad_display_label(raw)
    return labeled or raw


def _dufcad_number_key(convocation):
    m = re.search(r'(\d+)', convocation or '')
    if m:
        return m.group(1)
    return (convocation or '').strip().lower()


def _validate_member_dufcad_match(user, submitted_convocation):
    """Reject when a member registers under a different dufcad than their profile."""
    if not user or not (user.convocation or '').strip():
        return None
    submitted = (submitted_convocation or '').strip()
    if not submitted:
        return None
    actual_label = _dufcad_display_label(user.convocation)
    submitted_label = _dufcad_display_label(submitted_convocation)
    if _is_alnuur_dufcad(user.convocation):
        if not _is_alnuur_dufcad(submitted):
            return (
                f'You are {actual_label}. You cannot register as {submitted_label}.'
            )
        return None
    if _is_alnuur_dufcad(submitted):
        return (
            f'You are {actual_label}. Alnuur registration is handled by admin — contact HSF.'
        )
    actual = _dufcad_number_key(user.convocation)
    submitted_key = _dufcad_number_key(submitted_convocation)
    if actual and submitted_key and actual != submitted_key:
        return (
            f'You are {actual_label}. You cannot register as {submitted_label}.'
        )
    return None


def _semester_for_registration(user, submitted_semester=None):
    if user and user.isGraduated:
        return 'Graduated'
    sem = (submitted_semester or '').strip()
    if sem:
        return sem
    return (user.semester or '').strip() if user else ''


@bp.route('/form-status', methods=['GET'])
def form_status():
    settings = _get_form_settings()
    help_open = bool(settings.help_open)
    quran_avail = _registration_availability('quran-contest')
    summer_avail = _registration_availability('summer-course')
    quran_meta = _latest_quran_contest_meta()
    quran_year = _active_quran_year() if quran_avail['open'] else None
    summer_meta = _latest_summer_program_meta()
    summer_year = _active_summer_year() if summer_avail['open'] else None
    quran_default_headline = 'Quran Contest Registration'
    if quran_meta and (quran_meta.title or '').strip():
        quran_default_headline = quran_meta.title.strip()
    elif quran_year:
        quran_default_headline = f'Quran Contest {quran_year}'
    return jsonify({
        'quran_contest': {
            'open': quran_avail['open'],
            'no_active_program': quran_avail['reason'] == 'no_program',
            'program_ended': quran_avail['reason'] == 'program_ended',
            'closed_message': quran_avail['closed_message'],
            'deadline_message': getattr(settings, 'quran_deadline_message', '') or '',
            'headline': getattr(settings, 'quran_headline', '') or quran_default_headline,
            'subtitle': _normalize_subtitle(getattr(settings, 'quran_subtitle', '')),
            'active_year': quran_year,
        },
        'summer_course': {
            'open': summer_avail['open'],
            'no_active_program': summer_avail['reason'] == 'no_program',
            'program_ended': summer_avail['reason'] == 'program_ended',
            'closed_message': summer_avail['closed_message'],
            'deadline_message': getattr(settings, 'summer_deadline_message', '') or '',
            'headline': getattr(settings, 'summer_headline', '') or (
                f'Summer Course {summer_year}' if summer_year else 'Summer Course Registration'
            ),
            'subtitle': _normalize_subtitle(getattr(settings, 'summer_subtitle', '')),
            'active_year': summer_year,
        },
        'help': {
            'open': help_open,
            'closed_message': 'Closed' if not help_open else '',
            'headline': getattr(settings, 'help_headline', '') or 'Cudurdaar Maqnaanshaha',
            'subtitle': _normalize_subtitle(getattr(settings, 'help_subtitle', '')),
            'default_meeting_date': getattr(settings, 'help_default_meeting_date', '') or '',
        },
    })


@bp.route('/form-settings', methods=['GET', 'POST'])
def form_settings():
    settings = _get_form_settings()
    if request.method == 'GET':
        return jsonify(settings.to_dict())

    data = request.json or {}
    if 'quran_contest_open' in data:
        settings.quran_contest_open = bool(data['quran_contest_open'])
    if 'summer_course_open' in data:
        settings.summer_course_open = bool(data['summer_course_open'])
    if 'help_open' in data:
        settings.help_open = bool(data['help_open'])
    if 'quran_closed_message' in data:
        settings.quran_closed_message = (data['quran_closed_message'] or '').strip()
    if 'summer_closed_message' in data:
        settings.summer_closed_message = (data['summer_closed_message'] or '').strip()
    if 'quran_headline' in data:
        settings.quran_headline = (data['quran_headline'] or '').strip() or 'Quran Contest Registration'
    if 'quran_subtitle' in data:
        settings.quran_subtitle = _normalize_subtitle(data.get('quran_subtitle'))
    if 'quran_deadline_message' in data:
        settings.quran_deadline_message = (data['quran_deadline_message'] or '').strip()
    if 'summer_headline' in data:
        settings.summer_headline = (data['summer_headline'] or '').strip() or 'Summer Course 2025'
    if 'summer_subtitle' in data:
        settings.summer_subtitle = _normalize_subtitle(data.get('summer_subtitle'))
    if 'summer_deadline_message' in data:
        settings.summer_deadline_message = (data['summer_deadline_message'] or '').strip()
    if 'help_headline' in data:
        settings.help_headline = (data['help_headline'] or '').strip() or 'Cudurdaar Maqnaanshaha'
    if 'help_subtitle' in data:
        settings.help_subtitle = _normalize_subtitle(data.get('help_subtitle'))
    if 'help_meeting_time' in data:
        settings.help_meeting_time = (data['help_meeting_time'] or '').strip() or '04:00pm'
    if 'help_default_meeting_date' in data:
        settings.help_default_meeting_date = (data['help_default_meeting_date'] or '').strip()
    if 'quran_allow_same_section_retry_below_30' in data:
        settings.quran_allow_same_section_retry_below_30 = bool(
            data['quran_allow_same_section_retry_below_30']
        )
    db.session.commit()
    return jsonify({'success': True, 'settings': settings.to_dict()})


def init_applications_schema():
    """Add new settings columns on existing databases."""
    from sqlalchemy import inspect, text
    insp = inspect(db.engine)
    if 'application_form_settings' not in insp.get_table_names():
        return
    cols = {c['name'] for c in insp.get_columns('application_form_settings')}
    stmts = []
    default_deadline = 'Waqtiga uu dhammaanayo ee diiwaangelinta waa 15 January 2026.'
    if 'quran_deadline_message' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    'ALTER TABLE application_form_settings ADD COLUMN quran_deadline_message TEXT'
                ))
                conn.execute(text(
                    'UPDATE application_form_settings SET quran_deadline_message = :msg WHERE id = 1'
                ), {'msg': default_deadline})
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (quran_deadline_message): {e}')
    default_summer_deadline = 'Waqtiga uu dhammaanayo ee diiwaangelinta waa 30 June 2026.'
    if 'summer_deadline_message' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    'ALTER TABLE application_form_settings ADD COLUMN summer_deadline_message TEXT'
                ))
                conn.execute(text(
                    'UPDATE application_form_settings SET summer_deadline_message = :msg WHERE id = 1'
                ), {'msg': default_summer_deadline})
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (summer_deadline_message): {e}')
    if 'quran_headline' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN quran_headline VARCHAR(200) "
                    "NOT NULL DEFAULT 'Quran Contest Registration'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (quran_headline): {e}')
    if 'quran_subtitle' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN quran_subtitle VARCHAR(200) "
                    "NOT NULL DEFAULT 'Naadiga Ardayda Deeqda Waxbarasho HSF'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (quran_subtitle): {e}')
    if 'summer_headline' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN summer_headline VARCHAR(200) "
                    "NOT NULL DEFAULT 'Summer Course 2025'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (summer_headline): {e}')
    if 'summer_subtitle' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN summer_subtitle VARCHAR(200) "
                    "NOT NULL DEFAULT 'Naadiga Ardayda Deeqda Waxbarasho HSF'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (summer_subtitle): {e}')
    if 'help_headline' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN help_headline VARCHAR(200) "
                    "NOT NULL DEFAULT 'Cudurdaar Maqnaanshaha'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (help_headline): {e}')
    if 'help_subtitle' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN help_subtitle VARCHAR(200) "
                    "NOT NULL DEFAULT 'Naadiga Ardayda Deeqda Waxbarasho HSF'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (help_subtitle): {e}')
    if 'help_meeting_time' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE application_form_settings ADD COLUMN help_meeting_time VARCHAR(50) "
                    "NOT NULL DEFAULT '04:00pm'"
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (help_meeting_time): {e}')
    if 'help_default_meeting_date' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    'ALTER TABLE application_form_settings ADD COLUMN help_default_meeting_date VARCHAR(20)'
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (help_default_meeting_date): {e}')
    if 'quran_allow_same_section_retry_below_30' not in cols:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(
                    'ALTER TABLE application_form_settings '
                    'ADD COLUMN quran_allow_same_section_retry_below_30 BOOLEAN NOT NULL DEFAULT 0'
                ))
                conn.commit()
        except Exception as e:
            print(f'init_applications_schema (quran_allow_same_section_retry_below_30): {e}')
    try:
        legacy = list(LEGACY_ORG_SUBTITLES)
        placeholders = ', '.join(f':legacy_{i}' for i in range(len(legacy)))
        params = {f'legacy_{i}': v for i, v in enumerate(legacy)}
        params['official'] = CLUB_OFFICIAL_NAME
        with db.engine.connect() as conn:
            for col in ('quran_subtitle', 'summer_subtitle', 'help_subtitle'):
                conn.execute(text(
                    f'UPDATE application_form_settings SET {col} = :official '
                    f'WHERE {col} IN ({placeholders}) OR {col} IS NULL OR TRIM({col}) = \'\''
                ), params)
            conn.commit()
    except Exception as e:
        print(f'init_applications_schema (normalize_subtitles): {e}')
    if 'member_help_request' in insp.get_table_names():
        mcols = {c['name'] for c in insp.get_columns('member_help_request')}
        if 'response_status' not in mcols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        "ALTER TABLE member_help_request ADD COLUMN response_status VARCHAR(20) "
                        "NOT NULL DEFAULT 'pending'"
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (response_status): {e}')
        if 'meeting_date' not in mcols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        'ALTER TABLE member_help_request ADD COLUMN meeting_date VARCHAR(20)'
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (help meeting_date): {e}')
        if 'meeting_id' not in mcols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        'ALTER TABLE member_help_request ADD COLUMN meeting_id INTEGER'
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (help meeting_id): {e}')
    tables = set(insp.get_table_names())
    if 'quran_contest_year' not in tables:
        try:
            QuranContestYear.__table__.create(db.engine)
        except Exception as e:
            print(f'init_applications_schema (quran_contest_year table): {e}')
    if 'summer_course_year' not in tables:
        try:
            SummerCourseYear.__table__.create(db.engine)
        except Exception as e:
            print(f'init_applications_schema (summer_course_year table): {e}')
    if 'quran_contest_year' in tables:
        qcols = {c['name'] for c in insp.get_columns('quran_contest_year')}
        q_migrations = [
            ('contest_date', 'ALTER TABLE quran_contest_year ADD COLUMN contest_date DATE'),
            ('winner_juz10_first', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz10_first VARCHAR(200) DEFAULT ""'),
            ('winner_juz10_second', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz10_second VARCHAR(200) DEFAULT ""'),
            ('winner_juz10_third', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz10_third VARCHAR(200) DEFAULT ""'),
            ('winner_juz20_first', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz20_first VARCHAR(200) DEFAULT ""'),
            ('winner_juz20_second', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz20_second VARCHAR(200) DEFAULT ""'),
            ('winner_juz20_third', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz20_third VARCHAR(200) DEFAULT ""'),
            ('winner_juz30_first', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz30_first VARCHAR(200) DEFAULT ""'),
            ('winner_juz30_second', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz30_second VARCHAR(200) DEFAULT ""'),
            ('winner_juz30_third', 'ALTER TABLE quran_contest_year ADD COLUMN winner_juz30_third VARCHAR(200) DEFAULT ""'),
        ]
        for col, sql in q_migrations:
            if col not in qcols:
                try:
                    with db.engine.connect() as conn:
                        conn.execute(text(sql))
                        conn.commit()
                except Exception as e:
                    print(f'init_applications_schema ({col}): {e}')
    if 'summer_course_application' in tables:
        scols = {c['name'] for c in insp.get_columns('summer_course_application')}
        s_migrations = [
            ('semester', 'ALTER TABLE summer_course_application ADD COLUMN semester VARCHAR(80)'),
            ('attendance_day1', 'ALTER TABLE summer_course_application ADD COLUMN attendance_day1 TINYINT(1) DEFAULT 0'),
            ('attendance_day2', 'ALTER TABLE summer_course_application ADD COLUMN attendance_day2 TINYINT(1) DEFAULT 0'),
            ('attendance_day3', 'ALTER TABLE summer_course_application ADD COLUMN attendance_day3 TINYINT(1) DEFAULT 0'),
            ('attendance_day4', 'ALTER TABLE summer_course_application ADD COLUMN attendance_day4 TINYINT(1) DEFAULT 0'),
            ('attendance_day5', 'ALTER TABLE summer_course_application ADD COLUMN attendance_day5 TINYINT(1) DEFAULT 0'),
            ('attendance_day6', 'ALTER TABLE summer_course_application ADD COLUMN attendance_day6 TINYINT(1) DEFAULT 0'),
            ('absence_notified_days', 'ALTER TABLE summer_course_application ADD COLUMN absence_notified_days VARCHAR(40) DEFAULT ""'),
        ]
        for col, sql in s_migrations:
            if col not in scols:
                try:
                    with db.engine.connect() as conn:
                        conn.execute(text(sql))
                        conn.commit()
                except Exception as e:
                    print(f'init_applications_schema (summer {col}): {e}')
    if 'summer_course_year' in tables:
        scy_cols = {c['name'] for c in insp.get_columns('summer_course_year')}
        if 'start_date' not in scy_cols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE summer_course_year ADD COLUMN start_date DATE'))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (summer start_date): {e}')
        if 'created_at' not in scy_cols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE summer_course_year ADD COLUMN created_at DATETIME'))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (summer created_at): {e}')
        if 'program_closed' not in scy_cols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        'ALTER TABLE summer_course_year ADD COLUMN program_closed BOOLEAN NOT NULL DEFAULT 0'
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (summer program_closed): {e}')
        if 'day6_attendance_saved_at' not in scy_cols:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        'ALTER TABLE summer_course_year ADD COLUMN day6_attendance_saved_at DATETIME NULL'
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (summer day6_attendance_saved_at): {e}')
    if 'quran_contest_year' in tables:
        qcols2 = {c['name'] for c in insp.get_columns('quran_contest_year')}
        if 'created_at' not in qcols2:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE quran_contest_year ADD COLUMN created_at DATETIME'))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (quran created_at): {e}')
        if 'title' not in qcols2:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE quran_contest_year ADD COLUMN title VARCHAR(200) DEFAULT ""'))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (quran title): {e}')
        if 'contest_closed' not in qcols2:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        'ALTER TABLE quran_contest_year ADD COLUMN contest_closed BOOLEAN NOT NULL DEFAULT 0'
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (quran contest_closed): {e}')
        if 'winners_completed_at' not in qcols2:
            try:
                with db.engine.connect() as conn:
                    conn.execute(text(
                        'ALTER TABLE quran_contest_year ADD COLUMN winners_completed_at DATETIME NULL'
                    ))
                    conn.commit()
            except Exception as e:
                print(f'init_applications_schema (quran winners_completed_at): {e}')
    _backfill_year_created_at()
    _backfill_normalize_dufcad_labels()


@bp.route('/verify-member', methods=['POST'])
def verify_member():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    form_type = (data.get('form_type') or '').strip()

    if not username or not password:
        return jsonify({'error': 'Username and password are required.'}), 400

    closed = _registration_closed_response(form_type)
    if closed:
        return closed

    user = _verify_member_credentials(username, password)
    if not user:
        return jsonify({'error': 'Invalid username or password. Use your Member Portal account.'}), 401

    if not user.email:
        return jsonify({'error': 'No email on your member profile. Contact admin to add your email first.'}), 400

    form_labels = {
        'quran-contest': 'Quran Contest Registration',
        'summer-course': 'Summer Course Registration',
        'help': 'Member Help',
    }
    try:
        _send_form_otp_email(user, form_labels.get(form_type, 'HSF Form'))
    except Exception as e:
        return jsonify({'error': f'Could not send verification email: {e}'}), 500

    return jsonify({
        'success': True,
        'user_id': user.id,
        'username': user.username,
        'name': user.name,
        'email_masked': _mask_email(user.email),
        'message': f'Verification code sent to {_mask_email(user.email)}',
    })


@bp.route('/verify-email-code', methods=['POST'])
def verify_email_code():
    data = request.json or {}
    user_id = data.get('user_id')
    otp = (data.get('otp') or '').strip()
    form_type = (data.get('form_type') or '').strip()

    closed = _registration_closed_response(form_type)
    if closed:
        return closed

    user = _member_user(user_id=user_id)
    if not user:
        return jsonify({'error': 'Invalid session. Please log in again.'}), 403

    if not user.otp_code:
        return jsonify({'error': 'No verification code pending. Request a new code.'}), 400
    if user.otp_attempts >= 5:
        return jsonify({'error': 'Too many attempts. Request a new code.'}), 403
    if user.otp_expiry and datetime.utcnow() > user.otp_expiry:
        return jsonify({'error': 'Code expired. Request a new code.'}), 410
    if user.otp_code != otp:
        user.otp_attempts += 1
        db.session.commit()
        return jsonify({'error': 'Invalid verification code.'}), 401

    user.otp_code = None
    user.otp_expiry = None
    user.otp_attempts = 0
    db.session.commit()

    token = _make_access_token(user.id, form_type)
    return jsonify({
        'success': True,
        'access_token': token,
        'user': {
            'id': user.id,
            'username': user.username,
            'name': user.name,
            'email': user.email,
            'phone': user.phone,
            'faculty': user.faculty,
            'university': user.university,
            'semester': 'Graduated' if user.isGraduated else (user.semester or ''),
            'isGraduated': bool(user.isGraduated),
            'convocation': user.convocation,
            'role': user.role,
        },
    })


@bp.route('/convocation-options', methods=['GET'])
def convocation_options():
    include_extra = request.args.get('include_extra', '').lower() in ('1', 'true', 'yes')
    names = [c.name for c in Convocation.query.order_by(Convocation.year, Convocation.name).all()]
    options = []
    seen = set()
    for name in names:
        label = _dufcad_label(name)
        if label not in seen:
            options.append({'value': label, 'label': label, 'source_name': name})
            seen.add(label)
    if include_extra:
        for extra in EXTRA_DUFCADS:
            if extra not in seen:
                options.append({'value': extra, 'label': extra, 'source_name': extra})
                seen.add(extra)
    return jsonify(options)


def _is_alnuur_dufcad(convocation):
    return (convocation or '').strip().lower() in ('alnuur', 'al-nuur')


def _users_with_email(email):
    normalized = (email or '').strip().lower()
    if not normalized or '@' not in normalized:
        return []
    return User.query.filter(func.lower(User.email) == normalized).all()


def _hsf_member_with_email(email):
    for user in _users_with_email(email):
        if user.role in User.HSF_MEMBER_ROLES:
            return user
    return None


def _alnuur_guest_with_email(email):
    for user in _users_with_email(email):
        if user.is_alnuur_guest():
            return user
    return None


def _summer_guest_with_email(email):
    for user in _users_with_email(email):
        if user.is_summer_guest():
            return user
    return None


def _unique_username_from_email(email, fallback='user'):
    base_username = re.sub(r'[^a-z0-9]', '', email.split('@')[0].lower())[:40] or fallback
    username = base_username
    n = 0
    while User.query.filter_by(username=username).first():
        n += 1
        username = f'{base_username}{n}'[:48]
    return username


def _create_alnuur_guest_user(email, full_name, data):
    """New Alnuur stub — independent from summer-guest users with the same email."""
    user = User(
        id=f'alnuur-{uuid.uuid4().hex[:12]}',
        name=full_name,
        username=_unique_username_from_email(email, 'alnuur'),
        password='!',
        role=User.ALNUUR_GUEST_ROLE,
        convocation=None,
        email=email,
        phone=(data.get('whatsapp') or data.get('telephone') or '').strip(),
        university=(data.get('university') or '').strip() or None,
        faculty=(data.get('faculty') or '').strip() or None,
        semester=(data.get('semester') or '').strip() or None,
    )
    db.session.add(user)
    db.session.flush()
    return user


def _update_alnuur_guest_user(user, full_name, data):
    if full_name:
        user.name = full_name
    if user.role != User.ALNUUR_GUEST_ROLE:
        user.role = User.ALNUUR_GUEST_ROLE
    if data.get('whatsapp') or data.get('telephone'):
        user.phone = (data.get('whatsapp') or data.get('telephone') or user.phone or '').strip()
    for field in ('university', 'faculty', 'semester'):
        val = (data.get(field) or '').strip()
        if val:
            setattr(user, field, val)
    db.session.flush()
    return user


def _resolve_admin_quran_user(data):
    """Member from search, or create/find stub user for Alnuur manual registration."""
    user = _member_user(data.get('user_id'), data.get('username'))
    if user:
        return user, None

    convocation = (data.get('convocation') or '').strip()
    if not _is_alnuur_dufcad(convocation):
        return None, 'Search and select a member, or choose Alnuur for manual registration.'

    email = (data.get('email') or '').strip().lower()
    full_name = (data.get('full_name') or '').strip()
    if not email or '@' not in email:
        return None, 'Email is required for Alnuur registration.'
    if len(full_name) < 2:
        return None, 'Full name is required.'

    hsf_member = _hsf_member_with_email(email)
    if hsf_member:
        return None, (
            'This email belongs to an existing HSF member. They are not from Alnuur — '
            'use member search with their HSF dufcad instead.'
        )

    alnuur_user = _alnuur_guest_with_email(email)
    if alnuur_user:
        return _update_alnuur_guest_user(alnuur_user, full_name, data), None

    # Summer guests use a separate user row — Quran Alnuur registration stays independent.
    return _create_alnuur_guest_user(email, full_name, data), None


def _update_summer_guest_user(user, name, faculty, university, semester):
    if name:
        user.name = name
    if user.role != User.SUMMER_GUEST_ROLE and not user.is_alnuur_guest():
        user.role = User.SUMMER_GUEST_ROLE
    if faculty:
        user.faculty = faculty
    if university:
        user.university = university
    if semester:
        user.semester = semester
        user.isGraduated = semester.lower() == 'graduated'
    db.session.flush()
    return user


def _resolve_admin_summer_user(data):
    """HSF member from search, or create/find stub user for non-member summer guests."""
    user = _member_user(data.get('user_id'), data.get('username'))
    if user:
        return user, None

    if not data.get('guest_registration'):
        return None, 'Search and select an HSF member, or enable guest registration for non-members.'

    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    faculty = (data.get('faculty') or '').strip()
    university = (data.get('university') or '').strip()
    semester = (data.get('semester') or '').strip()

    if len(name) < 2:
        return None, 'Name is required.'
    if not faculty or not university:
        return None, 'Faculty and university are required.'
    if email and '@' not in email:
        return None, 'Enter a valid email, or leave it blank.'

    if email:
        hsf_member = _hsf_member_with_email(email)
        if hsf_member:
            return None, (
                'This email belongs to an HSF member — search and select them instead of guest registration.'
            )

        summer_guest = _summer_guest_with_email(email)
        if summer_guest:
            return _update_summer_guest_user(summer_guest, name, faculty, university, semester), None

        alnuur_guest = _alnuur_guest_with_email(email)
        if alnuur_guest:
            if name:
                alnuur_guest.name = name
            if faculty:
                alnuur_guest.faculty = faculty
            if university:
                alnuur_guest.university = university
            if semester:
                alnuur_guest.semester = semester
                alnuur_guest.isGraduated = semester.lower() == 'graduated'
            db.session.flush()
            return alnuur_guest, None

    user = User(
        id=f'summer-guest-{uuid.uuid4().hex[:12]}',
        name=name,
        username=_unique_username_from_email(email or '', 'guest'),
        password='!',
        role=User.SUMMER_GUEST_ROLE,
        convocation=None,
        email=email or None,
        university=university,
        faculty=faculty,
        semester=semester or None,
        isGraduated=semester.lower() == 'graduated' if semester else False,
    )
    db.session.add(user)
    db.session.flush()
    return user, None


@bp.route('/quran-contest', methods=['GET', 'POST'])
def quran_contest():
    if request.method == 'GET':
        _repair_stale_quran_past_fields()
        rows = QuranContestApplication.query.order_by(QuranContestApplication.created_at.desc()).all()
        return jsonify([r.to_dict() for r in rows])

    data = request.json or {}
    closed = _registration_closed_response('quran-contest')
    if closed:
        return closed

    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Members only — please verify your account first.'}), 403
    if not _verify_access_token(data.get('access_token'), user.id, 'quran-contest'):
        return jsonify({'error': 'Email verification required. Please verify again.'}), 403

    full_name = (data.get('full_name') or user.name or '').strip()
    email = (user.email or '').strip()
    prefill = _quran_profile_snapshot(user)
    whatsapp = (data.get('whatsapp') or prefill['whatsapp'] or '').strip()
    telephone = (data.get('telephone') or prefill['telephone'] or '').strip()
    convocation = prefill['convocation'] or (user.convocation or '').strip()
    faculty = prefill['faculty']
    university = prefill['university']
    semester = prefill['semester']
    participated_before = prefill['participated_before']
    previous_section = prefill['previous_section']
    won_before = prefill['won_before']
    section_this_year = (data.get('section_this_year') or '').strip()

    if len(full_name) < 2:
        return jsonify({'error': 'Full name is required.'}), 400
    if not email or '@' not in email:
        return jsonify({'error': 'No email on your member profile. Contact admin to add your email first.'}), 400
    if not whatsapp or not telephone:
        return jsonify({'error': 'WhatsApp and telephone numbers are required.'}), 400
    if not convocation:
        return jsonify({'error': 'Dufcad is required.'}), 400
    dufcad_err = _validate_member_dufcad_match(user, convocation)
    if dufcad_err:
        return jsonify({'error': dufcad_err}), 400
    if _is_alnuur_dufcad(convocation):
        return jsonify({
            'error': (
                'You are an HSF member, not from Alnuur. '
                'Alnuur registration is handled by admin — contact HSF.'
            ),
        }), 400
    if not faculty or not university:
        return jsonify({'error': 'Faculty and university are required.'}), 400
    if participated_before not in ('Haa', 'Maya'):
        return jsonify({'error': 'Please answer whether you participated before.'}), 400
    if not section_this_year:
        return jsonify({'error': 'Please choose which section you want to compete in.'}), 400

    active_year = _active_quran_year()
    existing = _quran_app_for_user_year(user.id, active_year)
    if existing:
        return jsonify({
            'error': 'Horey ayaad iskaga diiwaangelisay tartanka sanadkan. Haddii uu qalad jiro, la xiriir maamulka naadiga HSF.',
            'already_registered': True,
            'application': existing.to_dict(),
        }), 409

    validation_errors = _validate_quran_registration(user, {
        'full_name': full_name,
        'email': email,
        'whatsapp': whatsapp,
        'telephone': telephone,
        'convocation': convocation,
        'university': university,
        'faculty': faculty,
        'semester': semester,
        'participated_before': participated_before,
        'previous_section': previous_section,
        'won_before': won_before,
        'section_this_year': section_this_year,
    })
    if validation_errors:
        return jsonify({'error': validation_errors[0], 'errors': validation_errors}), 400

    user.faculty = faculty
    user.university = university

    row = QuranContestApplication(
        user_id=user.id,
        email=email,
        full_name=full_name,
        whatsapp=whatsapp,
        telephone=telephone,
        convocation=convocation,
        participated_before=participated_before,
        previous_section=previous_section,
        won_before=won_before,
        section_this_year=section_this_year,
    )
    row.created_at = _registration_created_at(active_year, default_month=1, default_day=15)
    db.session.add(row)
    db.session.commit()

    try:
        notify_main_leader(
            current_app._get_current_object(),
            f'Quran contest registration: {full_name}',
            f'Member: {user.username}\nDufcad: {convocation}\nUniversity: {university}\nFaculty: {faculty}\nSection: {section_this_year}',
            'registration',
        )
    except Exception:
        pass

    try:
        _send_quran_confirmation_email(user, row)
    except Exception:
        pass

    return jsonify({
        'success': True,
        'message': QURAN_SUCCESS_MSG,
        'application': row.to_dict(),
    }), 201


@bp.route('/quran-contest/mine', methods=['POST'])
def quran_contest_mine():
    data = request.json or {}
    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Members only.'}), 403
    if not _verify_access_token(data.get('access_token'), user.id, 'quran-contest'):
        return jsonify({'error': 'Email verification required.'}), 403
    row = _quran_app_for_user_year(user.id)
    prefill = _quran_profile_snapshot(user)
    return jsonify({
        'registration': row.to_dict() if row else None,
        'already_registered': row is not None,
        'prefill': prefill,
    })


@bp.route('/quran-contest/eligibility', methods=['POST'])
def quran_contest_eligibility():
    """Profile prefill + allowed sections for self-registration or admin add/edit."""
    data = request.json or {}
    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Member not found.'}), 404

    access_token = data.get('access_token')
    if access_token and not _verify_access_token(access_token, user.id, 'quran-contest'):
        return jsonify({'error': 'Email verification required.'}), 403

    exclude_app_id = data.get('exclude_app_id')
    try:
        exclude_app_id = int(exclude_app_id) if exclude_app_id is not None else None
    except (TypeError, ValueError):
        exclude_app_id = None

    prefill = _quran_profile_snapshot(user, exclude_app_id)
    return jsonify({'prefill': prefill})


def _quran_user_lookup_by_email(email):
    """Resolve a portal user by email for admin contest prefill."""
    normalized = (email or '').strip().lower()
    if not normalized or '@' not in normalized:
        return None, None
    hsf = _hsf_member_with_email(normalized)
    if hsf:
        return hsf, 'hsf'
    alnuur = _alnuur_guest_with_email(normalized)
    if alnuur:
        return alnuur, 'alnuur'
    for user in _users_with_email(normalized):
        if _quran_highest_past_level(user.id) > 0:
            return user, 'other'
    return None, None


@bp.route('/quran-contest/eligibility-by-email', methods=['POST'])
def quran_contest_eligibility_by_email():
    """Admin: prefill contest history when email matches an existing user."""
    data = request.json or {}
    email = (data.get('email') or '').strip()
    if not email or '@' not in email:
        return jsonify({'error': 'Valid email is required.'}), 400

    user, kind = _quran_user_lookup_by_email(email)
    if not user:
        return jsonify({'prefill': None, 'found': False})

    prefill = _quran_profile_snapshot(user)
    has_history = (prefill.get('participated_before') == 'Haa'
                   or (prefill.get('highest_past_level') or 0) > 0)
    return jsonify({
        'found': True,
        'kind': kind,
        'is_hsf_member': kind == 'hsf',
        'has_contest_history': has_history,
        'prefill': prefill,
        'user_name': (user.name or '').strip(),
    })


@bp.route('/quran-contest/<int:app_id>', methods=['PUT', 'DELETE'])
def update_quran_contest(app_id):
    row = QuranContestApplication.query.get_or_404(app_id)
    user = User.query.get(row.user_id)
    if not user:
        return jsonify({'error': 'Member not found.'}), 404

    if request.method == 'DELETE':
        try:
            _send_quran_delete_email(user, row)
        except Exception:
            pass
        db.session.delete(row)
        db.session.commit()
        return jsonify({'success': True, 'email_sent': True})

    data = request.json or {}
    full_name = (data.get('full_name') or row.full_name or '').strip()
    email = (data.get('email') or row.email or user.email or '').strip()
    is_alnuur_reg = _is_alnuur_dufcad(row.convocation) or _is_alnuur_dufcad(user.convocation)
    if is_alnuur_reg:
        whatsapp = (data.get('whatsapp') or row.whatsapp or '').strip()
        telephone = (data.get('telephone') or row.telephone or '').strip()
        convocation = (data.get('convocation') or row.convocation or '').strip()
        participated_before, previous_section, won_before = _normalize_quran_past_fields(
            data.get('participated_before') or row.participated_before,
            data.get('previous_section') if 'previous_section' in data else row.previous_section,
            data.get('won_before') if 'won_before' in data else row.won_before,
        )
    else:
        prefill = _quran_profile_snapshot(user, exclude_app_id=row.id)
        whatsapp = prefill['whatsapp']
        telephone = prefill['telephone']
        convocation = prefill['convocation']
        participated_before = prefill['participated_before']
        previous_section = prefill['previous_section']
        won_before = prefill['won_before']
    section_this_year = (data.get('section_this_year') or row.section_this_year or '').strip()

    if len(full_name) < 2:
        return jsonify({'error': 'Full name is required.'}), 400
    if not email or '@' not in email:
        return jsonify({'error': 'Valid email is required.'}), 400
    if not whatsapp or not telephone:
        return jsonify({'error': 'WhatsApp and telephone are required.'}), 400
    if not convocation:
        return jsonify({'error': 'Dufcad is required.'}), 400
    dufcad_err = _validate_member_dufcad_match(user, convocation)
    if dufcad_err:
        return jsonify({'error': dufcad_err}), 400
    if participated_before not in ('Haa', 'Maya'):
        return jsonify({'error': 'Participated before must be Haa or Maya.'}), 400
    if not section_this_year:
        return jsonify({'error': 'Section is required.'}), 400

    validation_errors = _validate_quran_registration(user, {
        'full_name': full_name,
        'email': email,
        'whatsapp': whatsapp,
        'telephone': telephone,
        'convocation': convocation,
        'university': (user.university or '').strip(),
        'faculty': (user.faculty or '').strip(),
        'semester': _semester_for_registration(user),
        'participated_before': participated_before,
        'previous_section': previous_section,
        'won_before': won_before,
        'section_this_year': section_this_year,
    }, existing_row=row, admin_edit=True, skip_locked=is_alnuur_reg)
    if validation_errors:
        return jsonify({'error': validation_errors[0], 'errors': validation_errors}), 400

    row.email = email
    row.full_name = full_name
    row.whatsapp = whatsapp
    row.telephone = telephone
    row.convocation = convocation
    row.participated_before = participated_before
    row.previous_section = previous_section
    row.won_before = won_before
    row.section_this_year = section_this_year
    db.session.commit()

    try:
        _send_quran_update_email(user, row)
    except Exception:
        pass

    return jsonify({
        'success': True,
        'message': QURAN_SUCCESS_MSG,
        'application': row.to_dict(),
        'email_sent': True,
    })


@bp.route('/summer-course', methods=['GET', 'POST'])
def summer_course():
    if request.method == 'GET':
        rows = SummerCourseApplication.query.order_by(SummerCourseApplication.created_at.desc()).all()
        return jsonify([r.to_dict() for r in rows])

    data = request.json or {}
    closed = _registration_closed_response('summer-course')
    if closed:
        return closed

    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Members only — please verify your account first.'}), 403
    if not _verify_access_token(data.get('access_token'), user.id, 'summer-course'):
        return jsonify({'error': 'Email verification required. Please verify again.'}), 403

    name = (data.get('name') or user.name or '').strip()
    email = (user.email or '').strip()
    convocation = (data.get('convocation') or user.convocation or '').strip()
    faculty = (data.get('faculty') or user.faculty or '').strip()
    university = (data.get('university') or user.university or '').strip()

    if len(name) < 2:
        return jsonify({'error': 'Name is required.'}), 400
    if not email or '@' not in email:
        return jsonify({'error': 'No email on your member profile. Contact admin to add your email first.'}), 400
    if not convocation:
        return jsonify({'error': 'Dufcad is required.'}), 400
    dufcad_err = _validate_member_dufcad_match(user, convocation)
    if dufcad_err:
        return jsonify({'error': dufcad_err}), 400
    convocation = _normalize_summer_convocation(convocation)
    if not faculty or not university:
        return jsonify({'error': 'Faculty and university are required.'}), 400

    active_year = _active_summer_year()
    existing = _summer_app_for_user_year(user.id, active_year)
    if existing:
        return jsonify({
            'error': 'You have already registered for the summer course this year. Contact HSF admin if this is a mistake.',
            'already_registered': True,
            'application': existing.to_dict(),
        }), 409

    row = SummerCourseApplication(
        user_id=user.id,
        email=email,
        name=name,
        convocation=convocation,
        faculty=faculty,
        university=university,
        semester=_semester_for_registration(user, data.get('semester')) or None,
    )
    row.created_at = _registration_created_at(active_year, default_month=6, default_day=1)
    db.session.add(row)
    db.session.commit()

    try:
        notify_main_leader(
            current_app._get_current_object(),
            f'Summer course registration: {name}',
            f'Member: {user.username}\nUniversity: {university}\nFaculty: {faculty}',
            'registration',
        )
    except Exception:
        pass

    try:
        _send_summer_confirmation_email(user, row)
    except Exception:
        pass

    return jsonify({'success': True, 'application': row.to_dict(), 'email_sent': True}), 201


def _meeting_attendance_finalized(meet):
    return bool(
        meet
        and (getattr(meet, 'attendance_taken', False) or (getattr(meet, 'participantsCount', 0) or 0) > 0)
    )


def _approved_help_meeting_ids(user_id):
    ids = set()
    for req in MemberHelpRequest.query.filter_by(user_id=user_id).all():
        if (req.response_status or '').lower() != 'approved':
            continue
        if req.meeting_id:
            ids.add(req.meeting_id)
            continue
        date_iso = _parse_help_meeting_date_iso(req)
        if not date_iso:
            continue
        for meet in Meeting.query.filter_by(date=date_iso).all():
            ids.add(meet.id)
    return ids


def _meeting_eligible_for_apology(meet, user, attendance_keys=None):
    """Live roster rules for apology — not limited to saved attendance rows."""
    if not meet or not user:
        return False
    from utils.convocation_helpers import convocations_match
    if not convocations_match(meet.convocation, user.convocation):
        return False
    target = (getattr(meet, 'target_audience', None) or 'active').lower()
    if target == 'graduated' and not user.isGraduated:
        return False
    if target == 'active' and user.isGraduated:
        return False
    return True


def _meeting_applies_to_member(meet, user, attendance_keys=None):
    if not meet or not user:
        return False

    if _meeting_attendance_finalized(meet):
        if attendance_keys is not None:
            return (meet.id, user.id) in attendance_keys
        return Attendance.query.filter_by(meeting_id=meet.id, student_id=user.id).first() is not None

    from utils.convocation_helpers import convocations_match
    if not convocations_match(meet.convocation, user.convocation):
        return False
    target = (getattr(meet, 'target_audience', None) or 'active').lower()
    if target == 'graduated' and not user.isGraduated:
        return False
    if target == 'active' and user.isGraduated:
        return False
    return True


def _parse_meeting_date_value(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(str(date_str)[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


def _member_eligible_on_meeting_date(user, meet, attendance_keys, for_apology=False):
    m_date = _parse_meeting_date_value(meet.date)
    if not m_date:
        return False
    if user.created_at:
        reg_date = user.created_at.date()
        if m_date < reg_date:
            return False
        if m_date == reg_date and (meet.id, user.id) not in attendance_keys:
            # Open scheduled meeting on registration day — member may still apologize.
            if for_apology and not _meeting_attendance_finalized(meet):
                return True
            return False
    return True


def _meeting_context_payload(user, meet, att, attendance_finalized):
    pending = MemberHelpRequest.query.filter_by(
        user_id=user.id,
        meeting_id=meet.id,
        response_status='pending',
    ).first()
    return {
        'meeting_id': meet.id,
        'meeting_date': str(meet.date)[:10],
        'topic': meet.topic,
        'place': meet.place or '',
        'presenter': meet.presenter or '',
        'attendance_id': att.id if att else None,
        'attendance_finalized': attendance_finalized,
        'has_pending_apology': pending is not None,
        'pending_request_id': pending.id if pending else None,
    }


def _pick_best_meeting_candidate(candidates, today):
    """Prefer most recent past; otherwise nearest upcoming scheduled meeting."""
    if not candidates:
        return None
    past = [c for c in candidates if c[0] <= today]
    if past:
        past.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return past[0]
    future = sorted(candidates, key=lambda x: (x[0], x[1]))
    return future[0]


def _scheduled_meeting_for_apology(user):
    """
    Link apology form to a real meeting from Meetings:
    1) Best open Scheduled meeting (attendance not yet recorded — current/upcoming)
    2) Otherwise the most recent missed meeting (attendance already recorded)
    """
    approved_ids = _approved_help_meeting_ids(user.id)
    user_attendance = Attendance.query.filter_by(student_id=user.id).all()
    attendance_keys = {(a.meeting_id, a.student_id) for a in user_attendance}
    att_map = {(a.meeting_id, a.student_id): a for a in user_attendance}
    today = datetime.utcnow().date()

    missed_finalized = []
    open_scheduled = []

    for meet in Meeting.query.all():
        if meet.id in approved_ids:
            continue
        if not _meeting_eligible_for_apology(meet, user, attendance_keys):
            continue
        if not _member_eligible_on_meeting_date(user, meet, attendance_keys, for_apology=True):
            continue

        att = att_map.get((meet.id, user.id))
        if att and att.is_excused:
            continue
        if att and att.status in ('Present', 'Late'):
            continue

        m_date = _parse_meeting_date_value(meet.date)
        if not m_date:
            continue

        if _meeting_attendance_finalized(meet):
            if m_date <= today:
                missed_finalized.append((m_date, meet.id, meet, att))
        else:
            open_scheduled.append((m_date, meet.id, meet, att))

    picked = _pick_best_meeting_candidate(open_scheduled, today)
    if picked:
        _, _, meet, att = picked
        return _meeting_context_payload(user, meet, att, attendance_finalized=False)

    picked = _pick_best_meeting_candidate(missed_finalized, today)
    if picked:
        _, _, meet, att = picked
        return _meeting_context_payload(user, meet, att, attendance_finalized=True)

    return None


@bp.route('/help/absence-context', methods=['POST'])
def help_absence_context():
    """Return the absent meeting to apologize for (autofill date + link approve flow)."""
    data = request.json or {}
    is_open, closed_msg = _is_form_open('help')
    if not is_open:
        return jsonify({'error': closed_msg, 'closed': True}), 403

    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Members only.'}), 403
    if not _verify_access_token(data.get('access_token'), user.id, 'help'):
        return jsonify({'error': 'Email verification required.'}), 403

    ctx = _scheduled_meeting_for_apology(user)
    if ctx:
        return jsonify({'linked': True, **ctx})

    return jsonify({
        'linked': False,
        'meeting_id': None,
        'meeting_date': '',
        'topic': '',
        'place': '',
        'has_pending_apology': False,
        'message': 'No scheduled meeting found for your absence.',
    })


@bp.route('/help', methods=['GET', 'POST'])
def member_help():
    if request.method == 'GET':
        rows = MemberHelpRequest.query.order_by(MemberHelpRequest.created_at.desc()).all()
        return jsonify([r.to_dict() for r in rows])

    data = request.json or {}
    is_open, closed_msg = _is_form_open('help')
    if not is_open:
        return jsonify({'error': closed_msg, 'closed': True}), 403

    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Members only — please verify your account first.'}), 403
    if not _verify_access_token(data.get('access_token'), user.id, 'help'):
        return jsonify({'error': 'Email verification required. Please verify again.'}), 403

    subject = (data.get('subject') or '').strip()
    message = (data.get('message') or '').strip()
    reason = (data.get('reason') or '').strip() or _extract_help_reason(message)
    if len(subject) < 2:
        return jsonify({'error': 'Subject is required.'}), 400
    if len(message) < 5:
        return jsonify({'error': 'Message must be at least 5 characters.'}), 400
    reason_words = _count_words(reason)
    if reason_words < HELP_REASON_MIN_WORDS:
        return jsonify({
            'error': (
                f'Please write at least {HELP_REASON_MIN_WORDS} words explaining your absence '
                f'({reason_words} so far). / Fadlan qor ugu yaraan {HELP_REASON_MIN_WORDS} eray.'
            ),
        }), 400

    meeting_date = (data.get('meeting_date') or '').strip() or None
    if meeting_date:
        try:
            meeting_date = datetime.strptime(meeting_date[:10], '%Y-%m-%d').strftime('%Y-%m-%d')
        except ValueError:
            meeting_date = None

    meeting_id = data.get('meeting_id')
    try:
        meeting_id = int(meeting_id) if meeting_id is not None else None
    except (TypeError, ValueError):
        meeting_id = None

    if meeting_id:
        meet = Meeting.query.get(meeting_id)
        if not meet or not _meeting_applies_to_member(meet, user):
            return jsonify({'error': 'Invalid meeting for your profile.'}), 400
        meeting_date = str(meet.date)[:10]
        att = Attendance.query.filter_by(meeting_id=meeting_id, student_id=user.id).first()
        if att and att.is_excused:
            return jsonify({'error': 'This absence is already excused (approved apology).'}), 409
        if att and att.status != 'Absent':
            return jsonify({'error': 'You were marked present for this meeting.'}), 400
        pending = MemberHelpRequest.query.filter_by(
            user_id=user.id,
            meeting_id=meeting_id,
            response_status='pending',
        ).first()
        if pending:
            return jsonify({'error': 'You already have a pending apology for this meeting.'}), 409
    elif meeting_date:
        stub = type('HelpStub', (), {'meeting_date': meeting_date, 'meeting_id': None, 'message': message})()
        meet = _resolve_meeting_for_help(user, stub)
        if meet:
            meeting_id = meet.id
            meeting_date = str(meet.date)[:10]

    if not meeting_date:
        return jsonify({'error': 'Meeting date is required.'}), 400

    row = MemberHelpRequest(
        user_id=user.id,
        subject=subject,
        message=message,
        meeting_date=meeting_date,
        meeting_id=meeting_id,
    )
    db.session.add(row)
    db.session.commit()

    try:
        notify_main_leader_with_email(
            current_app._get_current_object(),
            f'Member help: {subject}',
            (
                f'New member help request\n\n'
                f'Member: {user.name} ({user.username})\n'
                f'Email: {user.email or "—"}\n'
                f'Subject: {subject}\n\n'
                f'{message}\n\n'
                f'— Naadiga Ardayda Deeqda Waxbarasho HSF'
            ),
            'member_help',
        )
    except Exception:
        pass

    return jsonify({'success': True, 'request': row.to_dict()}), 201


@bp.route('/quran-contest/<int:app_id>/read', methods=['POST'])
def mark_quran_read(app_id):
    row = QuranContestApplication.query.get_or_404(app_id)
    row.is_read = True
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/summer-course/mine', methods=['POST'])
def summer_course_mine():
    data = request.json or {}
    user = _member_user(data.get('user_id'), data.get('username'))
    if not user:
        return jsonify({'error': 'Members only.'}), 403
    if not _verify_access_token(data.get('access_token'), user.id, 'summer-course'):
        return jsonify({'error': 'Email verification required.'}), 403
    row = _summer_app_for_user_year(user.id)
    return jsonify({
        'registration': row.to_dict() if row else None,
        'already_registered': row is not None,
    })


@bp.route('/summer-course/<int:app_id>/read', methods=['POST'])
def mark_summer_read(app_id):
    row = SummerCourseApplication.query.get_or_404(app_id)
    row.is_read = True
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/help/<int:req_id>/read', methods=['POST'])
def mark_help_read(req_id):
    row = MemberHelpRequest.query.get_or_404(req_id)
    row.is_read = True
    db.session.commit()
    return jsonify({'success': True})


HELP_REASON_MIN_WORDS = 50


def _count_words(text):
    if not text:
        return 0
    return len([w for w in str(text).strip().split() if w])


def _extract_help_reason(message):
    marker = 'Sababta keentay maqnaanshahayga waa:'
    if marker not in (message or ''):
        return (message or '').strip()
    after = message.split(marker, 1)[1]
    reason_lines = []
    for line in after.strip().split('\n'):
        stripped = line.strip()
        if stripped.startswith('Waan fahamsanahay muhiimada kulankan'):
            break
        reason_lines.append(stripped)
    return '\n'.join(reason_lines).strip()


def _parse_help_meeting_date_iso(help_row):
    if help_row.meeting_date:
        try:
            return datetime.strptime(str(help_row.meeting_date)[:10], '%Y-%m-%d').strftime('%Y-%m-%d')
        except ValueError:
            pass
    message = help_row.message or ''
    match = re.search(r'loo qorsheeyay\s+(\d{1,2}/\d{1,2}/\d{4})', message, re.IGNORECASE)
    if not match:
        return None
    try:
        d, m, y = match.group(1).split('/')
        return datetime(int(y), int(m), int(d)).strftime('%Y-%m-%d')
    except (ValueError, TypeError):
        return None


def _resolve_meeting_for_help(user, help_row):
    if help_row.meeting_id:
        meet = Meeting.query.get(help_row.meeting_id)
        if meet:
            return meet

    date_iso = _parse_help_meeting_date_iso(help_row)
    if not date_iso:
        return None

    candidates = Meeting.query.filter_by(date=date_iso).order_by(Meeting.id.desc()).all()
    if not candidates:
        return None

    from utils.convocation_helpers import convocations_match

    for meet in candidates:
        if convocations_match(meet.convocation, user.convocation):
            return meet
    return candidates[0]


def _can_penalize_absent_for_meeting(user, meeting):
    if not user or not user.created_at or not meeting or not meeting.date:
        return True
    try:
        m_date = datetime.strptime(str(meeting.date)[:10], '%Y-%m-%d').date()
        return user.created_at.date() < m_date
    except ValueError:
        return True


def _apply_excused_absence(user, help_row):
    """Approved apology: absent with excuse — missed count unchanged if already absent."""
    meeting = _resolve_meeting_for_help(user, help_row)
    if not meeting:
        return False

    help_row.meeting_id = meeting.id
    if not help_row.meeting_date:
        help_row.meeting_date = meeting.date

    existing = Attendance.query.filter_by(
        meeting_id=meeting.id,
        student_id=user.id,
    ).first()

    can_penalize = _can_penalize_absent_for_meeting(user, meeting)

    if existing:
        if existing.is_excused:
            return True
        if existing.status in ('Present', 'Late'):
            return True
        existing.is_excused = True
        existing.status = 'Absent'
        return True

    new_att = Attendance(
        meeting_id=meeting.id,
        student_id=user.id,
        status='Absent',
        date=meeting.date,
        is_excused=True,
    )
    db.session.add(new_att)
    if can_penalize:
        user.meetingsMissed = (user.meetingsMissed or 0) + 1
    return True


@bp.route('/help/<int:req_id>/respond', methods=['POST'])
def respond_help(req_id):
    data = request.json or {}
    action = (data.get('action') or '').strip().lower()
    if action not in ('approve', 'reject'):
        return jsonify({'error': 'Invalid action. Use approve or reject.'}), 400

    row = MemberHelpRequest.query.get_or_404(req_id)
    current = (row.response_status or 'pending').lower()
    if current in ('approved', 'rejected'):
        return jsonify({'error': f'This apology was already {current}.'}), 409

    user = User.query.get(row.user_id)
    if not user or not user.email:
        return jsonify({'error': 'Member has no email on file.'}), 400

    row.response_status = 'approved' if action == 'approve' else 'rejected'
    row.is_read = True

    excused_linked = False
    if action == 'approve':
        excused_linked = _apply_excused_absence(user, row)

    db.session.commit()

    try:
        from utils.email_helpers import send_help_apology_response_email
        send_help_apology_response_email(
            current_app._get_current_object(),
            user,
            row,
            action,
        )
    except Exception:
        pass

    return jsonify({
        'success': True,
        'request': row.to_dict(),
        'excused_linked': excused_linked,
    })


def _counts_by_year(model):
    counts = {}
    for row in model.query.all():
        if row.created_at:
            y = row.created_at.year
            counts[y] = counts.get(y, 0) + 1
    return counts


def _registrations_count_for_program_year(model, year):
    return sum(
        1 for row in model.query.all()
        if row.created_at and row.created_at.year == int(year)
    )


def _all_quran_contest_years():
    """Admin-created contest years only (registrations alone do not create a contest)."""
    return sorted({r.year for r in QuranContestYear.query.all()}, reverse=True)


def _all_summer_program_years():
    """Admin-created summer programs only."""
    return sorted({r.year for r in SummerCourseYear.query.all()}, reverse=True)


def _require_quran_program_year(year):
    meta = QuranContestYear.query.get(int(year))
    if not meta:
        return None, f'No Quran contest for {year}. Add the contest in Program History first.'
    return meta, None


def _require_summer_program_year(year):
    meta = SummerCourseYear.query.get(int(year))
    if not meta:
        return None, f'No summer program for {year}. Add the program in Program History first.'
    return meta, None


def _backfill_year_created_at():
    for row in SummerCourseYear.query.filter(SummerCourseYear.created_at.is_(None)).all():
        row.created_at = datetime(row.year, 6, 1)
    for row in QuranContestYear.query.filter(QuranContestYear.created_at.is_(None)).all():
        row.created_at = datetime(row.year, 1, 15)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()


def _backfill_normalize_dufcad_labels():
    """Rewrite 3aad / 7aad style labels to Dufcadda N (no phpMyAdmin needed)."""
    changed = 0
    try:
        for row in SummerCourseApplication.query.all():
            raw = (row.convocation or '').strip()
            if not raw:
                continue
            normalized = _normalize_summer_convocation(raw)
            if normalized and normalized != raw:
                row.convocation = normalized
                changed += 1
        for user in User.query.all():
            raw = (user.convocation or '').strip()
            if not raw:
                continue
            normalized = _normalize_summer_convocation(raw)
            if normalized and normalized != raw:
                user.convocation = normalized
                changed += 1
        if changed:
            db.session.commit()
            print(f'init_applications_schema: normalized {changed} dufcad label(s) to Dufcadda N')
    except Exception as e:
        db.session.rollback()
        print(f'init_applications_schema (normalize dufcad labels): {e}')


def _latest_summer_program_meta():
    return SummerCourseYear.query.order_by(
        SummerCourseYear.created_at.desc(), SummerCourseYear.year.desc()
    ).first()


def _latest_quran_contest_meta():
    return QuranContestYear.query.order_by(
        QuranContestYear.created_at.desc(), QuranContestYear.year.desc()
    ).first()


def _registration_lock_deadline(started_at):
    if not started_at:
        return None
    return started_at + timedelta(hours=REGISTRATION_LOCK_HOURS)


def _quran_all_winners_set(meta):
    if not meta:
        return False
    for field in QURAN_WINNER_FIELDS:
        if not (getattr(meta, field, None) or '').strip():
            return False
    return True


def _quran_contest_ended(meta):
    """Contest fully locked 6 hours after all 9 winner places are set."""
    if not meta:
        return False
    completed_at = getattr(meta, 'winners_completed_at', None)
    if completed_at and _quran_all_winners_set(meta):
        deadline = _registration_lock_deadline(completed_at)
        if deadline and datetime.utcnow() >= deadline:
            return True
    return False


def _quran_in_grace_period(meta):
    if not meta:
        return False
    completed_at = getattr(meta, 'winners_completed_at', None)
    if not completed_at or not _quran_all_winners_set(meta):
        return False
    deadline = _registration_lock_deadline(completed_at)
    return bool(deadline and datetime.utcnow() < deadline)


def _quran_year_status(meta):
    completed_at = getattr(meta, 'winners_completed_at', None) if meta else None
    closes_at = _registration_lock_deadline(completed_at)
    return {
        'is_ended': _quran_contest_ended(meta),
        'all_winners_set': _quran_all_winners_set(meta),
        'is_in_grace_period': _quran_in_grace_period(meta),
        'registration_closes_at': closes_at.isoformat() if closes_at else None,
        'contest_closed': bool(getattr(meta, 'contest_closed', False)) if meta else False,
    }


def _active_quran_year():
    """Latest admin-created Quran contest year, or None if none exists or registration closed."""
    meta = _latest_quran_contest_meta()
    if not meta or _quran_contest_ended(meta):
        return None
    return meta.year


def _active_summer_year():
    """Latest admin-created summer program year, or None if none exists or program ended."""
    meta = _latest_summer_program_meta()
    if not meta or _summer_program_ended(meta):
        return None
    return meta.year


def _summer_day_window(meta, day_num):
    """UTC start and 6-hour attendance window end for program day 1–6."""
    if not meta or not meta.start_date:
        return None
    day_start = datetime.combine(meta.start_date + timedelta(days=day_num - 1), dt_time.min)
    return day_start, day_start + timedelta(hours=6)


def _summer_program_ended(meta):
    """Program fully locked 6 hours after Day 6 attendance is finalized."""
    if not meta:
        return False
    saved_at = getattr(meta, 'day6_attendance_saved_at', None)
    if saved_at:
        deadline = _registration_lock_deadline(saved_at)
        if deadline and datetime.utcnow() >= deadline:
            return True
    return False


def _summer_in_grace_period(meta):
    if not meta:
        return False
    saved_at = getattr(meta, 'day6_attendance_saved_at', None)
    if not saved_at:
        return False
    deadline = _registration_lock_deadline(saved_at)
    return bool(deadline and datetime.utcnow() < deadline)


def _summer_attendance_locked(meta):
    """Whole-program lock (attendance + registration) after the Day 6 grace window."""
    return _summer_program_ended(meta)


def _summer_day_attendance_state(meta, day_num):
    """All six days editable until the program is fully locked (after Day 6 grace)."""
    if _summer_attendance_locked(meta):
        return 'expired'
    return 'open'


def _summer_day_states(meta):
    return {f'day{d}': _summer_day_attendance_state(meta, d) for d in range(1, 7)}


def _summer_year_payload(meta):
    data = meta.to_dict()
    saved_at = getattr(meta, 'day6_attendance_saved_at', None)
    closes_at = _registration_lock_deadline(saved_at)
    data['is_ended'] = _summer_program_ended(meta)
    data['is_in_grace_period'] = _summer_in_grace_period(meta)
    data['attendance_locked'] = _summer_attendance_locked(meta)
    data['registration_closes_at'] = closes_at.isoformat() if closes_at else None
    data['day_states'] = _summer_day_states(meta)
    return data


def _summer_attendance_total():
    total = 0
    for row in SummerCourseApplication.query.all():
        total += row.attendance_count()
    return total


def _latest_registration_date(year):
    latest = None
    for row in QuranContestApplication.query.all():
        if row.created_at and row.created_at.year == year:
            if not latest or row.created_at > latest:
                latest = row.created_at
    return latest.date() if latest else None


def _year_filter_arg():
    y = request.args.get('year', type=int)
    if y:
        return y
    return datetime.utcnow().year


@bp.route('/stats', methods=['GET'])
def applications_stats():
    year = _year_filter_arg()
    quran_by_year = _counts_by_year(QuranContestApplication)
    summer_by_year = _counts_by_year(SummerCourseApplication)
    return jsonify({
        'year': year,
        'quran_total': QuranContestApplication.query.count(),
        'quran_unread': QuranContestApplication.query.filter_by(is_read=False).count(),
        'quran_total_contests': len(_all_quran_contest_years()),
        'quran_total_competitors': QuranContestApplication.query.count(),
        'quran_registrations_year': quran_by_year.get(year, 0),
        'summer_total': SummerCourseApplication.query.count(),
        'summer_unread': SummerCourseApplication.query.filter_by(is_read=False).count(),
        'summer_total_programs': len(_all_summer_program_years()),
        'summer_total_attended': _summer_attendance_total(),
        'summer_registrations_year': summer_by_year.get(year, 0),
        'help_total': MemberHelpRequest.query.count(),
        'help_unread': MemberHelpRequest.query.filter_by(is_read=False).count(),
    })


def _parse_contest_year_input(raw):
    """Accept 2026 or text containing a year, e.g. 'Tartanka Quranka Kareemka ee 2026'."""
    if raw is None:
        return None, None
    text = str(raw).strip()
    if not text:
        return None, None
    if re.fullmatch(r'\d{4}', text):
        year = int(text)
        if 2000 <= year <= 2100:
            return year, None
        return None, None
    match = re.search(r'\b(20\d{2})\b', text)
    if not match:
        return None, None
    year = int(match.group(1))
    if year < 2000 or year > 2100:
        return None, None
    title = text if text != match.group(1) else None
    return year, title


@bp.route('/quran-contest/years', methods=['POST'])
def create_quran_contest_year():
    data = request.json or {}
    explicit_title = (data.get('title') or '').strip()
    year_raw = data.get('year')
    if year_raw is None:
        year_raw = data.get('name') or data.get('label')
    year, parsed_title = _parse_contest_year_input(year_raw)
    title = explicit_title or parsed_title or ''
    if year is None:
        return jsonify({
            'error': 'Enter a year (e.g. 2026) or a title with a year, like "Tartanka Quranka Kareemka ee 2026".',
        }), 400
    if QuranContestYear.query.get(year):
        return jsonify({'error': f'Quran contest {year} already exists.'}), 409
    today = datetime.utcnow().date()
    meta = QuranContestYear(
        year=year,
        title=title,
        contest_date=today,
        created_at=datetime.utcnow(),
    )
    db.session.add(meta)
    db.session.commit()
    return jsonify({'success': True, 'year': meta.to_dict()}), 201


@bp.route('/summer-course/years', methods=['POST'])
def create_summer_course_year():
    data = request.json or {}
    year = data.get('year')
    if not year:
        return jsonify({'error': 'Year is required.'}), 400
    try:
        year = int(year)
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid year.'}), 400
    if year < 2000 or year > 2100:
        return jsonify({'error': 'Year must be between 2000 and 2100.'}), 400
    if SummerCourseYear.query.get(year):
        return jsonify({'error': f'Summer course {year} already exists.'}), 409
    start_date = None
    raw_start = (data.get('start_date') or '').strip()
    if raw_start:
        try:
            start_date = datetime.strptime(raw_start[:10], '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid start date.'}), 400
    else:
        start_date = datetime.utcnow().date()
    meta = SummerCourseYear(year=year, start_date=start_date, created_at=datetime.utcnow())
    db.session.add(meta)
    db.session.commit()
    return jsonify({'success': True, 'year': meta.to_dict()}), 201


@bp.route('/quran-contest/admin-register', methods=['POST'])
def quran_admin_register():
    """Admin registers a member who cannot self-register (e.g. Alnuur alumni)."""
    closed = _registration_closed_response('quran-contest')
    if closed:
        return closed

    data = request.json or {}
    member_user_id = (data.get('user_id') or '').strip()
    convocation_early = (data.get('convocation') or '').strip()
    if member_user_id and _is_alnuur_dufcad(convocation_early):
        return jsonify({
            'error': (
                'This person is already in the member system and is not from Alnuur. '
                'Use their HSF dufcad, or clear the member and register Alnuur manually.'
            ),
        }), 400
    user, resolve_err = _resolve_admin_quran_user(data)
    if resolve_err:
        return jsonify({'error': resolve_err}), 400
    if not user:
        return jsonify({'error': 'Member not found.'}), 404

    reg_year = data.get('year')
    try:
        reg_year = int(reg_year) if reg_year is not None else None
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid year.'}), 400
    if reg_year is None:
        reg_year = _active_quran_year()
    if reg_year is None:
        return jsonify({'error': NO_ACTIVE_QURAN_MSG}), 403
    meta, prog_err = _require_quran_program_year(reg_year)
    if prog_err:
        return jsonify({'error': prog_err}), 400
    if _quran_contest_ended(meta):
        return jsonify({'error': QURAN_ENDED_MSG}), 403

    full_name = (data.get('full_name') or user.name or '').strip()
    email = (data.get('email') or user.email or '').strip()
    is_alnuur_reg = _is_alnuur_dufcad(convocation_early) or _is_alnuur_dufcad(user.convocation)
    has_contest_history = _quran_highest_past_level(user.id) > 0
    if has_contest_history:
        snap = _quran_profile_snapshot(user)
        participated_before = snap['participated_before']
        previous_section = snap['previous_section']
        won_before = snap['won_before']
        whatsapp = snap['whatsapp'] or (data.get('whatsapp') or user.phone or '').strip()
        telephone = snap['telephone'] or (data.get('telephone') or user.phone or '').strip()
        if is_alnuur_reg:
            convocation = convocation_early or 'Alnuur'
        else:
            convocation = snap['convocation'] or (
                data.get('convocation') or _dufcad_label(user.convocation or '') or ''
            ).strip()
    elif is_alnuur_reg:
        whatsapp = (data.get('whatsapp') or user.phone or '').strip()
        telephone = (data.get('telephone') or user.phone or '').strip()
        convocation = convocation_early or 'Alnuur'
        participated_before, previous_section, won_before = _normalize_quran_past_fields(
            data.get('participated_before'),
            data.get('previous_section'),
            data.get('won_before'),
        )
    else:
        prefill = _quran_profile_snapshot(user)
        whatsapp = prefill['whatsapp']
        telephone = prefill['telephone']
        convocation = prefill['convocation'] or (data.get('convocation') or _dufcad_label(user.convocation or '') or '').strip()
        participated_before = prefill['participated_before']
        previous_section = prefill['previous_section']
        won_before = prefill['won_before']
    section_this_year = (data.get('section_this_year') or '').strip()

    if len(full_name) < 2:
        return jsonify({'error': 'Full name is required.'}), 400
    if not email or '@' not in email:
        return jsonify({'error': 'Valid email is required.'}), 400
    if not whatsapp or not telephone:
        return jsonify({'error': 'WhatsApp and telephone numbers are required.'}), 400
    if not convocation:
        return jsonify({'error': 'Dufcad is required.'}), 400
    dufcad_err = _validate_member_dufcad_match(user, convocation)
    if dufcad_err:
        return jsonify({'error': dufcad_err}), 400
    if not section_this_year:
        return jsonify({'error': 'Section is required.'}), 400
    if participated_before not in ('Haa', 'Maya'):
        return jsonify({'error': 'Please answer whether they participated before.'}), 400

    for row in QuranContestApplication.query.filter_by(user_id=user.id).all():
        if row.created_at and row.created_at.year == reg_year:
            return jsonify({
                'error': f'Already registered for {reg_year}.',
                'already_registered': True,
                'application': row.to_dict(),
            }), 409
    dup_email = QuranContestApplication.query.filter(
        func.lower(QuranContestApplication.email) == email.lower(),
    ).all()
    for row in dup_email:
        if row.created_at and row.created_at.year == reg_year:
            return jsonify({
                'error': f'Already registered for {reg_year} with this email.',
                'already_registered': True,
                'application': row.to_dict(),
            }), 409

    validation_errors = _validate_quran_registration(user, {
        'full_name': full_name,
        'email': email,
        'whatsapp': whatsapp,
        'telephone': telephone,
        'convocation': convocation,
        'university': (data.get('university') or user.university or '').strip(),
        'faculty': (data.get('faculty') or user.faculty or '').strip(),
        'semester': _semester_for_registration(user, data.get('semester')),
        'participated_before': participated_before,
        'previous_section': previous_section,
        'won_before': won_before,
        'section_this_year': section_this_year,
    }, admin_edit=True, skip_locked=is_alnuur_reg and not has_contest_history)
    if validation_errors:
        return jsonify({'error': validation_errors[0], 'errors': validation_errors}), 400

    row = QuranContestApplication(
        user_id=user.id,
        email=email,
        full_name=full_name,
        whatsapp=whatsapp,
        telephone=telephone,
        convocation=convocation,
        participated_before=participated_before,
        previous_section=previous_section,
        won_before=won_before,
        section_this_year=section_this_year,
    )
    row.created_at = _registration_created_at(reg_year, default_month=1, default_day=15)
    db.session.add(row)
    db.session.commit()

    try:
        _send_quran_confirmation_email(user, row)
    except Exception:
        pass

    return jsonify({
        'success': True,
        'message': QURAN_SUCCESS_MSG,
        'application': row.to_dict(),
        'email_sent': True,
    }), 201


@bp.route('/summer-course/admin-register', methods=['POST'])
def summer_admin_register():
    """Admin registers a member for summer course."""
    closed = _registration_closed_response('summer-course')
    if closed:
        return closed

    data = request.json or {}
    user, resolve_err = _resolve_admin_summer_user(data)
    if resolve_err:
        return jsonify({'error': resolve_err}), 400
    if not user:
        return jsonify({'error': 'Member not found.'}), 404

    reg_year = data.get('year')
    try:
        reg_year = int(reg_year) if reg_year is not None else None
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid year.'}), 400
    if reg_year is None:
        reg_year = _active_summer_year()
    if reg_year is None:
        return jsonify({'error': NO_ACTIVE_SUMMER_MSG}), 403
    meta, prog_err = _require_summer_program_year(reg_year)
    if prog_err:
        return jsonify({'error': prog_err}), 400
    if _summer_program_ended(meta):
        return jsonify({'error': SUMMER_ENDED_MSG}), 403

    name = (data.get('name') or user.name or '').strip()
    email = (user.email or data.get('email') or '').strip()
    convocation = (data.get('convocation') or user.convocation or '').strip()
    if not convocation and user.convocation:
        convocation = _dufcad_label(user.convocation)
    faculty = (data.get('faculty') or user.faculty or '').strip()
    university = (data.get('university') or user.university or '').strip()
    semester = _semester_for_registration(user, data.get('semester'))

    if len(name) < 2:
        return jsonify({'error': 'Name is required.'}), 400
    if not email or '@' not in email:
        return jsonify({'error': 'Valid email is required.'}), 400
    is_guest = bool(data.get('guest_registration')) or user.is_summer_guest()
    if not convocation and is_guest:
        convocation = SUMMER_GUEST_DUFCAD
    if not convocation:
        return jsonify({'error': 'Dufcad is required.'}), 400
    if user.role in User.HSF_MEMBER_ROLES:
        dufcad_err = _validate_member_dufcad_match(user, convocation)
        if dufcad_err:
            return jsonify({'error': dufcad_err}), 400
    convocation = _normalize_summer_convocation(convocation)
    if not faculty or not university:
        return jsonify({'error': 'Faculty and university are required.'}), 400

    email_lower = email.lower()
    for row in SummerCourseApplication.query.filter(
        func.lower(SummerCourseApplication.email) == email_lower,
    ).all():
        if row.created_at and row.created_at.year == reg_year:
            return jsonify({
                'error': f'Already registered for {reg_year} with this email.',
                'already_registered': True,
                'application': row.to_dict(),
            }), 409

    for row in SummerCourseApplication.query.filter_by(user_id=user.id).all():
        if row.created_at and row.created_at.year == reg_year:
            return jsonify({
                'error': f'Already registered for {reg_year}.',
                'already_registered': True,
                'application': row.to_dict(),
            }), 409

    row = SummerCourseApplication(
        user_id=user.id,
        email=email,
        name=name,
        convocation=convocation,
        faculty=faculty,
        university=university,
        semester=semester or None,
    )
    row.created_at = _registration_created_at(reg_year, default_month=6, default_day=1)
    db.session.add(row)
    db.session.commit()

    try:
        _send_summer_confirmation_email(user, row)
    except Exception:
        pass

    return jsonify({'success': True, 'application': row.to_dict(), 'email_sent': True}), 201


@bp.route('/quran-contest/years-history', methods=['GET'])
def quran_years_history():
    counts = _counts_by_year(QuranContestApplication)
    out = []
    for y in _all_quran_contest_years():
        meta = QuranContestYear.query.get(y)
        contest_date = None
        if meta and meta.contest_date:
            contest_date = meta.contest_date.isoformat()
        elif meta and meta.created_at:
            contest_date = meta.created_at.date().isoformat()
        elif counts.get(y):
            ld = _latest_registration_date(y)
            if ld:
                contest_date = ld.isoformat()
        out.append({
            'id': y,
            'year': y,
            'title': (meta.title or '').strip() if meta else '',
            'contest_date': contest_date,
            'place': meta.place if meta else '',
            'total_competitors': counts.get(y, 0),
            'created_at': meta.created_at.isoformat() if meta and meta.created_at else None,
            'winner_first': meta.winner_first if meta else '',
            'winner_second': meta.winner_second if meta else '',
            'winner_third': meta.winner_third if meta else '',
            **(_quran_year_status(meta) if meta else {
                'is_ended': False,
                'all_winners_set': False,
                'is_in_grace_period': False,
                'registration_closes_at': None,
                'contest_closed': False,
            }),
        })
    out.sort(key=lambda row: (row.get('created_at') or '', row['year']), reverse=True)
    return jsonify(out)


@bp.route('/quran-contest/years/<int:year>', methods=['GET', 'PUT'])
def quran_contest_year(year):
    meta = QuranContestYear.query.get(year)
    if request.method == 'GET':
        regs = [
            r.to_dict() for r in QuranContestApplication.query.all()
            if r.created_at and r.created_at.year == year
        ]
        if not meta and not regs:
            return jsonify({'error': f'Quran contest {year} not found.'}), 404
        data = meta.to_dict() if meta else {'year': year, 'title': '', 'place': '', 'contest_date': None}
        if meta and not data.get('contest_date') and meta.created_at:
            data['contest_date'] = meta.created_at.date().isoformat()
        data.update(_quran_year_status(meta))
        data['total_competitors'] = len(regs)
        data['registration_count'] = len(regs)
        data['registrations'] = sorted(regs, key=lambda x: x.get('created_at') or '', reverse=True)
        return jsonify(data)
    if not meta:
        return jsonify({'error': f'Quran contest {year} not found. Create the year first.'}), 404
    if _quran_contest_ended(meta):
        return jsonify({'error': QURAN_ENDED_MSG}), 403
    data = request.json or {}
    winners = {}
    legacy_map = {
        'winner_juz10_first': meta.winner_first,
        'winner_juz20_first': meta.winner_second,
        'winner_juz30_first': meta.winner_third,
    }
    for field in QURAN_WINNER_FIELDS:
        if field in data:
            winners[field] = (data[field] or '').strip()
        else:
            winners[field] = (getattr(meta, field, None) or legacy_map.get(field) or '').strip()
    if 'winner_first' in data and 'winner_juz10_first' not in data:
        winners['winner_juz10_first'] = (data['winner_first'] or '').strip()
        winners['winner_juz10_second'] = (data.get('winner_second') or '').strip()
        winners['winner_juz10_third'] = (data.get('winner_third') or '').strip()
    winner_errors = _validate_quran_section_winners(year, winners)
    if winner_errors:
        return jsonify({'error': winner_errors[0], 'errors': winner_errors}), 400
    if 'place' in data:
        meta.place = (data['place'] or '').strip()
    if 'title' in data:
        meta.title = (data['title'] or '').strip()
    for field in QURAN_WINNER_FIELDS:
        setattr(meta, field, winners.get(field, ''))
    meta.winner_first = winners.get('winner_juz10_first', '')
    meta.winner_second = winners.get('winner_juz20_first', '')
    meta.winner_third = winners.get('winner_juz30_first', '')
    if _quran_all_winners_set(meta):
        if not meta.winners_completed_at:
            meta.winners_completed_at = datetime.utcnow()
    else:
        meta.winners_completed_at = None
    if data.get('reopen_registration'):
        meta.contest_closed = False
        meta.winners_completed_at = None
    elif 'contest_closed' in data:
        meta.contest_closed = bool(data['contest_closed'])
    if 'contest_date' in data:
        raw = (data['contest_date'] or '').strip()
        if raw:
            try:
                meta.contest_date = datetime.strptime(raw[:10], '%Y-%m-%d').date()
            except ValueError:
                pass
        else:
            meta.contest_date = None
    db.session.commit()
    payload = meta.to_dict()
    payload.update(_quran_year_status(meta))
    return jsonify({'success': True, 'year': payload})


@bp.route('/quran-contest/years/<int:year>', methods=['DELETE'])
def delete_quran_contest_year(year):
    for row in QuranContestApplication.query.all():
        if row.created_at and row.created_at.year == year:
            db.session.delete(row)
    meta = QuranContestYear.query.get(year)
    if meta:
        db.session.delete(meta)
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/summer-course/years-history', methods=['GET'])
def summer_years_history():
    counts = _counts_by_year(SummerCourseApplication)
    out = []
    for y in _all_summer_program_years():
        meta = SummerCourseYear.query.get(y)
        start_date = None
        if meta:
            start_date = (
                meta.start_date.isoformat()
                if meta.start_date
                else meta.created_at.date().isoformat() if meta.created_at else None
            )
        out.append({
            'year': y,
            'place': meta.place if meta else '',
            'courses_offered': meta.courses_offered if meta else '',
            'start_date': start_date,
            'total_registered': _registrations_count_for_program_year(SummerCourseApplication, y),
            'total_attended': counts.get(y, 0),
            'created_at': meta.created_at.isoformat() if meta and meta.created_at else None,
            **(_summer_year_payload(meta) if meta else {
                'is_ended': False,
                'is_in_grace_period': False,
                'attendance_locked': False,
                'registration_closes_at': None,
                'program_closed': False,
                'day6_attendance_saved_at': None,
            }),
        })
    out.sort(key=lambda row: (row.get('created_at') or '', row['year']), reverse=True)
    return jsonify(out)


@bp.route('/summer-course/years/<int:year>', methods=['GET', 'PUT', 'DELETE'])
def summer_course_year(year):
    if request.method == 'DELETE':
        for row in SummerCourseApplication.query.all():
            if row.created_at and row.created_at.year == year:
                db.session.delete(row)
        meta = SummerCourseYear.query.get(year)
        if meta:
            db.session.delete(meta)
        db.session.commit()
        return jsonify({'success': True})

    meta = SummerCourseYear.query.get(year)
    if request.method == 'GET':
        regs = [
            r.to_dict() for r in SummerCourseApplication.query.all()
            if r.created_at and r.created_at.year == year
        ]
        if not meta and not regs:
            return jsonify({'error': f'Summer course {year} not found.'}), 404
        return jsonify(_summer_program_detail_payload(year, meta))
    if not meta:
        return jsonify({'error': f'Summer course {year} not found. Create the year first.'}), 404
    if _summer_program_ended(meta):
        return jsonify({'error': SUMMER_ENDED_MSG}), 403
    data = request.json or {}
    if 'place' in data:
        meta.place = (data['place'] or '').strip()
    if 'courses_offered' in data:
        meta.courses_offered = (data['courses_offered'] or '').strip()
    if 'courses_list' in data and isinstance(data['courses_list'], list):
        meta.courses_offered = '\n'.join(
            (c or '').strip() for c in data['courses_list'] if (c or '').strip()
        )
    if 'start_date' in data:
        raw = (data['start_date'] or '').strip()
        if raw:
            try:
                meta.start_date = datetime.strptime(raw[:10], '%Y-%m-%d').date()
            except ValueError:
                pass
        else:
            meta.start_date = None
    if data.get('reopen_registration'):
        meta.program_closed = False
        meta.day6_attendance_saved_at = None
    elif 'program_closed' in data:
        meta.program_closed = bool(data['program_closed'])
        if meta.program_closed:
            pass
    db.session.commit()
    return jsonify({'success': True, 'year': _summer_year_payload(meta)})


def _summer_program_detail_payload(year, meta):
    regs = [
        r.to_dict() for r in SummerCourseApplication.query.all()
        if r.created_at and r.created_at.year == year
    ]
    data = _summer_year_payload(meta) if meta else {
        'year': year,
        'place': '',
        'courses_offered': '',
        'start_date': None,
        'is_ended': False,
        'program_closed': False,
        'day_states': _summer_day_states(None),
    }
    if meta and not data.get('start_date') and meta.created_at:
        data['start_date'] = meta.created_at.date().isoformat()
    data['attendance_marks'] = sum(
        r.attendance_count() for r in SummerCourseApplication.query.all()
        if r.created_at and r.created_at.year == year
    )
    data['total_attended'] = data['attendance_marks']
    data['registration_count'] = len(regs)
    data['registrations'] = sorted(regs, key=lambda x: x.get('created_at') or '', reverse=True)
    return data


@bp.route('/summer-course/years/<int:year>/attendance-batch', methods=['POST'])
def summer_course_attendance_batch(year):
    meta, err = _require_summer_program_year(year)
    if err:
        return jsonify({'error': err}), 404

    data = request.json or {}
    entries = data.get('entries') or []
    finalize_day6 = bool(data.get('finalize_day6'))
    notify_days_raw = data.get('notify_days') or []
    notify_days = []
    for d in notify_days_raw:
        try:
            n = int(d)
        except (TypeError, ValueError):
            continue
        if 1 <= n <= 6:
            notify_days.append(n)

    if _summer_program_ended(meta):
        return jsonify({'error': SUMMER_ENDED_MSG}), 403

    if not entries:
        return jsonify({'error': 'No attendance rows to save.'}), 400

    touched_rows = []
    for entry in entries:
        try:
            app_id = int(entry.get('id'))
        except (TypeError, ValueError):
            continue
        attendance = entry.get('attendance')
        if not isinstance(attendance, dict):
            continue
        row = SummerCourseApplication.query.get(app_id)
        if not row or not row.created_at or row.created_at.year != int(year):
            continue
        for day in range(1, 7):
            key = f'day{day}'
            if key not in attendance:
                continue
            setattr(row, f'attendance_day{day}', bool(attendance[key]))
        touched_rows.append(row)

    if finalize_day6 and not meta.day6_attendance_saved_at:
        meta.day6_attendance_saved_at = datetime.utcnow()

    db.session.commit()

    emails_sent = 0
    if notify_days and touched_rows:
        try:
            emails_sent = _notify_summer_absences_for_days(touched_rows, notify_days, year)
        except Exception as e:
            print(f'summer absence notify batch failed: {e}')

    payload = _summer_program_detail_payload(year, meta)
    payload['absence_emails_sent'] = emails_sent
    return jsonify(payload)


@bp.route('/summer-course/<int:app_id>', methods=['PUT', 'DELETE'])
def update_summer_application(app_id):
    row = SummerCourseApplication.query.get_or_404(app_id)

    if request.method == 'DELETE':
        user = User.query.get(row.user_id)
        try:
            if user:
                _send_summer_delete_email(user, row)
        except Exception:
            pass
        db.session.delete(row)
        db.session.commit()
        return jsonify({'success': True, 'email_sent': True})

    data = request.json or {}
    year = row.created_at.year if row.created_at else datetime.utcnow().year
    meta = SummerCourseYear.query.get(year)
    if meta and _summer_program_ended(meta):
        return jsonify({'error': SUMMER_ENDED_MSG}), 403
    user = User.query.get(row.user_id)
    if 'convocation' in data:
        convocation = (data.get('convocation') or '').strip()
        if user:
            dufcad_err = _validate_member_dufcad_match(user, convocation)
            if dufcad_err:
                return jsonify({'error': dufcad_err}), 400
        data['convocation'] = _normalize_summer_convocation(convocation)

    profile_fields = ('name', 'convocation', 'faculty', 'university', 'semester')
    profile_changed = False
    for field in profile_fields:
        if field in data:
            setattr(row, field, (data[field] or '').strip())
            profile_changed = True

    attendance = data.get('attendance')
    attendance_changed_days = []
    if isinstance(attendance, dict):
        for day in range(1, 7):
            key = f'day{day}'
            if key not in attendance:
                continue
            new_val = bool(attendance[key])
            old_val = bool(getattr(row, f'attendance_day{day}', False))
            if new_val != old_val:
                attendance_changed_days.append(day)
            setattr(row, f'attendance_day{day}', new_val)
    db.session.commit()

    try:
        if profile_changed and user:
            _send_summer_update_email(user, row)
    except Exception:
        pass

    emails_sent = 0
    if attendance_changed_days:
        try:
            emails_sent = _notify_summer_absences_for_days([row], attendance_changed_days, year)
        except Exception as e:
            print(f'summer absence notify single failed: {e}')

    return jsonify({
        'success': True,
        'application': row.to_dict(),
        'email_sent': profile_changed,
        'absence_emails_sent': emails_sent,
    })


def _parse_month_range(from_month, to_month):
    """Parse YYYY-MM strings to datetime bounds (inclusive months)."""
    start = end = None
    if from_month:
        try:
            y, m = from_month.split('-')
            start = datetime(int(y), int(m), 1)
        except (ValueError, TypeError):
            pass
    if to_month:
        try:
            y, m = to_month.split('-')
            ny, nm = int(y), int(m)
            if nm == 12:
                end = datetime(ny + 1, 1, 1)
            else:
                end = datetime(ny, nm + 1, 1)
        except (ValueError, TypeError):
            pass
    return start, end


def _in_month_range(created_at, start, end):
    if not created_at:
        return False
    if start and created_at < start:
        return False
    if end and created_at >= end:
        return False
    return True


@bp.route('/reports/quran-contest-data', methods=['GET'])
def quran_contest_report_data():
    from_month = (request.args.get('from_month') or '').strip()
    to_month = (request.args.get('to_month') or '').strip()
    convocation = (request.args.get('convocation') or 'all').strip()
    section = (request.args.get('section') or 'all').strip()
    start, end = _parse_month_range(from_month, to_month)

    rows = QuranContestApplication.query.order_by(QuranContestApplication.created_at.desc()).all()
    out = []
    for r in rows:
        if not _in_month_range(r.created_at, start, end):
            continue
        if convocation != 'all' and (r.convocation or '') != convocation:
            continue
        if section != 'all' and (r.section_this_year or '') != section:
            continue
        out.append(r.to_dict())
    return jsonify({
        'rows': out,
        'total': len(out),
        'from_month': from_month,
        'to_month': to_month,
        'convocation': convocation,
        'section': section,
    })


@bp.route('/reports/summer-course-data', methods=['GET'])
def summer_course_report_data():
    from_month = (request.args.get('from_month') or '').strip()
    to_month = (request.args.get('to_month') or '').strip()
    convocation = (request.args.get('convocation') or 'all').strip()
    start, end = _parse_month_range(from_month, to_month)

    rows = SummerCourseApplication.query.order_by(SummerCourseApplication.created_at.desc()).all()
    out = []
    for r in rows:
        if not _in_month_range(r.created_at, start, end):
            continue
        if convocation != 'all' and (r.convocation or '') != convocation:
            continue
        out.append(r.to_dict())
    return jsonify({
        'rows': out,
        'total': len(out),
        'from_month': from_month,
        'to_month': to_month,
        'convocation': convocation,
    })

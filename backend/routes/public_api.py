import json
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from flask import Blueprint, request, jsonify, current_app
from extensions import db
from models import (
    ContentCategory, Team, SiteStats, User, ContactMessage, MemberHelpRequest,
    SiteTeamMember, SiteHomepageVideo,
)
from sqlalchemy import func, text
from utils.email_helpers import greet, notify_main_leader
from content_defaults import (
    CONTENT_DEFAULT_SLIDES,
    CONTENT_DEFAULT_TEXT,
    CONTENT_DEFAULT_SLIDE_TEXT,
    HOMEPAGE_VIDEO_COUNT,
    DEFAULT_HOMEPAGE_VIDEO_PATHS,
    DEFAULT_HOMEPAGE_VIDEO_TEXTS,
)
from utils.gallery_upload import (
    is_gallery_upload_path,
    remove_gallery_image_file,
    save_gallery_slide_image,
)

bp = Blueprint('public_api', __name__)

SLIDE_COUNT = 5
PORTAL_MEMBER_ROLES = (
    'Student', 'Main Leader', 'Leader', 'Payment Sub Admin', 'Payment Admin', 'Media Admin',
)

SITE_TZ = ZoneInfo('Africa/Mogadishu')


def _site_today():
    return datetime.now(SITE_TZ).date()


def _ensure_today_visitors_fresh(stats):
    """Reset today_visitors when the calendar day changes (Somalia local time)."""
    if not stats:
        return
    today = _site_today()
    if stats.visitors_date is None:
        stats.visitors_date = today
        db.session.commit()
        return
    if stats.visitors_date != today:
        stats.today_visitors = 0
        stats.visitors_date = today
        db.session.commit()


def _is_custom_slide_ref(val):
    if not val or not isinstance(val, str):
        return False
    s = val.strip()
    if not s:
        return False
    if s.startswith('portal/public/assets/default-images/'):
        return False
    return True


def _is_custom_image(val):
    return _is_custom_slide_ref(val)


def _gallery_file_ref_for_slot(content, custom, slide_index):
    ref = custom[slide_index] if custom and slide_index < len(custom) else None
    if ref and is_gallery_upload_path(ref):
        return ref
    if slide_index == 0:
        legacy = content.image_base64
        if is_gallery_upload_path(legacy):
            return legacy
    return None


def _remove_custom_slide_files(content, custom=None):
    custom = custom if custom is not None else _parse_custom_slides(content)
    seen = set()
    for i in range(SLIDE_COUNT):
        ref = _gallery_file_ref_for_slot(content, custom, i)
        if ref and ref not in seen:
            remove_gallery_image_file(ref)
            seen.add(ref)


def _parse_custom_slides(content):
    if not content.slides_json:
        return [None] * SLIDE_COUNT
    try:
        raw = json.loads(content.slides_json)
        if not isinstance(raw, list):
            return [None] * SLIDE_COUNT
        out = [None] * SLIDE_COUNT
        for i in range(min(SLIDE_COUNT, len(raw))):
            v = raw[i]
            out[i] = v if _is_custom_image(v) else None
        return out
    except (json.JSONDecodeError, TypeError):
        return [None] * SLIDE_COUNT


def _save_custom_slides(content, custom):
    padded = list(custom[:SLIDE_COUNT])
    while len(padded) < SLIDE_COUNT:
        padded.append(None)
    content.slides_json = json.dumps(padded)


def _resolve_slides(cat_id, content):
    defaults = CONTENT_DEFAULT_SLIDES.get(cat_id, [''] * SLIDE_COUNT)
    custom = _parse_custom_slides(content)
    result = []
    for i in range(SLIDE_COUNT):
        c = custom[i]
        if i == 0 and not c and _is_custom_image(content.image_base64):
            c = content.image_base64
        result.append(c if c else defaults[i])
    return result


def _custom_slide_flags(content):
    custom = _parse_custom_slides(content)
    flags = []
    for i in range(SLIDE_COUNT):
        if custom[i]:
            flags.append(True)
        elif i == 0 and _is_custom_image(content.image_base64):
            flags.append(True)
        else:
            flags.append(False)
    return flags


def _has_any_custom(content):
    return any(_custom_slide_flags(content))


TEXT_FIELDS = ('title', 'description', 'section_title', 'section_description', 'badge_text', 'caption')


def _resolve_text(cat_id, content):
    defaults = dict(CONTENT_DEFAULT_TEXT.get(cat_id, {}))
    resolved = dict(defaults)
    for field in TEXT_FIELDS:
        db_val = getattr(content, field, None)
        if db_val is not None and str(db_val).strip():
            resolved[field] = str(db_val).strip()
    return resolved


def _custom_text_flags(content, cat_id):
    defaults = CONTENT_DEFAULT_TEXT.get(cat_id, {})
    flags = {}
    for field in TEXT_FIELDS:
        db_val = getattr(content, field, None)
        if db_val is not None and str(db_val).strip():
            default_val = defaults.get(field, '')
            flags[field] = str(db_val).strip() != str(default_val).strip()
        else:
            flags[field] = False
    return flags


TEXT_LIMITS = {'title': 300, 'section_title': 300, 'badge_text': 100, 'caption': 200}


def _default_slide_texts(cat_id):
    if cat_id in CONTENT_DEFAULT_SLIDE_TEXT:
        rows = CONTENT_DEFAULT_SLIDE_TEXT[cat_id]
        return [dict(rows[i]) if i < len(rows) else dict(rows[0]) for i in range(SLIDE_COUNT)]
    base = dict(CONTENT_DEFAULT_TEXT.get(cat_id, {}))
    return [dict(base) for _ in range(SLIDE_COUNT)]


def _parse_slide_texts_custom(content):
    if not content.slides_text_json:
        return [None] * SLIDE_COUNT
    try:
        raw = json.loads(content.slides_text_json)
        if not isinstance(raw, list):
            return [None] * SLIDE_COUNT
        out = [None] * SLIDE_COUNT
        for i in range(min(SLIDE_COUNT, len(raw))):
            row = raw[i]
            if isinstance(row, dict) and row:
                cleaned = {}
                for field in TEXT_FIELDS:
                    val = row.get(field)
                    if val is not None and str(val).strip():
                        cleaned[field] = str(val).strip()
                out[i] = cleaned or None
        return out
    except (json.JSONDecodeError, TypeError):
        return [None] * SLIDE_COUNT


def _save_slide_texts(content, slots):
    padded = []
    for i in range(SLIDE_COUNT):
        row = slots[i] if i < len(slots) else None
        padded.append(row if row else None)
    content.slides_text_json = json.dumps(padded)


def _sync_legacy_text_columns(content, text_dict):
    for field in TEXT_FIELDS:
        val = (text_dict or {}).get(field)
        if val:
            cap = TEXT_LIMITS.get(field)
            setattr(content, field, val[:cap] if cap else val)
        else:
            setattr(content, field, None)


def _resolve_slide_texts(cat_id, content):
    defaults = _default_slide_texts(cat_id)
    custom = _parse_slide_texts_custom(content)
    result = []
    for i in range(SLIDE_COUNT):
        merged = dict(defaults[i])
        if custom[i]:
            merged.update(custom[i])
        if i == 0:
            for field in TEXT_FIELDS:
                db_val = getattr(content, field, None)
                if db_val is not None and str(db_val).strip():
                    merged[field] = str(db_val).strip()
        result.append(merged)
    return result


def _slide_text_custom_flags(cat_id, content):
    defaults = _default_slide_texts(cat_id)
    custom = _parse_slide_texts_custom(content)
    flags = []
    for i in range(SLIDE_COUNT):
        if not custom[i]:
            flags.append(False)
            continue
        default_row = defaults[i]
        flags.append(any(
            custom[i].get(field, '') != default_row.get(field, '')
            for field in TEXT_FIELDS
            if field in custom[i]
        ))
    if flags and not flags[0]:
        for field in TEXT_FIELDS:
            db_val = getattr(content, field, None)
            if db_val and str(db_val).strip() != str(defaults[0].get(field, '')).strip():
                flags[0] = True
                break
    return flags


def _apply_text_update(content, data, cat_id=None):
    limits = TEXT_LIMITS
    has_text_field = any(field in data for field in TEXT_FIELDS)
    if not has_text_field:
        return False

    slide_index = data.get('slide_index')
    if slide_index is not None:
        slide_index = int(slide_index)
        if slide_index < 0 or slide_index >= SLIDE_COUNT:
            raise ValueError('slide_index must be 0–4')
        slots = _parse_slide_texts_custom(content)
        row = dict(slots[slide_index] or {})
        for field in TEXT_FIELDS:
            if field not in data:
                continue
            val = str(data.get(field) or '').strip()
            if val:
                cap = limits.get(field)
                row[field] = val[:cap] if cap else val
            else:
                row.pop(field, None)
        slots[slide_index] = row or None
        _save_slide_texts(content, slots)
        if slide_index == 0:
            _sync_legacy_text_columns(content, row)
        return True

    updated = False
    row = {}
    for field in TEXT_FIELDS:
        if field not in data:
            continue
        raw = data.get(field)
        if raw is None:
            continue
        val = str(raw).strip()
        if not val:
            setattr(content, field, None)
        else:
            cap = limits.get(field)
            setattr(content, field, val[:cap] if cap else val)
            row[field] = val[:cap] if cap else val
        updated = True
    if updated:
        slots = _parse_slide_texts_custom(content)
        slots[0] = row or None
        _save_slide_texts(content, slots)
    return updated


def _main_leader():
    return User.query.filter_by(role='Main Leader').first()


@bp.route('/login', methods=['POST'])
def login():
    """Public admin panel login — uses Main Leader user (same as member portal)."""
    data = request.json or {}
    username = (data.get('username') or '').lower().strip()
    password = (data.get('password') or '').strip()
    leader = _main_leader()
    if not leader:
        return jsonify({"success": False, "message": "No Main Leader account configured."}), 404
    if username == leader.username.lower() and password == leader.password:
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Invalid credentials"}), 401

@bp.route('/content/<int:cat_id>', methods=['GET'])
def get_content(cat_id):
    content = ContentCategory.query.get_or_404(cat_id)
    slides = _resolve_slides(cat_id, content)
    slide_texts = _resolve_slide_texts(cat_id, content)
    text = slide_texts[0] if slide_texts else _resolve_text(cat_id, content)
    return jsonify({
        "id": content.id,
        "image": slides[0],
        "slides": slides,
        "custom_slides": _custom_slide_flags(content),
        "slide_texts": slide_texts,
        "custom_slide_texts": _slide_text_custom_flags(cat_id, content),
        "caption": text.get('caption', ''),
        "title": text.get('title', ''),
        "description": text.get('description', ''),
        "section_title": text.get('section_title', ''),
        "section_description": text.get('section_description', ''),
        "badge_text": text.get('badge_text', ''),
        "text": text,
        "custom_text": _custom_text_flags(content, cat_id),
    })

@bp.route('/content/<int:cat_id>', methods=['POST'])
def update_content(cat_id):
    try:
        content = ContentCategory.query.get_or_404(cat_id)
        data = request.get_json(silent=True) or {}
        if not data and request.form:
            data = request.form.to_dict()
        updated = False
        try:
            if _apply_text_update(content, data, cat_id):
                updated = True
        except ValueError as exc:
            return jsonify({"success": False, "message": str(exc)}), 400

        slide_index = data.get('slide_index')
        if slide_index is not None:
            slide_index = int(slide_index)
            if slide_index < 0 or slide_index >= SLIDE_COUNT:
                return jsonify({"success": False, "message": "slide_index must be 0–4"}), 400
        else:
            slide_index = 0

        upload_file = request.files.get('file')
        image_payload = data.get('image')
        saved_path = None
        if (upload_file and upload_file.filename) or image_payload:
            custom = _parse_custom_slides(content)
            old_file_ref = _gallery_file_ref_for_slot(content, custom, slide_index)
            try:
                if upload_file and upload_file.filename:
                    saved_path = save_gallery_slide_image(
                        cat_id,
                        slide_index,
                        file_storage=upload_file,
                        old_ref=old_file_ref,
                    )
                else:
                    saved_path = save_gallery_slide_image(
                        cat_id,
                        slide_index,
                        data_url=image_payload,
                        old_ref=old_file_ref,
                    )
            except ValueError as exc:
                return jsonify({"success": False, "message": str(exc)}), 400

            custom[slide_index] = saved_path
            _save_custom_slides(content, custom)
            if slide_index == 0:
                content.image_base64 = saved_path
            updated = True

        if not updated:
            return jsonify({"success": False, "message": "No updates provided"}), 400
        db.session.commit()
        return jsonify({"success": True, "path": saved_path})
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500

@bp.route('/content/<int:cat_id>', methods=['DELETE'])
def delete_content(cat_id):
    content = ContentCategory.query.get_or_404(cat_id)
    slide_index = request.args.get('slide_index', type=int)

    if slide_index is not None:
        if slide_index < 0 or slide_index >= SLIDE_COUNT:
            return jsonify({"success": False, "message": "slide_index must be 0–4"}), 400
        custom = _parse_custom_slides(content)
        has_slot = bool(custom[slide_index])
        if slide_index == 0 and not has_slot and _is_custom_image(content.image_base64):
            has_slot = True
        if not has_slot:
            return jsonify({
                "success": False,
                "message": "That slide uses the default image and cannot be removed.",
            }), 400
        old_file_ref = _gallery_file_ref_for_slot(content, custom, slide_index)
        custom[slide_index] = None
        _save_custom_slides(content, custom)
        if slide_index == 0:
            content.image_base64 = None
        if old_file_ref:
            remove_gallery_image_file(old_file_ref)
        db.session.commit()
        return jsonify({"success": True})

    if not _has_any_custom(content):
        return jsonify({
            "success": False,
            "message": "Default images cannot be deleted. Only uploaded pictures can be removed.",
        }), 400
    _remove_custom_slide_files(content)
    content.image_base64 = None
    content.slides_json = None
    db.session.commit()
    return jsonify({"success": True})

@bp.route('/teams', methods=['GET'])
def get_teams():
    teams = Team.query.all()
    return jsonify([{"id": t.id, "name": t.name, "category": t.category, "members": t.member_count, "image": t.image_url} for t in teams])

@bp.route('/users', methods=['GET'])
def get_public_users():
    """Self-registered public accounts only (username + password login)."""
    users = User.query.filter_by(role='Public User').order_by(User.created_at.desc()).all()
    return jsonify([u.to_dict() for u in users])


@bp.route('/contact', methods=['POST'])
def submit_contact():
    data = request.json or {}
    username = (data.get('username') or '').lower().strip()
    message_text = (data.get('message') or '').strip()

    if not username or not message_text:
        return jsonify({'error': 'Missing fields'}), 400

    user = User.query.filter(
        func.lower(User.username) == username,
        User.role == 'Public User',
    ).first()
    if not user:
        return jsonify({
            'error': 'You must register and log in before sending a message.',
        }), 403

    msg = ContactMessage(
        name=user.name or data.get('name') or username,
        email=user.email or data.get('email') or '',
        message=message_text,
    )
    db.session.add(msg)
    db.session.commit()

    try:
        preview = message_text[:300] + ('…' if len(message_text) > 300 else '')
        notify_main_leader(
            current_app._get_current_object(),
            f'New contact message from {msg.name}',
            f'From: {msg.name} ({msg.email or username})\n\n{preview}',
            'contact',
        )
    except Exception as e:
        print(f'Contact notification skipped: {e}')

    return jsonify({'success': True})

@bp.route('/messages', methods=['GET'])
def get_messages():
    messages = ContactMessage.query.order_by(ContactMessage.created_at.desc()).all()
    return jsonify([m.to_dict() for m in messages])

@bp.route('/messages/<int:msg_id>/read', methods=['POST'])
def mark_message_read(msg_id):
    msg = ContactMessage.query.get_or_404(msg_id)
    msg.is_read = True
    db.session.commit()
    return jsonify({"success": True})

@bp.route('/reply-message', methods=['POST'])
def reply_message():
    data = request.json or {}
    email = (data.get('email') or '').strip()
    message_text = (data.get('message') or '').strip()
    recipient_name = (data.get('name') or '').strip()
    message_id = data.get('message_id')

    if not email or not message_text:
        return jsonify({'error': 'Missing email or message'}), 400

    mail_user = current_app.config.get('MAIL_USERNAME')
    mail_pass = current_app.config.get('MAIL_PASSWORD')
    if not mail_user or not mail_pass:
        return jsonify({
            'error': 'Email is not configured. Set MAIL_USERNAME and MAIL_PASSWORD in backend/.env',
        }), 503

    from utils.email_helpers import club_mail_sender, club_official_name
    app_obj = current_app._get_current_object()
    org = club_official_name(app_obj)
    sender = club_mail_sender(app_obj)

    body = f"""{greet(recipient_name)}

{message_text}

---
This is a reply from {org} regarding your contact message.
To log in to the website in future, use Register (contact form does not create a login account).

Best regards,
{org}
"""

    try:
        from flask_mail import Message
        from extensions import mail

        outbound = Message(
            subject=f'Reply from {org}',
            sender=sender,
            recipients=[email],
            body=body,
        )
        mail.send(outbound)

        if message_id:
            contact_row = ContactMessage.query.get(message_id)
            if contact_row:
                contact_row.admin_reply = message_text
                contact_row.replied_at = datetime.utcnow()
                contact_row.is_read = True
                db.session.commit()

        return jsonify({'success': True, 'sent_to': email})
    except Exception as e:
        print('Mail error:', str(e))
        db.session.rollback()
        return jsonify({'error': f'Failed to send email: {e}'}), 500

@bp.route('/stats', methods=['GET'])
def get_stats():
    stats = SiteStats.query.first()
    _ensure_today_visitors_fresh(stats)
    gallery_count = 0
    for row in ContentCategory.query.all():
        gallery_count += sum(_custom_slide_flags(row))
    user_count = User.query.filter_by(role='Public User').count()
    students_engaged = User.query.filter(User.role.in_(PORTAL_MEMBER_ROLES)).count()
    unread_msg_count = ContactMessage.query.filter_by(is_read=False).count()
    total_msg_count = ContactMessage.query.count()
    help_unread = MemberHelpRequest.query.filter_by(is_read=False).count()
    help_total = MemberHelpRequest.query.count()
    return jsonify({
        "today_visitors": stats.today_visitors if stats else 0,
        "total_visitors": stats.total_visitors if stats else 0,
        "total_users": user_count,
        "students_engaged": students_engaged,
        "unread_messages": unread_msg_count,
        "total_messages": total_msg_count,
        "unread_help_requests": help_unread,
        "total_help_requests": help_total,
        "gallery_images": gallery_count,
        "avg_session": "4m 32s"
    })

@bp.route('/track-visitor', methods=['POST'])
def track_visitor():
    referer = (request.headers.get('Referer') or '').lower()
    if 'admin.html' in referer or '/admin' in referer or '\\admin' in referer:
        return jsonify({"success": True, "skipped": True})

    stats = SiteStats.query.first()
    if stats:
        _ensure_today_visitors_fresh(stats)
        stats.today_visitors += 1
        stats.total_visitors += 1
        stats.visitors_date = _site_today()
        db.session.commit()
    return jsonify({"success": True})

@bp.route('/admin/settings', methods=['GET', 'POST'])
def admin_settings():
    leader = _main_leader()
    if not leader:
        return jsonify({
            "foundation_name": "HSF System",
            "admin_email": "",
            "theme": "dark",
        })

    if request.method == 'POST':
        data = request.json
        if not data:
            return jsonify({"error": "No data"}), 400

        if 'foundation_name' in data and data['foundation_name'].strip():
            leader.name = data['foundation_name'].strip()
        if 'admin_email' in data and data['admin_email'].strip():
            new_email = data['admin_email'].strip().lower()
            clash = User.hsf_members_query().filter(
                func.lower(User.email) == new_email,
                User.id != leader.id,
            ).first()
            if clash:
                return jsonify({"error": "Email already used by another member."}), 400
            leader.email = new_email
        if 'password' in data and data['password'].strip():
            leader.password = data['password'].strip()
        db.session.commit()
        return jsonify({"success": True})

    return jsonify({
        "foundation_name": leader.name,
        "admin_email": leader.email or leader.username,
        "theme": "dark",
    })

def _migrate_content_caption_column():
    from sqlalchemy import inspect, text
    try:
        insp = inspect(db.engine)
        if 'content_category' not in insp.get_table_names():
            return
        cols = {c['name'] for c in insp.get_columns('content_category')}
        with db.engine.begin() as conn:
            if 'caption' not in cols:
                conn.execute(text('ALTER TABLE content_category ADD COLUMN caption VARCHAR(200)'))
            if 'slides_json' not in cols:
                conn.execute(text('ALTER TABLE content_category ADD COLUMN slides_json MEDIUMTEXT'))
            for col, ddl in (
                ('title', 'VARCHAR(300)'),
                ('description', 'TEXT'),
                ('section_title', 'VARCHAR(300)'),
                ('section_description', 'TEXT'),
                ('badge_text', 'VARCHAR(100)'),
                ('slides_text_json', 'TEXT'),
            ):
                if col not in cols:
                    conn.execute(text(f'ALTER TABLE content_category ADD COLUMN {col} {ddl}'))
            _widen_content_media_columns(conn)
    except Exception as e:
        print(f'Content caption migration note: {e}')


def _widen_content_media_columns(conn):
    """MySQL TEXT (~64KB) is too small for legacy base64; widen existing columns when possible."""
    try:
        from sqlalchemy import inspect
        insp = inspect(db.engine)
        if insp.dialect.name != 'mysql':
            return
        for col in ('slides_json', 'image_base64'):
            row = conn.execute(text(
                "SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_category' AND COLUMN_NAME = :col"
            ), {'col': col}).fetchone()
            if not row:
                continue
            data_type = (row[0] or '').lower()
            if data_type == 'text':
                conn.execute(text(f'ALTER TABLE content_category MODIFY {col} MEDIUMTEXT'))
    except Exception as exc:
        print(f'Content media column widen note: {exc}')


def _migrate_contact_reply_columns():
    from sqlalchemy import inspect, text
    try:
        insp = inspect(db.engine)
        if 'contact_message' not in insp.get_table_names():
            return
        cols = {c['name'] for c in insp.get_columns('contact_message')}
        with db.engine.begin() as conn:
            if 'admin_reply' not in cols:
                conn.execute(text('ALTER TABLE contact_message ADD COLUMN admin_reply TEXT'))
            if 'replied_at' not in cols:
                conn.execute(text('ALTER TABLE contact_message ADD COLUMN replied_at DATETIME'))
    except Exception as e:
        print(f'Contact reply migration note: {e}')


@bp.route('/site-team', methods=['GET'])
def get_site_team():
    return jsonify(_merged_team_members(published_only=True))


def _team_assets_dir():
    root = os.path.abspath(os.path.join(current_app.root_path, '..'))
    return os.path.join(root, 'assets', 'team')


def _is_admin_upload_filename(filename):
    """Files uploaded via admin (team_YYYYMMDDHHMMSS_*). Names come from DB, not filename."""
    stem = os.path.splitext(filename)[0]
    return bool(re.match(r'^team_\d{14}_', stem, re.I))


def _name_from_team_filename(filename, index):
    stem = os.path.splitext(filename)[0]
    if _is_admin_upload_filename(filename):
        return f'Team member {index + 1}', 'Team member'
    title = ''
    if ' - ' in stem:
        name, title = stem.split(' - ', 1)
    elif ', ' in stem:
        name, title = stem.split(', ', 1)
    else:
        parts = stem.split('_')
        if len(parts) >= 3 and parts[0].isdigit():
            name = parts[1]
            title = '_'.join(parts[2:])
        elif len(parts) == 2 and parts[0].isdigit():
            name = parts[1]
        else:
            name = re.sub(r'^\d+[-_]+', '', stem)
            name = name.replace('-', ' ').replace('_', ' ')
    name = (name or f'Team member {index + 1}').strip()
    title = (title or 'Team member').strip()
    return name, title


def _scan_team_folder():
    team_dir = _team_assets_dir()
    if not os.path.isdir(team_dir):
        return []
    allowed = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
    files = sorted(
        f for f in os.listdir(team_dir)
        if f.lower().endswith(allowed) and os.path.isfile(os.path.join(team_dir, f))
    )
    members = []
    for i, filename in enumerate(files):
        if _is_admin_upload_filename(filename):
            continue
        name, title = _name_from_team_filename(filename, i)
        members.append({
            'id': None,
            'name': name,
            'title': title,
            'photo_url': f'assets/team/{filename}',
            'sort_order': i,
            'is_published': True,
            'created_at': None,
        })
    return members


def _merged_team_members(published_only=False):
    query = SiteTeamMember.query
    if published_only:
        query = query.filter_by(is_published=True)
    db_rows = query.order_by(
        SiteTeamMember.sort_order.asc(), SiteTeamMember.id.asc()
    ).all()
    db_members = [r.to_dict() for r in db_rows]
    db_urls = {m['photo_url'] for m in db_members if m.get('photo_url')}
    folder_members = [
        m for m in _scan_team_folder()
        if m['photo_url'] not in db_urls
    ]
    if published_only:
        folder_members = [m for m in folder_members if m.get('is_published', True)]
    combined = db_members + folder_members
    combined.sort(key=lambda m: (m.get('sort_order') or 0, m.get('name') or ''))
    return combined


@bp.route('/admin/site-team', methods=['GET', 'POST'])
def admin_site_team():
    if request.method == 'GET':
        return jsonify(_merged_team_members(published_only=False))
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if len(name) < 2:
        return jsonify({'error': 'Name is required.'}), 400
    photo_url = (data.get('photo_url') or '').strip()
    if not photo_url:
        return jsonify({'error': 'Photo is required.'}), 400
    sort_order = int(data.get('sort_order') or 0)
    if not sort_order:
        max_order = db.session.query(func.max(SiteTeamMember.sort_order)).scalar()
        sort_order = (max_order or 0) + 1
    row = SiteTeamMember(
        name=name,
        title=(data.get('title') or '').strip(),
        photo_url=photo_url,
        sort_order=sort_order,
        is_published=bool(data.get('is_published', True)),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({'success': True, 'member': row.to_dict()}), 201


@bp.route('/admin/site-team/<int:member_id>', methods=['PUT', 'DELETE'])
def admin_site_team_member(member_id):
    row = SiteTeamMember.query.get_or_404(member_id)
    if request.method == 'DELETE':
        db.session.delete(row)
        db.session.commit()
        return jsonify({'success': True})
    data = request.json or {}
    if 'name' in data:
        name = (data['name'] or '').strip()
        if len(name) >= 2:
            row.name = name
    if 'title' in data:
        row.title = (data['title'] or '').strip()
    if 'photo_url' in data:
        row.photo_url = (data['photo_url'] or '').strip()
    if 'sort_order' in data:
        row.sort_order = int(data['sort_order'] or 0)
    if 'is_published' in data:
        row.is_published = bool(data['is_published'])
    db.session.commit()
    return jsonify({'success': True, 'member': row.to_dict()})


@bp.route('/admin/site-team/remove', methods=['DELETE'])
def admin_site_team_remove():
    data = request.json or {}
    member_id = data.get('id')
    photo_url = (data.get('photo_url') or '').strip()

    if member_id:
        row = SiteTeamMember.query.get(member_id)
        if row:
            if not photo_url:
                photo_url = row.photo_url or ''
            db.session.delete(row)

    if photo_url and photo_url.replace('\\', '/').startswith('assets/team/'):
        filename = os.path.basename(photo_url.replace('\\', '/'))
        file_path = os.path.join(_team_assets_dir(), filename)
        if os.path.isfile(file_path):
            os.remove(file_path)

    db.session.commit()
    return jsonify({'success': True})


@bp.route('/admin/site-team/upload', methods=['POST'])
def admin_site_team_upload():
    import os
    from werkzeug.utils import secure_filename
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    if not file or not file.filename:
        return jsonify({'error': 'No file selected'}), 400
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ('png', 'jpg', 'jpeg', 'webp', 'gif'):
        return jsonify({'error': 'Image type not allowed.'}), 400
    team_dir = _team_assets_dir()
    os.makedirs(team_dir, exist_ok=True)
    filename = secure_filename(f'team_{datetime.utcnow().strftime("%Y%m%d%H%M%S")}_{file.filename}')
    file.save(os.path.join(team_dir, filename))
    return jsonify({'success': True, 'photo_url': f'assets/team/{filename}'})


def _homepage_videos_dir():
    root = os.path.abspath(os.path.join(current_app.root_path, '..'))
    return os.path.join(root, 'portal', 'public', 'assets', 'videos')


def _homepage_video_row(slot_id):
    """slot_id is 1-based (1, 2, 3)."""
    row = SiteHomepageVideo.query.get(slot_id)
    if not row:
        idx = slot_id - 1
        defaults = DEFAULT_HOMEPAGE_VIDEO_TEXTS[idx] if idx < len(DEFAULT_HOMEPAGE_VIDEO_TEXTS) else {}
        row = SiteHomepageVideo(
            id=slot_id,
            title=defaults.get('title'),
            description=defaults.get('description'),
        )
        db.session.add(row)
        db.session.commit()
    return row


def _ensure_homepage_video_rows():
    for slot_id in range(1, HOMEPAGE_VIDEO_COUNT + 1):
        _homepage_video_row(slot_id)


def _homepage_video_url(row, slot_index):
    if row and row.custom_filename:
        return f'portal/public/assets/videos/{row.custom_filename}'
    if slot_index < len(DEFAULT_HOMEPAGE_VIDEO_PATHS):
        return DEFAULT_HOMEPAGE_VIDEO_PATHS[slot_index]
    return DEFAULT_HOMEPAGE_VIDEO_PATHS[0]


def _homepage_video_payload(row, slot_index):
    is_custom = bool(row and row.custom_filename)
    defaults = (
        DEFAULT_HOMEPAGE_VIDEO_TEXTS[slot_index]
        if slot_index < len(DEFAULT_HOMEPAGE_VIDEO_TEXTS)
        else DEFAULT_HOMEPAGE_VIDEO_TEXTS[0]
    )
    title = (row.title if row and row.title else None) or defaults.get('title', '')
    description = (row.description if row and row.description else None) or defaults.get('description', '')
    return {
        'index': slot_index,
        'id': slot_index + 1,
        'title': title,
        'description': description,
        'video_url': _homepage_video_url(row, slot_index),
        'is_custom': is_custom,
    }


def _homepage_videos_list_payload():
    videos = []
    for slot_index in range(HOMEPAGE_VIDEO_COUNT):
        row = _homepage_video_row(slot_index + 1)
        videos.append(_homepage_video_payload(row, slot_index))
    return {'videos': videos, 'count': HOMEPAGE_VIDEO_COUNT}


def _parse_video_index(data=None):
    raw = None
    if data is not None:
        raw = data.get('video_index')
    if raw is None and request.args:
        raw = request.args.get('video_index')
    if raw is None and request.form:
        raw = request.form.get('video_index')
    try:
        idx = int(raw if raw is not None else 0)
    except (TypeError, ValueError):
        idx = 0
    if idx < 0 or idx >= HOMEPAGE_VIDEO_COUNT:
        return None
    return idx


def _remove_custom_homepage_video_file(filename):
    if not filename:
        return
    file_path = os.path.join(_homepage_videos_dir(), filename)
    if os.path.isfile(file_path):
        os.remove(file_path)


@bp.route('/homepage-video', methods=['GET'])
def get_homepage_video():
    return jsonify(_homepage_videos_list_payload())


@bp.route('/admin/homepage-video', methods=['PATCH'])
def admin_homepage_video_text():
    data = request.json or {}
    slot_index = _parse_video_index(data)
    if slot_index is None:
        return jsonify({'error': 'Invalid video index.'}), 400
    row = _homepage_video_row(slot_index + 1)
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'Intro title is required.'}), 400
        row.title = title[:300]
    if 'description' in data:
        row.description = (data.get('description') or '').strip()
    db.session.commit()
    return jsonify(_homepage_video_payload(row, slot_index))


@bp.route('/admin/homepage-video/upload', methods=['POST'])
def admin_homepage_video_upload():
    from werkzeug.utils import secure_filename
    slot_index = _parse_video_index()
    if slot_index is None:
        return jsonify({'error': 'Invalid video index.'}), 400
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    if not file or not file.filename:
        return jsonify({'error': 'No file selected'}), 400
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ('mp4', 'webm'):
        return jsonify({'error': 'Only MP4 or WebM videos are allowed.'}), 400
    videos_dir = _homepage_videos_dir()
    os.makedirs(videos_dir, exist_ok=True)
    row = _homepage_video_row(slot_index + 1)
    if row.custom_filename:
        _remove_custom_homepage_video_file(row.custom_filename)
    filename = secure_filename(
        f'homepage_{slot_index + 1}_{datetime.utcnow().strftime("%Y%m%d%H%M%S")}_{file.filename}'
    )
    file.save(os.path.join(videos_dir, filename))
    row.custom_filename = filename
    db.session.commit()
    return jsonify(_homepage_video_payload(row, slot_index))


@bp.route('/admin/homepage-video', methods=['DELETE'])
def admin_homepage_video_reset():
    slot_index = _parse_video_index()
    if slot_index is None:
        return jsonify({'error': 'Invalid video index.'}), 400
    row = _homepage_video_row(slot_index + 1)
    if row.custom_filename:
        _remove_custom_homepage_video_file(row.custom_filename)
        row.custom_filename = None
        db.session.commit()
    return jsonify(_homepage_video_payload(row, slot_index))


def _migrate_site_homepage_video_table():
    try:
        SiteHomepageVideo.__table__.create(db.engine, checkfirst=True)
    except Exception as e:
        print(f'SiteHomepageVideo table: {e}')


def _migrate_site_stats_visitors_date():
    try:
        with db.engine.connect() as conn:
            conn.execute(text('ALTER TABLE site_stats ADD COLUMN visitors_date DATE'))
            conn.commit()
    except Exception as e:
        if 'duplicate column' not in str(e).lower() and 'already exists' not in str(e).lower():
            print(f'migrate site_stats visitors_date: {e}')


def init_public_db():
    _migrate_content_caption_column()
    _migrate_contact_reply_columns()
    _migrate_site_stats_visitors_date()
    _migrate_site_homepage_video_table()
    try:
        SiteTeamMember.__table__.create(db.engine, checkfirst=True)
    except Exception as e:
        print(f'SiteTeamMember table: {e}')
    # Ensure all 17 Categories exist (1-12 for gallery, 13 for Hero, 14-17 for sections)
    for i in range(1, 18):
        cat = ContentCategory.query.get(i)
        if not cat:
            db.session.add(ContentCategory(id=i, name=f"Category {i}" if i <= 12 else "Hero Section"))
    
    # Initial Teams if none exist
    if not Team.query.first():
        db.session.add(Team(name="Beach Cleaning Squad", category="Environmental", member_count=24, image_url="https://images.pexels.com/photos/4101553/pexels-photo-4101553.jpeg?auto=compress&cs=tinysrgb&w=600"))
        db.session.add(Team(name="Ramadan Iftar Heroes", category="Charity", member_count=42, image_url="https://images.pexels.com/photos/6994982/pexels-photo-6994982.jpeg?auto=compress&cs=tinysrgb&w=600"))
        db.session.add(Team(name="Summer Mentors", category="Education", member_count=18, image_url="https://images.pexels.com/photos/5212345/pexels-photo-5212345.jpeg?auto=compress&cs=tinysrgb&w=600"))
    
    # Init stats if none exist
    if not SiteStats.query.first():
        db.session.add(SiteStats(
            today_visitors=0,
            total_visitors=1250,
            visitors_date=_site_today(),
        ))
        
    db.session.commit()
    print("Public website data initialized.")
    _ensure_homepage_video_rows()

    try:
        from routes.articles_api import seed_articles, init_articles_settings
        init_articles_settings()
        seed_articles()
    except Exception as e:
        print(f"Articles seed skipped or failed: {e}")

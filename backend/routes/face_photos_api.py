"""
Face photo finder API.
- Members: username/password → email OTP → list events/photos → record downloads
- Media Admin (role only; assign via Main Leader): create/delete events, upload/delete photos, download stats
Group photos: client matches any face in the image (already supported).
"""
from __future__ import annotations

import json
import os
import random
import re
import shutil
import string
import threading
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_mail import Message
from sqlalchemy import func
from werkzeug.utils import secure_filename

from extensions import bcrypt, db, mail
from models import User

bp = Blueprint('face_photos', __name__)

ALLOWED_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
MEDIA_ADMIN_ROLE = 'Media Admin'


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


def _send_face_otp_email(user):
    if not user.email or '@' not in user.email:
        return False, 'No registered email on this account. Ask Main Leader to add your email.'
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
        subject=f'{org} — verification code — Find My Photos',
        sender=sender,
        recipients=[user.email],
        body=(
            f'Hello {user.name},\n\n'
            f'Your verification code to access Find My Photos is: {otp}\n\n'
            f'This code expires in 10 minutes.\n\n'
            f'If you did not request this, ignore this email.\n\n'
            f'— {org}'
        ),
    )
    mail.send(msg)
    return True, None


def _root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'face_recognition'))


def _uploads():
    path = os.path.join(_root(), 'uploads')
    os.makedirs(path, exist_ok=True)
    return path


def _events_meta_path():
    return os.path.join(_root(), 'data', 'events.json')


def _downloads_path():
    return os.path.join(_root(), 'data', 'downloads.json')


def _matches_path():
    return os.path.join(_root(), 'data', 'matches.json')


def _load_matches():
    path = _matches_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_matches(data):
    path = _matches_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _event_title(event_id: str) -> str:
    for e in _load_events():
        if e.get('id') == event_id:
            return e.get('title') or event_id
    return (event_id or 'Event').replace('-', ' ').title()


def _notify_members_photos_ready(event_id: str, photo_count: int):
    """Email HSF members that event photos are ready (runs in a background thread)."""
    app_obj = current_app._get_current_object()

    def _send():
        with app_obj.app_context():
            try:
                from utils.email_helpers import club_official_name, email_closing, safe_send_mail
                title = _event_title(event_id)
                org = club_official_name(app_obj)
                members = User.hsf_members_query().filter(
                    User.email.isnot(None),
                    User.email != '',
                ).all()
                subject = f'{org} — {title} photos are now ready'
                body = (
                    f'Hello,\n\n'
                    f'{title}\'s photos are now ready.\n\n'
                    f'{photo_count} new photo(s) were uploaded. '
                    f'Open Find My Photos in the HSF portal (or on the website), '
                    f'scan your face or upload a selfie, and download only the pictures that include you.\n\n'
                    f'{email_closing(app_obj)}'
                )
                for m in members:
                    email = (m.email or '').strip()
                    if not email or '@' not in email:
                        continue
                    personalized = body.replace('Hello,', f'Hello {m.name},', 1)
                    safe_send_mail(
                        app_obj,
                        subject,
                        [email],
                        personalized,
                        user_id=m.id,
                        category='face_photos',
                    )
            except Exception as e:
                print(f'Photos-ready email notify failed: {e}')

    threading.Thread(target=_send, daemon=True).start()


def _notify_downloaded_photos_deleted(event_id: str, photo_count: int, user_ids):
    """Email members whose downloaded/matched photos were removed by Media Admin."""
    app_obj = current_app._get_current_object()
    ids = list(user_ids or [])

    def _send():
        with app_obj.app_context():
            try:
                from utils.email_helpers import club_official_name, email_closing, safe_send_mail
                title = _event_title(event_id)
                org = club_official_name(app_obj)
                subject = f'{org} — downloaded photo(s) removed'
                body_tpl = (
                    f'Hello,\n\n'
                    f'A Media Admin removed {photo_count} photo(s) from “{title}” '
                    f'that you had downloaded or saved in Find My Photos.\n\n'
                    f'Those pictures are no longer available in the portal. '
                    f'If you already saved them on your device, you still have your copies.\n\n'
                    f'{email_closing(app_obj)}'
                )
                for uid in ids:
                    m = User.query.get(uid)
                    if not m:
                        continue
                    email = (m.email or '').strip()
                    if not email or '@' not in email:
                        continue
                    personalized = body_tpl.replace('Hello,', f'Hello {m.name},', 1)
                    safe_send_mail(
                        app_obj,
                        subject,
                        [email],
                        personalized,
                        user_id=m.id,
                        category='face_photos',
                    )
            except Exception as e:
                print(f'Downloaded-photos-deleted email notify failed: {e}')

    threading.Thread(target=_send, daemon=True).start()


def _load_events():
    path = _events_meta_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save_events(events):
    path = _events_meta_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(events, f, indent=2, ensure_ascii=False)


def _load_downloads():
    path = _downloads_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_downloads(data):
    path = _downloads_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _slug(name: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9\-]+', '-', (name or 'event').strip().lower())
    s = re.sub(r'-+', '-', s).strip('-') or 'event'
    return s[:60]


def _event_dir(event_id: str, create=False) -> str | None:
    eid = secure_filename(event_id or '')
    if not eid or '..' in eid:
        return None
    path = os.path.join(_uploads(), eid)
    if create:
        os.makedirs(path, exist_ok=True)
        return path
    if not os.path.isdir(path):
        return None
    return path


def _check_password(user: User, password: str) -> bool:
    password = (password or '').strip()
    stored = user.password or ''
    if stored == password:
        return True
    if stored.startswith('$2b$'):
        try:
            return bcrypt.check_password_hash(stored, password)
        except Exception:
            return False
    return False


def _creds_from_request():
    data = request.get_json(silent=True) or {}
    username = (
        data.get('username')
        or request.form.get('username')
        or request.headers.get('X-Username')
        or request.args.get('username')
        or ''
    ).lower().strip()
    password = (
        data.get('password')
        or request.form.get('password')
        or request.headers.get('X-Password')
        or request.args.get('password')
        or ''
    ).strip()
    return username, password


def _authenticate(require_media_admin=False):
    username, password = _creds_from_request()
    if not username or not password:
        return None, (jsonify({'error': 'Login required (username and password).'}), 401)
    user = User.query.filter(func.lower(User.username) == username).first()
    if not user or not _check_password(user, password):
        return None, (jsonify({'error': 'Invalid username or password.'}), 401)
    if user.role == 'Public User' or user.is_alnuur_guest() or user.is_summer_guest():
        return None, (jsonify({'error': 'Members only.'}), 403)
    if require_media_admin:
        if user.role != MEDIA_ADMIN_ROLE and user.role != 'Main Leader':
            return None, (jsonify({'error': 'Media Admin only. Ask Main Leader to assign the Media Admin role.'}), 403)
    return user, None


def _public_user(user: User):
    return {
        'id': user.id,
        'name': user.name,
        'username': user.username,
        'role': user.role,
        'is_media_admin': user.role == MEDIA_ADMIN_ROLE or user.role == 'Main Leader',
    }


@bp.route('/login', methods=['POST'])
def face_login():
    """Step 1: username/password → send email OTP (Summer Course pattern)."""
    username, password = _creds_from_request()
    if not username or not password:
        return jsonify({'error': 'Username and password required.'}), 400
    user = User.query.filter(func.lower(User.username) == username).first()
    if not user or not _check_password(user, password):
        return jsonify({'error': 'Invalid username or password.'}), 401
    if user.role == 'Public User' or user.is_alnuur_guest() or user.is_summer_guest():
        return jsonify({'error': 'HSF members only.'}), 403
    try:
        ok, err = _send_face_otp_email(user)
    except Exception as e:
        print(f'Find My Photos OTP email failed: {e}')
        return jsonify({'error': 'Could not send verification email. Try again later.'}), 502
    if not ok:
        return jsonify({'error': err}), 400
    return jsonify({
        'success': True,
        'otp_required': True,
        'user_id': user.id,
        'email_masked': _mask_email(user.email),
        'user': _public_user(user),
    })


@bp.route('/verify-otp', methods=['POST'])
def face_verify_otp():
    """Step 2: verify email code after password check."""
    data = request.get_json(silent=True) or {}
    username, password = _creds_from_request()
    otp = (data.get('otp') or request.form.get('otp') or '').strip()
    if not username or not password:
        return jsonify({'error': 'Username and password required.'}), 400
    if not otp:
        return jsonify({'error': 'Verification code required.'}), 400
    user = User.query.filter(func.lower(User.username) == username).first()
    if not user or not _check_password(user, password):
        return jsonify({'error': 'Invalid username or password.'}), 401
    if user.role == 'Public User' or user.is_alnuur_guest() or user.is_summer_guest():
        return jsonify({'error': 'HSF members only.'}), 403
    if not user.otp_code:
        return jsonify({'error': 'No verification code pending. Request a new code.'}), 400
    if (user.otp_attempts or 0) >= 5:
        return jsonify({'error': 'Too many attempts. Request a new code.'}), 429
    if user.otp_expiry and datetime.utcnow() > user.otp_expiry:
        return jsonify({'error': 'Code expired. Request a new code.'}), 400
    if user.otp_code != otp:
        user.otp_attempts = (user.otp_attempts or 0) + 1
        db.session.commit()
        return jsonify({'error': 'Invalid verification code.'}), 401
    user.otp_code = None
    user.otp_expiry = None
    user.otp_attempts = 0
    db.session.commit()
    return jsonify({
        'success': True,
        'user': _public_user(user),
    })


@bp.route('/resend-otp', methods=['POST'])
def face_resend_otp():
    username, password = _creds_from_request()
    if not username or not password:
        return jsonify({'error': 'Username and password required.'}), 400
    user = User.query.filter(func.lower(User.username) == username).first()
    if not user or not _check_password(user, password):
        return jsonify({'error': 'Invalid username or password.'}), 401
    if user.role == 'Public User' or user.is_alnuur_guest() or user.is_summer_guest():
        return jsonify({'error': 'HSF members only.'}), 403
    try:
        ok, err = _send_face_otp_email(user)
    except Exception as e:
        print(f'Find My Photos OTP resend failed: {e}')
        return jsonify({'error': 'Could not send verification email. Try again later.'}), 502
    if not ok:
        return jsonify({'error': err}), 400
    return jsonify({
        'success': True,
        'email_masked': _mask_email(user.email),
    })


@bp.route('/events', methods=['GET'])
def list_events():
    user, err = _authenticate(require_media_admin=False)
    if err:
        return err
    events = _load_events()
    uploads = _uploads()
    known = {e.get('id') for e in events}
    for name in sorted(os.listdir(uploads)):
        full = os.path.join(uploads, name)
        if os.path.isdir(full) and name not in known and not name.startswith('.'):
            events.append({
                'id': name,
                'title': name.replace('-', ' ').title(),
                'created_at': None,
            })
    downloads = _load_downloads()
    out = []
    for e in events:
        eid = e.get('id')
        folder = os.path.join(uploads, eid) if eid else None
        count = 0
        if folder and os.path.isdir(folder):
            count = sum(
                1 for f in os.listdir(folder)
                if os.path.splitext(f)[1].lower() in ALLOWED_EXT
            )
        dl_users = set()
        for key, rows in downloads.items():
            if key.startswith(f'{eid}/') and isinstance(rows, list):
                for row in rows:
                    if row.get('user_id'):
                        dl_users.add(row['user_id'])
        out.append({
            'id': eid,
            'title': e.get('title') or eid,
            'created_at': e.get('created_at'),
            'photo_count': count,
            'downloaders_count': len(dl_users),
        })
    out.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    return jsonify({'events': out, 'user': _public_user(user)})


@bp.route('/events', methods=['POST'])
def create_event():
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip() or f'Event {datetime.utcnow().strftime("%Y-%m-%d")}'
    base = _slug(title)
    eid = base
    n = 1
    while os.path.isdir(os.path.join(_uploads(), eid)):
        n += 1
        eid = f'{base}-{n}'
    os.makedirs(os.path.join(_uploads(), eid), exist_ok=True)
    events = _load_events()
    row = {
        'id': eid,
        'title': title,
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'created_by': user.username,
    }
    events.append(row)
    _save_events(events)
    return jsonify({'success': True, 'event': row})


@bp.route('/events/<event_id>', methods=['DELETE'])
def delete_event(event_id):
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    folder = _event_dir(event_id)
    if folder and os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    events = [e for e in _load_events() if e.get('id') != event_id]
    _save_events(events)
    downloads = _load_downloads()
    prefix = f'{event_id}/'
    for key in list(downloads.keys()):
        if key.startswith(prefix):
            del downloads[key]
    _save_downloads(downloads)
    return jsonify({'success': True})


@bp.route('/events/<event_id>/photos', methods=['GET'])
def list_photos(event_id):
    user, err = _authenticate(require_media_admin=False)
    if err:
        return err
    folder = _event_dir(event_id)
    if not folder:
        return jsonify({'error': 'Event not found.'}), 404
    downloads = _load_downloads()
    store = _load_matches()
    ignored = set((store.get(str(user.id)) or {}).get('ignored') or [])
    photos = []
    for name in sorted(os.listdir(folder)):
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED_EXT:
            continue
        key = f'{event_id}/{name}'
        rows = [r for r in (downloads.get(key) or []) if isinstance(r, dict)]
        downloaded = any(r.get('user_id') == user.id for r in rows)
        full = os.path.join(folder, name)
        try:
            uploaded_at = datetime.utcfromtimestamp(os.path.getmtime(full)).isoformat() + 'Z'
        except OSError:
            uploaded_at = None
        photos.append({
            'id': name,
            'url': f'/api/face-photos/files/{event_id}/{name}',
            'name': name,
            'downloaded': downloaded,
            'anyone_downloaded': len(rows) > 0,
            'download_count': len(rows),
            'uploaded_at': uploaded_at,
            'ignored': key in ignored,
        })
    return jsonify({'event_id': event_id, 'photos': photos, 'count': len(photos)})


@bp.route('/events/<event_id>/photos', methods=['DELETE'])
def erase_all_photos(event_id):
    """Delete every photo file in an event; keep the event folder and metadata."""
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    folder = _event_dir(event_id)
    if not folder:
        return jsonify({'error': 'Event not found.'}), 404
    removed = 0
    downloads = _load_downloads()
    changed_dl = False
    for name in list(os.listdir(folder)):
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED_EXT:
            continue
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        try:
            os.remove(path)
            removed += 1
        except OSError:
            continue
        key = f'{event_id}/{name}'
        if key in downloads:
            del downloads[key]
            changed_dl = True
    if changed_dl:
        _save_downloads(downloads)
    return jsonify({'success': True, 'removed': removed})


@bp.route('/events/<event_id>/upload', methods=['POST'])
def upload_photos(event_id):
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    folder = _event_dir(event_id, create=True)
    if not folder:
        return jsonify({'error': 'Invalid event.'}), 400

    files = request.files.getlist('photos') or request.files.getlist('files')
    if not files:
        single = request.files.get('photo') or request.files.get('file')
        files = [single] if single else []
    if not files:
        return jsonify({'error': 'No photos uploaded.'}), 400

    saved = []
    for f in files:
        if not f or not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            continue
        safe = secure_filename(f.filename)
        unique = f'{uuid.uuid4().hex[:10]}_{safe}'
        dest = os.path.join(folder, unique)
        f.save(dest)
        saved.append({
            'id': unique,
            'url': f'/api/face-photos/files/{event_id}/{unique}',
            'name': unique,
        })
    if saved:
        # Client can pass ?notify=0 for intermediate batches so members get one email at the end.
        if request.args.get('notify', '1') != '0':
            _notify_members_photos_ready(event_id, len(saved))
    return jsonify({'success': True, 'saved': len(saved), 'photos': saved})


@bp.route('/events/<event_id>/photos/<path:filename>', methods=['DELETE'])
def delete_photo(event_id, filename):
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    folder = _event_dir(event_id)
    if not folder:
        return jsonify({'error': 'Event not found.'}), 404
    raw = os.path.basename(filename.replace('\\', '/'))
    path = os.path.join(folder, raw)
    if not os.path.isfile(path):
        return jsonify({'error': 'Photo not found.'}), 404
    os.remove(path)
    downloads = _load_downloads()
    key = f'{event_id}/{raw}'
    if key in downloads:
        del downloads[key]
        _save_downloads(downloads)
    return jsonify({'success': True})


@bp.route('/events/<event_id>/downloads', methods=['GET'])
def event_download_stats(event_id):
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    downloads = _load_downloads()
    prefix = f'{event_id}/'
    by_user = {}
    for key, rows in downloads.items():
        if not key.startswith(prefix) or not isinstance(rows, list):
            continue
        for row in rows:
            uid = row.get('user_id') or row.get('username')
            if not uid:
                continue
            entry = by_user.setdefault(uid, {
                'user_id': row.get('user_id'),
                'username': row.get('username'),
                'name': row.get('name'),
                'photo_count': 0,
                'last_download_at': None,
            })
            entry['photo_count'] += 1
            ts = row.get('downloaded_at')
            if ts and (not entry['last_download_at'] or ts > entry['last_download_at']):
                entry['last_download_at'] = ts
    stats = sorted(by_user.values(), key=lambda x: -(x.get('photo_count') or 0))
    return jsonify({'event_id': event_id, 'downloaders': stats, 'total_downloaders': len(stats)})


@bp.route('/events/<event_id>/downloads', methods=['DELETE'])
def delete_downloaded_photos(event_id):
    """
    Delete photo files that anyone has already downloaded (free disk).
    Keeps Who-downloaded history. Removes those photos from members' My Photos
    and emails downloaders that admin removed the files.
    """
    user, err = _authenticate(require_media_admin=True)
    if err:
        return err
    folder = _event_dir(event_id)
    if not folder:
        return jsonify({'error': 'Event not found.'}), 404

    downloads = _load_downloads()
    prefix = f'{event_id}/'
    # Keys that have at least one download record (history stays; files go)
    downloaded_keys = [
        key for key, rows in downloads.items()
        if key.startswith(prefix) and isinstance(rows, list) and len(rows) > 0
    ]
    if not downloaded_keys:
        return jsonify({'success': True, 'removed': 0, 'notified': 0})

    removed_names = []
    notify_user_ids = set()
    for key in downloaded_keys:
        name = key[len(prefix):] if key.startswith(prefix) else os.path.basename(key)
        if not name or '/' in name or '\\' in name:
            continue
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            try:
                os.remove(path)
                removed_names.append(name)
            except OSError:
                continue
        else:
            # File already gone — still scrub matches / notify for this key
            removed_names.append(name)
        for row in downloads.get(key) or []:
            if isinstance(row, dict) and row.get('user_id'):
                notify_user_ids.add(str(row['user_id']))

    removed_keys = {f'{event_id}/{n}' for n in removed_names}

    # Remove from every member's My Photos (matches.json)
    store = _load_matches()
    store_changed = False
    for uid, entry in list(store.items()):
        if not isinstance(entry, dict):
            continue
        photos = entry.get('photos') or []
        kept = [
            p for p in photos
            if f"{p.get('event_id')}/{p.get('name')}" not in removed_keys
        ]
        if len(kept) != len(photos):
            entry['photos'] = kept
            store[uid] = entry
            store_changed = True
            notify_user_ids.add(str(uid))
    if store_changed:
        _save_matches(store)

    # downloads.json intentionally unchanged — Who downloaded table stays

    if removed_names and notify_user_ids:
        _notify_downloaded_photos_deleted(event_id, len(removed_names), notify_user_ids)

    return jsonify({
        'success': True,
        'removed': len(removed_names),
        'notified': len(notify_user_ids),
    })


@bp.route('/events/<event_id>/photos/<path:filename>/download', methods=['POST'])
def record_download(event_id, filename):
    user, err = _authenticate(require_media_admin=False)
    if err:
        return err
    folder = _event_dir(event_id)
    raw = os.path.basename(filename.replace('\\', '/'))
    if not folder or not os.path.isfile(os.path.join(folder, raw)):
        return jsonify({'error': 'Photo not found.'}), 404
    downloads = _load_downloads()
    key = f'{event_id}/{raw}'
    rows = downloads.get(key) or []
    # one entry per user per photo (update timestamp)
    rows = [r for r in rows if r.get('user_id') != user.id]
    rows.append({
        'user_id': user.id,
        'username': user.username,
        'name': user.name,
        'downloaded_at': datetime.utcnow().isoformat() + 'Z',
    })
    downloads[key] = rows
    _save_downloads(downloads)
    return jsonify({
        'success': True,
        'url': f'/api/face-photos/files/{event_id}/{raw}',
    })


@bp.route('/my-photos', methods=['GET'])
def list_my_photos():
    """Saved face matches for current member (My Photos sidebar)."""
    user, err = _authenticate(require_media_admin=False)
    if err:
        return err
    store = _load_matches()
    entry = store.get(str(user.id)) or {'photos': [], 'ignored': []}
    ignored = set(entry.get('ignored') or [])
    downloads = _load_downloads()
    photos = []
    for p in entry.get('photos') or []:
        key = f"{p.get('event_id')}/{p.get('name')}"
        if key in ignored:
            continue
        folder = _event_dir(p.get('event_id') or '')
        name = p.get('name') or ''
        if not folder or not name or not os.path.isfile(os.path.join(folder, name)):
            continue
        rows = downloads.get(key) or []
        downloaded = any(r.get('user_id') == user.id for r in rows if isinstance(r, dict))
        photos.append({
            **p,
            'url': f"/api/face-photos/files/{p.get('event_id')}/{p.get('name')}",
            'downloaded': downloaded,
            'key': key,
        })
    photos.sort(key=lambda x: x.get('matched_at') or '', reverse=True)
    return jsonify({'photos': photos, 'count': len(photos)})


@bp.route('/my-photos', methods=['POST'])
def save_my_photos():
    """Save matched photos (regardless of download)."""
    user, err = _authenticate(require_media_admin=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    items = data.get('photos') or []
    if not isinstance(items, list):
        return jsonify({'error': 'photos array required.'}), 400
    store = _load_matches()
    uid = str(user.id)
    entry = store.get(uid) or {'photos': [], 'ignored': []}
    ignored = set(entry.get('ignored') or [])
    by_key = {f"{p.get('event_id')}/{p.get('name')}": p for p in (entry.get('photos') or [])}
    added = 0
    for item in items:
        eid = (item.get('event_id') or '').strip()
        name = os.path.basename((item.get('name') or '').replace('\\', '/'))
        if not eid or not name:
            continue
        key = f'{eid}/{name}'
        if key in ignored:
            continue
        folder = _event_dir(eid)
        if not folder or not os.path.isfile(os.path.join(folder, name)):
            continue
        if key not in by_key:
            added += 1
        by_key[key] = {
            'event_id': eid,
            'name': name,
            'title': item.get('title') or eid,
            'matched_at': item.get('matched_at') or (datetime.utcnow().isoformat() + 'Z'),
            'dist': item.get('dist'),
        }
    entry['photos'] = list(by_key.values())
    entry['ignored'] = list(ignored)
    store[uid] = entry
    _save_matches(store)
    return jsonify({'success': True, 'saved': added, 'total': len(entry['photos'])})


@bp.route('/my-photos/ignore', methods=['POST'])
def ignore_my_photo():
    """Remove incorrect match from My Photos / future match lists."""
    user, err = _authenticate(require_media_admin=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    eid = (data.get('event_id') or '').strip()
    name = os.path.basename((data.get('name') or '').replace('\\', '/'))
    if not eid or not name:
        return jsonify({'error': 'event_id and name required.'}), 400
    key = f'{eid}/{name}'
    store = _load_matches()
    uid = str(user.id)
    entry = store.get(uid) or {'photos': [], 'ignored': []}
    ignored = set(entry.get('ignored') or [])
    ignored.add(key)
    entry['ignored'] = list(ignored)
    entry['photos'] = [
        p for p in (entry.get('photos') or [])
        if f"{p.get('event_id')}/{p.get('name')}" != key
    ]
    store[uid] = entry
    _save_matches(store)
    return jsonify({'success': True})


@bp.route('/files/<event_id>/<path:filename>', methods=['GET'])
def serve_file(event_id, filename):
    folder = _event_dir(event_id)
    if not folder:
        return jsonify({'error': 'Not found'}), 404
    raw = os.path.basename(filename.replace('\\', '/'))
    if not os.path.isfile(os.path.join(folder, raw)):
        return jsonify({'error': 'Not found'}), 404
    return send_from_directory(folder, raw)

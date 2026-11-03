from flask import Blueprint, jsonify, request
from sqlalchemy import or_, and_
from extensions import db
from models import Notification, User

bp = Blueprint('notifications', __name__)

PUBLIC_ADMIN_CATEGORIES = ('contact', 'public_registration')


def _public_admin_scope(query):
    """Public admin panel: contact messages + public site registrations only."""
    return query.filter(
        or_(
            Notification.category.in_(PUBLIC_ADMIN_CATEGORIES),
            and_(
                Notification.category == 'registration',
                Notification.title.like('New public site registration:%'),
            ),
        )
    )


@bp.route('', methods=['GET'])
def list_notifications():
    user_id = (request.args.get('user_id') or '').strip()
    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    limit = min(int(request.args.get('limit', 50)), 100)
    scope = (request.args.get('scope') or '').strip().lower()
    base = Notification.query.filter_by(user_id=user_id)
    if scope == 'public':
        base = _public_admin_scope(base)

    items = base.order_by(Notification.created_at.desc()).limit(limit).all()
    unread_q = Notification.query.filter_by(user_id=user_id, is_read=False)
    if scope == 'public':
        unread_q = _public_admin_scope(unread_q)
    unread = unread_q.count()
    return jsonify({
        'notifications': [n.to_dict() for n in items],
        'unread_count': unread,
    })


@bp.route('/<int:notification_id>/read', methods=['POST'])
def mark_read(notification_id):
    data = request.json or {}
    user_id = (data.get('user_id') or request.args.get('user_id') or '').strip()
    n = db.session.get(Notification, notification_id)
    if not n:
        return jsonify({'success': False, 'error': 'Not found'}), 404
    if user_id and n.user_id != user_id:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    n.is_read = True
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/mark-all-read', methods=['POST'])
def mark_all_read():
    data = request.json or {}
    user_id = (data.get('user_id') or '').strip()
    if not user_id:
        return jsonify({'success': False, 'error': 'user_id is required'}), 400
    scope = (data.get('scope') or '').strip().lower()
    q = Notification.query.filter_by(user_id=user_id, is_read=False)
    if scope == 'public':
        q = _public_admin_scope(q)
    q.update({'is_read': True})
    db.session.commit()
    return jsonify({'success': True})

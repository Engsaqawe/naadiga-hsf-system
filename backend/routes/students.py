from datetime import datetime
from flask import Blueprint, jsonify, request
from sqlalchemy import func, text, inspect
from sqlalchemy.exc import IntegrityError
from extensions import db, bcrypt
from models import (
    User, Transaction, Attendance, Notification,
    MemberHelpRequest, QuranContestApplication, SummerCourseApplication,
)

bp = Blueprint('users', __name__)

CARD_NUMBER_IN_USE_MSG = 'This card number is already in use.'
GRADUATED_ON_ACTIVE_CONV_ERROR = (
    'Graduated members must belong to a graduated convocation (dufcad). '
    'To use an active dufcad, set Member Status to Active.'
)
ACTIVE_ON_GRADUATED_CONV_ERROR = (
    'Active members cannot be assigned to a graduated convocation (dufcad).'
)


def _member_convocation_status_error(conv_name, is_graduated):
    """Reject mismatched member graduation status vs convocation batch."""
    from models import Convocation
    name = (conv_name or '').strip()
    if not name:
        return 'Convocation is required. Every member must belong to a convocation.'
    conv = Convocation.query.filter(
        db.func.lower(Convocation.name) == name.lower()
    ).first()
    if not conv:
        return None
    if is_graduated and not conv.isGraduated:
        return GRADUATED_ON_ACTIVE_CONV_ERROR
    if not is_graduated and conv.isGraduated:
        return ACTIVE_ON_GRADUATED_CONV_ERROR
    return None


def _delete_member_related_records(user_id):
    """Remove child rows that reference user.id before deleting the member."""
    MemberHelpRequest.query.filter_by(user_id=user_id).delete()
    QuranContestApplication.query.filter_by(user_id=user_id).delete()
    SummerCourseApplication.query.filter_by(user_id=user_id).delete()
    Transaction.query.filter_by(student_id=user_id).delete()
    Attendance.query.filter_by(student_id=user_id).delete()
    Notification.query.filter_by(user_id=user_id).delete()


def _card_number_in_use(card_number, exclude_user_id=None):
    cn = (card_number or '').strip()
    if not cn:
        return False
    q = User.query.filter(func.lower(User.card_number) == cn.lower())
    if exclude_user_id:
        q = q.filter(User.id != exclude_user_id)
    return q.first() is not None


def init_user_schema():
    """Add faculty / semester columns on existing databases."""
    try:
        insp = inspect(db.engine)
        if not insp.has_table('user'):
            return
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'faculty' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN faculty VARCHAR(100)"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'semester' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN semester VARCHAR(50)"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'has_works' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN has_works TINYINT(1) DEFAULT 0"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'work_place' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN work_place VARCHAR(200)"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'work_role' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN work_role VARCHAR(100)"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'work_started' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN work_started VARCHAR(20)"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('user')}
        if 'card_number' not in cols:
            db.session.execute(text(
                "ALTER TABLE user ADD COLUMN card_number VARCHAR(50)"
            ))
            db.session.commit()
        _backfill_alnuur_guest_roles()
    except Exception as e:
        db.session.rollback()
        print(f'User schema migration skipped: {e}')


def _backfill_alnuur_guest_roles():
    """Alnuur Quran-only registrants must not appear as HSF members."""
    stubs = User.query.filter(User.id.like('alnuur-%')).all()
    changed = False
    for user in stubs:
        if user.role != User.ALNUUR_GUEST_ROLE:
            user.role = User.ALNUUR_GUEST_ROLE
            changed = True
        if user.convocation:
            user.convocation = None
            changed = True
    if changed:
        db.session.commit()


def _normalize_email(email):
    return (email or '').strip().lower()


def _email_in_use(email, exclude_id=None):
    """True if another HSF member already uses this email (public users are ignored)."""
    normalized = _normalize_email(email)
    if not normalized or '@' not in normalized:
        return False
    q = User.hsf_members_query().filter(func.lower(User.email) == normalized)
    if exclude_id:
        q = q.filter(User.id != exclude_id)
    return q.first() is not None


def _id_or_username_taken(user_id, username, exclude_id=None):
    q = User.query.filter((User.id == user_id) | (func.lower(User.username) == username))
    if exclude_id:
        q = q.filter(User.id != exclude_id)
    return q.first() is not None


def _login_ident(user):
    return (user.username or user.id or '').strip().lower()


def _apply_login_ident_change(user, new_ident):
    """Keep member id and login username in sync; cascade PK updates to related rows."""
    new_ident = (new_ident or '').strip().lower()
    if not new_ident:
        raise ValueError('Member ID / Username is required.')

    if user.id == new_ident and (user.username or '').lower() == new_ident:
        return

    if _id_or_username_taken(new_ident, new_ident, exclude_id=user.id):
        raise ValueError('Another member already uses this ID / Username.')

    old_id = user.id
    if old_id == new_ident:
        user.username = new_ident
        return

    # MySQL requires the parent user row to exist before child FKs can point at it.
    db.session.execute(text('SET FOREIGN_KEY_CHECKS=0'))
    try:
        user.id = new_ident
        user.username = new_ident
        db.session.flush()

        Transaction.query.filter_by(student_id=old_id).update(
            {'student_id': new_ident}, synchronize_session=False
        )
        Attendance.query.filter_by(student_id=old_id).update(
            {'student_id': new_ident}, synchronize_session=False
        )
        Notification.query.filter_by(user_id=old_id).update(
            {'user_id': new_ident}, synchronize_session=False
        )
    finally:
        db.session.execute(text('SET FOREIGN_KEY_CHECKS=1'))

@bp.route('', methods=['GET', 'POST'])
def handle_users():
    if request.method == 'GET':
        role = request.args.get('role')
        convocation = request.args.get('convocation')

        if role == User.ALNUUR_GUEST_ROLE:
            return jsonify([])

        query = User.hsf_members_query() if not role else User.query.filter_by(role=role)
        if role and role not in User.HSF_MEMBER_ROLES:
            return jsonify([])
            
        if convocation:
            query = query.filter(db.func.lower(User.convocation) == db.func.lower(convocation))

        users = query.all()
        return jsonify([u.to_dict() for u in users])

    # POST – Create new user
    data = request.json
    try:
        from models import Convocation
        
        login = (data.get('id') or data.get('username') or '').strip().lower()

        if not login:
            return jsonify({"success": False, "error": "ID/Username is required."}), 400

        user_id = login
        username = login

        if _id_or_username_taken(user_id, username):
            return jsonify({"success": False, "error": "Member already exists with this ID or Username."}), 400

        email = _normalize_email(data.get('email', ''))
        if not email or '@' not in email:
            return jsonify({"success": False, "error": "Email is required so the member can receive notifications."}), 400
        if _email_in_use(email):
            return jsonify({"success": False, "error": "This email is already registered. Each member needs a unique email for notifications."}), 400

        role = data.get('role', 'Student')
        conv_name = (data.get('convocation') or '').strip()

        if not conv_name:
            return jsonify({"success": False, "error": "Convocation is required. Every member must belong to a convocation."}), 400

        # Role-based validations
        if role == 'Main Leader':
            if User.query.filter_by(role='Main Leader').first():
                return jsonify({"success": False, "error": "There can only be one Main Leader in the system."}), 400
        
        if role == 'Payment Admin':
            if User.query.filter_by(role='Payment Admin').first():
                return jsonify({"success": False, "error": "There can only be one Main Payment Admin in the system."}), 400

        if role in ['Leader', 'Payment Sub Admin'] and conv_name:
            # Check if this convocation already has a leader
            existing_leader = User.query.filter(
                (User.convocation == conv_name) & 
                ((User.role == 'Leader') | (User.role == 'Payment Sub Admin'))
            ).first()
            if existing_leader:
                return jsonify({"success": False, "error": f"Convocation '{conv_name}' already has a Leader/Collector assigned."}), 400

        # Convocation validation — must exist and not be graduated (students/leaders only)
        if conv_name:
            conv = Convocation.query.filter(db.func.lower(Convocation.name) == db.func.lower(conv_name)).first()
            if not conv:
                return jsonify({"success": False, "error": f"Convocation '{conv_name}' does not exist. Please create it first before adding members to it."}), 400
            if conv.isGraduated:
                return jsonify({"success": False, "error": f"Convocation '{conv_name}' is already graduated. No new members can be added."}), 400

        raw_password = data.get('password', '123').lower().strip()
        body_card = data.get('bodyCard', 'No')
        card_number = (data.get('cardNumber') or '').strip() or None
        if body_card != 'Yes':
            card_number = None
        elif not card_number:
            return jsonify({"success": False, "error": "Card number is required when Body Card is Yes."}), 400
        if card_number and _card_number_in_use(card_number):
            return jsonify({"success": False, "error": CARD_NUMBER_IN_USE_MSG}), 400

        is_graduated = bool(data.get('isGraduated', False))
        status_err = _member_convocation_status_error(conv_name, is_graduated)
        if status_err:
            return jsonify({"success": False, "error": status_err}), 400
        
        new_user = User(
            id=user_id,
            name=data.get('name', '').strip(),
            username=username,
            password=raw_password,
            role=role,
            convocation=conv_name,
            university=data.get('university', 'N/A').strip(),
            faculty=(data.get('faculty') or '').strip() or None,
            semester=(data.get('semester') or '').strip() or None,
            email=email or None,
            phone=data.get('phone', '').strip(),
            bodyCard=body_card,
            card_number=card_number,
            isGraduated=is_graduated,
            profilePic=data.get('profilePic', f"https://ui-avatars.com/api/?name={data.get('name', 'User')}&background=2563eb&color=fff"),
            created_at=datetime.utcnow(),
        )
        db.session.add(new_user)
        db.session.commit()

        if new_user.email and '@' in new_user.email:
            try:
                from flask import current_app
                from utils.email_helpers import send_member_registration_email
                send_member_registration_email(
                    current_app._get_current_object(),
                    new_user,
                    raw_password,
                )
            except Exception as e:
                print(f'Member registration email skipped: {e}')

        try:
            from flask import current_app
            from utils.email_helpers import notify_main_leader
            notify_main_leader(
                current_app._get_current_object(),
                f'New member registered: {new_user.name}',
                f'ID: {new_user.id}\nRole: {new_user.role}\nConvocation: {new_user.convocation or "—"}',
                'member',
            )
        except Exception as e:
            print(f'Member admin notification skipped: {e}')

        return jsonify({"success": True, "user": new_user.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        import traceback
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e) or "An unexpected server error occurred."}), 500

@bp.route('/<path:id>', methods=['GET', 'PUT', 'DELETE'])
def update_user(id):
    user = db.session.get(User, id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    if request.method == 'GET':
        return jsonify(user.to_dict())

    if request.method == 'PUT':
        data = dict(request.json or {})
        self_update = data.pop('self_update', False)

        before_login = _login_ident(user)

        tracked_fields = {
            'name': 'Name',
            'role': 'Role',
            'convocation': 'Convocation (Dufcad)',
            'university': 'University',
            'faculty': 'Faculty',
            'semester': 'Semester',
            'email': 'Email',
            'phone': 'Phone',
            'bodyCard': 'Body card',
            'card_number': 'Card number',
            'isGraduated': 'Graduation status',
            'has_works': 'Works (employed)',
            'work_place': 'Place of work',
            'work_role': 'Job role',
            'work_started': 'Date started working',
        }
        before = {field: getattr(user, field) for field in tracked_fields}
        plain_new_password = (data.get('password') or '').strip() or None

        if self_update:
            data.pop('email', None)
            data.pop('role', None)
            data.pop('convocation', None)
            data.pop('isGraduated', None)
            data.pop('bodyCard', None)
            data.pop('meetingsMissed', None)

        from models import Convocation
        conv_name = data.get('convocation')
        if 'username' in data:
            try:
                _apply_login_ident_change(user, data.get('username'))
            except ValueError as e:
                return jsonify({"success": False, "error": str(e)}), 400

        if 'email' in data:
            new_email = _normalize_email(data['email'])
            if new_email and _email_in_use(new_email, exclude_id=user.id):
                return jsonify({"success": False, "error": "This email is already used by another member."}), 400
            user.email = new_email or None

        if 'name' in data: user.name = data['name']
        if 'password' in data:
            user.password = data['password']
        if 'role' in data:
            user.role = data['role']
        if 'convocation' in data:
            conv_name = (data['convocation'] or '').strip()
            if not conv_name:
                return jsonify({"success": False, "error": "Convocation is required. Every member must belong to a convocation."}), 400
            user.convocation = conv_name
        if 'university' in data: user.university = data['university']
        if 'faculty' in data: user.faculty = (data.get('faculty') or '').strip() or None
        if 'semester' in data: user.semester = (data.get('semester') or '').strip() or None
        if 'email' in data: user.email = data['email']
        if 'phone' in data: user.phone = data['phone']
        if 'bodyCard' in data:
            user.bodyCard = data['bodyCard']
            if user.bodyCard != 'Yes':
                user.card_number = None
        if 'cardNumber' in data:
            card_number = (data.get('cardNumber') or '').strip() or None
            if user.bodyCard == 'Yes' and not card_number:
                return jsonify({"success": False, "error": "Card number is required when Body Card is Yes."}), 400
            if card_number and _card_number_in_use(card_number, exclude_user_id=user.id):
                return jsonify({"success": False, "error": CARD_NUMBER_IN_USE_MSG}), 400
            user.card_number = card_number if user.bodyCard == 'Yes' else None
        elif user.bodyCard == 'Yes' and 'bodyCard' in data and not user.card_number:
            return jsonify({"success": False, "error": "Card number is required when Body Card is Yes."}), 400
        if 'isGraduated' in data:
            graduated = bool(data.get('isGraduated'))
            user.isGraduated = graduated
            if graduated:
                user.semester = None
            else:
                user.has_works = False
                user.work_place = None
                user.work_role = None
                user.work_started = None
        if 'hasWorks' in data:
            user.has_works = bool(data.get('hasWorks'))
            if not user.has_works:
                user.work_place = None
                user.work_role = None
                user.work_started = None
        if 'workPlace' in data:
            user.work_place = (data.get('workPlace') or '').strip() or None
        if 'workRole' in data:
            user.work_role = (data.get('workRole') or '').strip() or None
        if 'workStarted' in data:
            user.work_started = (data.get('workStarted') or '').strip() or None
        if 'meetingsMissed' in data: user.meetingsMissed = data['meetingsMissed']

        if not self_update:
            final_email = _normalize_email(user.email or '')
            if not final_email or '@' not in final_email:
                return jsonify({
                    "success": False,
                    "error": "Email is required so the member can receive update notifications.",
                }), 400

            status_err = _member_convocation_status_error(
                user.convocation, bool(user.isGraduated)
            )
            if status_err:
                return jsonify({"success": False, "error": status_err}), 400

        try:
            db.session.commit()

            from utils.email_helpers import (
                _format_profile_value,
                send_member_profile_updated_email,
            )

            newly_graduated = (
                not self_update
                and not before.get('isGraduated')
                and bool(user.isGraduated)
            )
            graduation_email_sent = False
            if newly_graduated:
                try:
                    from flask import current_app
                    from utils.email_helpers import send_member_graduated_email
                    graduation_email_sent = bool(send_member_graduated_email(
                        current_app._get_current_object(),
                        user,
                    ))
                except Exception as e:
                    print(f'Member graduation email skipped: {e}')

            change_lines = []
            after_login = _login_ident(user)
            if before_login != after_login:
                change_lines.append(f'Member ID / Username: {before_login} → {after_login}')
            for field, label in tracked_fields.items():
                if field == 'isGraduated' and newly_graduated:
                    continue
                old_val = before.get(field)
                new_val = getattr(user, field)
                if old_val != new_val:
                    change_lines.append(
                        f'{label}: {_format_profile_value(field, old_val)} → {_format_profile_value(field, new_val)}'
                    )
            if plain_new_password and 'password' in data:
                change_lines.append('Password: updated')

            email_sent = graduation_email_sent
            if change_lines and not self_update:
                old_email = _normalize_email(before.get('email') or '')
                new_email = _normalize_email(user.email or '')
                recipients = []
                if new_email and '@' in new_email:
                    recipients.append(new_email)
                if old_email and '@' in old_email and old_email not in recipients:
                    recipients.append(old_email)
                if recipients:
                    try:
                        from flask import current_app
                        profile_sent = bool(send_member_profile_updated_email(
                            current_app._get_current_object(),
                            user,
                            change_lines,
                            plain_password=plain_new_password if 'password' in data else None,
                            recipients=recipients,
                        ))
                        email_sent = email_sent or profile_sent
                    except Exception as e:
                        print(f'Member profile update email skipped: {e}')

            return jsonify({
                "success": True,
                "user": user.to_dict(),
                "emailSent": email_sent,
                "graduationEmailSent": graduation_email_sent,
            })
        except Exception as e:
            db.session.rollback()
            return jsonify({"success": False, "error": str(e)}), 400

    if request.method == 'DELETE':
        try:
            deleted_snapshot = {
                'email': user.email,
                'name': user.name,
                'member_id': user.id,
                'role': user.role,
                'convocation': user.convocation,
            }
            _delete_member_related_records(user.id)
            db.session.delete(user)
            db.session.commit()

            if deleted_snapshot.get('email') and '@' in str(deleted_snapshot['email']):
                try:
                    from flask import current_app
                    from utils.email_helpers import send_member_deleted_email
                    send_member_deleted_email(
                        current_app._get_current_object(),
                        deleted_snapshot['email'],
                        deleted_snapshot['name'],
                        deleted_snapshot['member_id'],
                        role=deleted_snapshot.get('role'),
                        convocation=deleted_snapshot.get('convocation'),
                    )
                except Exception as e:
                    print(f'Member deletion email skipped: {e}')

            return jsonify({"success": True})
        except IntegrityError:
            db.session.rollback()
            return jsonify({
                "success": False,
                "error": (
                    "Could not delete this member because related records still exist. "
                    "Please contact support if this continues."
                ),
            }), 409
        except Exception as e:
            db.session.rollback()
            return jsonify({"success": False, "error": str(e)}), 400

@bp.route('/broadcast', methods=['POST'])
def send_broadcast_emails():
    from flask import current_app
    from utils.email_helpers import (
        greet,
        get_missed_meetings_count,
        get_unpaid_months_for_user,
        email_closing,
        send_mail_now,
    )

    data = request.json or {}
    sender_id = data.get('sender_id')
    broadcast_type = data.get('broadcast_type', 'manual')
    subject = data.get('subject')
    message = data.get('message')
    target_convocation = data.get('target_convocation')
    target_role = data.get('target_role')

    if not sender_id:
        return jsonify({"success": False, "error": "Sender ID is required."}), 400

    if broadcast_type == 'manual' and (not subject or not message):
        return jsonify({"success": False, "error": "Subject and Message are required for manual broadcast."}), 400

    if broadcast_type == 'missed_meetings':
        subject = subject or 'Meeting Attendance Notice - HSF System'
        message = message or ''

    sender = db.session.get(User, sender_id)
    if not sender:
        return jsonify({"success": False, "error": "Sender not found."}), 404

    is_admin = sender.role in ['Main Leader', 'Payment Admin']
    is_sub_admin = sender.role in ['Payment Sub Admin', 'Leader']

    if not is_admin and not is_sub_admin:
        return jsonify({"success": False, "error": "Unauthorized. Only leaders and admins can broadcast messages."}), 403

    if is_sub_admin and broadcast_type == 'missed_meetings':
        return jsonify({"success": False, "error": "Collectors can only send payment reminders."}), 403

    if is_sub_admin and broadcast_type not in ('automatic', 'manual'):
        return jsonify({"success": False, "error": "Collectors can only send manual or automatic payment reminders."}), 403

    if sender.role == 'Payment Admin' and broadcast_type == 'missed_meetings':
        return jsonify({"success": False, "error": "Payment admin can only send payment-related broadcasts."}), 403

    if is_sub_admin:
        target_convocation = sender.convocation

    query = User.hsf_members_query()

    if target_convocation and target_convocation != 'All':
        query = query.filter(User.convocation == target_convocation)

    if target_role and target_role != 'All':
        query = query.filter(User.role == target_role)

    recipients_list = query.all()

    if broadcast_type == 'missed_meetings':
        from models import Meeting, Attendance

        meetings = Meeting.query.all()
        attendance_records = Attendance.query.all()
        users_data = []
        for u in recipients_list:
            email = (u.email or '').strip()
            if not email or '@' not in email:
                continue
            missed = get_missed_meetings_count(u, meetings, attendance_records)
            if missed > 0:
                users_data.append((u.id, email, missed))

        if not users_data:
            return jsonify({
                "success": False,
                "error": "No members with missed meetings found. Everyone is up to date — no notices sent.",
            }), 400
    elif broadcast_type == 'automatic':
        users_data = []
        for u in recipients_list:
            email = (u.email or '').strip()
            if not email or '@' not in email:
                continue
            if get_unpaid_months_for_user(u):
                users_data.append((u.id, email))

        if not users_data:
            return jsonify({
                "success": False,
                "error": "No members with outstanding payments found. Everyone is paid up — no reminders sent.",
            }), 400
    else:
        users_data = [
            (u.id, u.email.strip())
            for u in recipients_list
            if u.email and u.email.strip() and '@' in u.email.strip()
        ]

        if not users_data:
            return jsonify({"success": False, "error": "No members with registered email addresses found for the selected targets."}), 400

    # Send in this request (not a daemon thread) so emails actually go out on Passenger.
    app = current_app._get_current_object()
    sent = 0
    failed = 0
    closing = email_closing(app)

    for item in users_data:
        try:
            if len(item) >= 3:
                user_id, email, missed_count = item[0], item[1], int(item[2])
            else:
                user_id, email, missed_count = item[0], item[1], None

            user = db.session.get(User, user_id)
            if not user or not email:
                failed += 1
                continue

            if broadcast_type == 'missed_meetings':
                missed = missed_count if missed_count is not None else get_missed_meetings_count(user)
                if missed <= 0:
                    continue
                user_subject = 'Meeting Attendance Notice - HSF System'
                user_body = (
                    f"{greet(user.name)}\n\n"
                    f"NB: You missed {missed} meeting(s) according to our records.\n\n"
                    f"Please attend upcoming meetings and contact your Convocation Leader if you have questions.\n\n"
                    f"{closing}"
                )
            elif broadcast_type == 'automatic':
                unpaid_months = get_unpaid_months_for_user(user)
                if not unpaid_months:
                    continue
                unpaid_list = "\n".join(f"- {m}" for m in unpaid_months)
                user_subject = 'Outstanding (kugu taagan) Payment Reminder - HSF System'
                user_body = (
                    f"{greet(user.name)}\n\n"
                    f"You have outstanding (kugu taagan) subscription payments for the following month(s):\n"
                    f"{unpaid_list}\n\n"
                    f"Please contact your Convocation Leader / Collector to clear your dues.\n\n"
                    f"{closing}"
                )
            else:
                user_subject = subject
                user_body = f"{greet(user.name)}\n\n{message}" if message else (message or '')

            ok = send_mail_now(
                app,
                user_subject,
                [email],
                user_body,
                user_id=user_id,
                category='broadcast',
            )
            if ok:
                sent += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
            print(f"Error sending broadcast to user {item[0] if item else '?'}: {e}")

    if sent == 0:
        return jsonify({
            "success": False,
            "error": (
                f"Failed to send emails to {failed} member(s). "
                "Check mail settings (MAIL_SERVER / MAIL_USERNAME / MAIL_PASSWORD) and try again."
            ),
            "sent": 0,
            "failed": failed,
            "recipient_count": len(users_data),
        }), 500

    if broadcast_type == 'missed_meetings':
        msg = f"Missed meeting notices sent to {sent} member(s)"
    elif broadcast_type == 'automatic':
        msg = f"Payment reminders sent to {sent} member(s)"
    else:
        msg = f"Broadcast email sent to {sent} member(s)"
    if failed:
        msg += f" ({failed} failed)"

    return jsonify({
        "success": True,
        "message": msg,
        "sent": sent,
        "failed": failed,
        "recipient_count": len(users_data),
    })

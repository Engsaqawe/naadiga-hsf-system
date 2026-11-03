from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import inspect, text
from datetime import datetime
import json
from models import db, Meeting, User

bp = Blueprint('meetings', __name__)


def init_meeting_schema():
    """Add target_audience column on existing databases."""
    try:
        insp = inspect(db.engine)
        if not insp.has_table('meeting'):
            return
        cols = {c['name'] for c in insp.get_columns('meeting')}
        if 'target_audience' not in cols:
            db.session.execute(text(
                "ALTER TABLE meeting ADD COLUMN target_audience VARCHAR(20) DEFAULT 'active'"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('meeting')}
        if 'attendance_taken' not in cols:
            db.session.execute(text(
                "ALTER TABLE meeting ADD COLUMN attendance_taken TINYINT(1) DEFAULT 0"
            ))
            db.session.commit()
        cols = {c['name'] for c in insp.get_columns('meeting')}
        if 'eligible_member_ids' not in cols:
            db.session.execute(text(
                "ALTER TABLE meeting ADD COLUMN eligible_member_ids TEXT"
            ))
            db.session.commit()
        _repair_meeting_participant_counts()
    except Exception as e:
        db.session.rollback()
        print(f'Meeting schema migration skipped: {e}')


def _repair_meeting_participant_counts():
    """Clear bogus participantsCount on meetings where attendance was never saved."""
    from models import Attendance
    try:
        for meeting in Meeting.query.all():
            if not meeting.participantsCount or meeting.participantsCount <= 0:
                continue
            if meeting.attendance_taken:
                continue
            if Attendance.query.filter_by(meeting_id=meeting.id).first():
                continue
            meeting.participantsCount = 0
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f'Meeting participant count repair skipped: {e}')


def _filter_meeting_recipients(query, target_audience):
    target = (target_audience or 'active').lower()
    if target == 'graduated':
        return query.filter(User.isGraduated.is_(True))
    if target == 'active':
        return query.filter(User.isGraduated.is_(False))
    return query


def _parse_meeting_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(str(date_str)[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


def _eligible_roster_member_ids(conv, target_audience, meeting_date_str):
    """Members who matched target audience when the meeting was created."""
    from utils.convocation_helpers import convocations_match

    q = _filter_meeting_recipients(User.hsf_members_query(), target_audience)
    meeting_date = _parse_meeting_date(meeting_date_str)
    ids = []
    for user in q.all():
        if not user.convocation:
            continue
        if not convocations_match(conv, user.convocation):
            continue
        if meeting_date and user.created_at and user.created_at.date() > meeting_date:
            continue
        ids.append(user.id)
    return ids


@bp.route('', methods=['GET', 'POST'])
def handle_meetings():
    if request.method == 'GET':
        convocation = request.args.get('convocation')
        query = Meeting.query.order_by(Meeting.date.desc())
        if convocation and convocation != 'All':
            query = Meeting.query.filter(
                (db.func.lower(Meeting.convocation) == db.func.lower(convocation))
                | (db.func.lower(Meeting.convocation) == 'all')
            ).order_by(Meeting.date.desc())
        meetings = query.all()
        return jsonify([m.to_dict() for m in meetings])

    data = request.json or {}
    target_audience = (data.get('target_audience') or 'active').lower()
    if target_audience not in ('active', 'graduated'):
        target_audience = 'active'

    conv = data.get('convocation', 'All')
    roster_ids = _eligible_roster_member_ids(conv, target_audience, data.get('date'))
    if not roster_ids:
        label = 'graduated' if target_audience == 'graduated' else 'active'
        scope = conv if conv and str(conv).lower() != 'all' else 'any convocation'
        return jsonify({
            'error': f'No {label} members in {scope}. Cannot create meeting — no target audience.',
        }), 400

    new_meeting = Meeting(
        topic=data['topic'],
        date=data['date'],
        place=data['place'],
        presenter=data['presenter'],
        participantsCount=data.get('participantsCount', 0),
        convocation=data.get('convocation', 'All'),
        target_audience=target_audience,
        eligible_member_ids=json.dumps(roster_ids),
    )
    db.session.add(new_meeting)
    db.session.commit()

    try:
        from utils.email_helpers import send_meeting_notification
        app = current_app._get_current_object()
        from utils.convocation_helpers import convocations_match

        conv = data.get('convocation', 'All')
        q = _filter_meeting_recipients(
            User.hsf_members_query().filter(User.email.isnot(None)),
            target_audience,
        )
        members = [
            u for u in q.all()
            if u.email and '@' in u.email.strip()
            and convocations_match(conv, u.convocation)
        ]
        send_meeting_notification(app, new_meeting, members)
        from utils.email_helpers import notify_main_leader
        audience = 'Graduated' if target_audience == 'graduated' else 'Active'
        notify_main_leader(
            app,
            f'Meeting scheduled: {new_meeting.topic}',
            (
                f'Date: {new_meeting.date}\n'
                f'Place: {new_meeting.place or "TBA"}\n'
                f'Audience: {audience} members\n'
                f'Convocation: {new_meeting.convocation or "All"}\n'
                f'Emails sent to {len(members)} member(s).'
            ),
            'meeting',
        )
    except Exception as e:
        print(f'Meeting notification emails skipped: {e}')

    return jsonify(new_meeting.to_dict()), 201


@bp.route('/<int:id>', methods=['PUT', 'DELETE'])
def update_meeting(id):
    meeting = db.session.get(Meeting, id)
    if not meeting:
        return jsonify({"error": "Meeting not found"}), 404

    if request.method == 'PUT':
        data = request.json or {}
        if 'topic' in data:
            meeting.topic = data['topic']
        if 'date' in data:
            meeting.date = data['date']
        if 'place' in data:
            meeting.place = data['place']
        if 'presenter' in data:
            meeting.presenter = data['presenter']
        if 'participantsCount' in data:
            meeting.participantsCount = data['participantsCount']
        if 'attendanceTaken' in data:
            meeting.attendance_taken = bool(data['attendanceTaken'])
        if 'convocation' in data:
            meeting.convocation = data['convocation']
        if 'target_audience' in data:
            ta = (data['target_audience'] or 'active').lower()
            meeting.target_audience = ta if ta in ('active', 'graduated') else 'active'
        db.session.commit()
        return jsonify({"success": True, "meeting": meeting.to_dict()})

    from models import Attendance
    absents = Attendance.query.filter_by(meeting_id=id, status='Absent').all()
    for a in absents:
        student = db.session.get(User, a.student_id)
        if student and (student.meetingsMissed or 0) > 0:
            student.meetingsMissed -= 1

    Attendance.query.filter_by(meeting_id=id).delete()

    db.session.delete(meeting)
    db.session.commit()
    return jsonify({"success": True})

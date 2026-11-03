from datetime import datetime
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import inspect, text
from models import db, Attendance, User, Meeting

bp = Blueprint('attendance', __name__)


def init_attendance_schema():
    """Add is_excused column to attendance when upgrading existing DBs."""
    try:
        insp = inspect(db.engine)
        if 'attendance' not in insp.get_table_names():
            return
        cols = {c['name'] for c in insp.get_columns('attendance')}
        if 'is_excused' not in cols:
            with db.engine.connect() as conn:
                conn.execute(text(
                    'ALTER TABLE attendance ADD COLUMN is_excused BOOLEAN NOT NULL DEFAULT 0'
                ))
                conn.commit()
    except Exception as e:
        print(f'init_attendance_schema (is_excused): {e}')


def _can_penalize_absent(student, meeting_date_str):
    if not student or not student.created_at or not meeting_date_str:
        return True
    try:
        m_date = datetime.strptime(str(meeting_date_str)[:10], '%Y-%m-%d').date()
        return student.created_at.date() < m_date
    except ValueError:
        return True


def _notify_absent(student, meeting):
    if not student or not meeting:
        return
    try:
        from utils.email_helpers import send_absent_meeting_email
        send_absent_meeting_email(current_app._get_current_object(), student, meeting)
    except Exception:
        pass


@bp.route('', methods=['GET', 'POST'])
def handle_attendance():
    if request.method == 'GET':
        meeting_id = request.args.get('meeting_id')
        student_id = request.args.get('student_id')
        query = Attendance.query
        if meeting_id:
            query = query.filter_by(meeting_id=int(meeting_id))
        if student_id:
            query = query.filter_by(student_id=student_id)
        records = query.all()
        return jsonify([r.to_dict() for r in records])

    data = request.json
    try:
        if isinstance(data, list):
            updates = data
        else:
            updates = [data]

        meetings_cache = {}

        for item in updates:
            existing = Attendance.query.filter_by(
                meeting_id=item['meeting_id'],
                student_id=item['student_id']
            ).first()

            if existing and existing.is_excused:
                continue

            student = db.session.get(User, item['student_id'])
            meeting = meetings_cache.get(item['meeting_id'])
            if meeting is None:
                meeting = db.session.get(Meeting, item['meeting_id'])
                meetings_cache[item['meeting_id']] = meeting

            meeting_date = item.get('date') or (meeting.date if meeting else '')
            can_mark_absent = _can_penalize_absent(student, meeting_date)
            new_status = item.get('status', 'Present')

            if existing:
                old_status = existing.status
                if old_status != new_status:
                    if old_status == 'Present' and new_status == 'Absent':
                        if student and can_mark_absent:
                            student.meetingsMissed = (student.meetingsMissed or 0) + 1
                        _notify_absent(student, meeting)
                    elif old_status == 'Absent' and new_status == 'Present':
                        if student and (student.meetingsMissed or 0) > 0:
                            student.meetingsMissed -= 1
                    existing.status = new_status
                existing.date = item.get('date', existing.date)
            else:
                new_att = Attendance(
                    meeting_id=item['meeting_id'],
                    student_id=item['student_id'],
                    status=new_status,
                    date=item.get('date', ''),
                    is_excused=False,
                )
                db.session.add(new_att)
                if new_status == 'Absent' and can_mark_absent:
                    if student:
                        student.meetingsMissed = (student.meetingsMissed or 0) + 1
                    _notify_absent(student, meeting)

        db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

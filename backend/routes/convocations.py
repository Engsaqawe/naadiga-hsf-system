from flask import Blueprint, jsonify, request
from models import db, Convocation, User

bp = Blueprint('convocations', __name__)

@bp.route('', methods=['GET', 'POST'])
def handle_convocations():
    if request.method == 'GET':
        convs = Convocation.query.all()
        return jsonify([c.to_dict() for c in convs])

    data = request.json
    name = data.get('name', '').strip()
    if name.lower() == 'all':
        return jsonify({"success": False, "error": "'All' is a reserved keyword and cannot be used as a convocation name."}), 400
        
    new_conv = Convocation(name=name, year=data.get('year', 2024))
    db.session.add(new_conv)
    db.session.commit()
    return jsonify(new_conv.to_dict()), 201


@bp.route('/graduate', methods=['POST'])
def graduate_convocation():
    """Mark all students in a convocation as graduated."""
    data = request.json or {}
    name = data.get('convocation')
    if not name:
        return jsonify({"success": False, "error": "convocation is required"}), 400

    # Find all students that belong to this convocation (case-insensitive)
    students = User.query.filter(
        db.func.lower(User.convocation) == db.func.lower(name)
    ).all()

    if not students:
        return jsonify({"success": False, "error": "No students found for this convocation"}), 404

    try:
        conv_record = Convocation.query.filter(db.func.lower(Convocation.name) == db.func.lower(name)).first()
        if conv_record:
            conv_record.isGraduated = True

        newly_graduated = [s for s in students if not s.isGraduated]
        for s in students:
            s.isGraduated = True
        db.session.commit()

        emails_sent = 0
        if newly_graduated:
            try:
                from flask import current_app
                from utils.email_helpers import send_member_graduated_email
                app = current_app._get_current_object()
                for s in newly_graduated:
                    if send_member_graduated_email(app, s):
                        emails_sent += 1
            except Exception as e:
                print(f'Convocation graduation emails skipped: {e}')

        return jsonify({
            "success": True,
            "convocation": name,
            "updatedCount": len(students),
            "graduationEmailsSent": emails_sent,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500

@bp.route('/<int:id>', methods=['DELETE'])
def delete_convocation(id):
    conv = db.session.get(Convocation, id)
    if not conv:
        return jsonify({"error": "Convocation not found"}), 404
    db.session.delete(conv)
    db.session.commit()
    return jsonify({"success": True})

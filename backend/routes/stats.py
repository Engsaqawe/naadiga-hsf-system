from flask import Blueprint, jsonify, request
from models import db, User, Convocation, Transaction, Expense, Meeting

bp = Blueprint('stats', __name__)

def parse_amount(val):
    if not val: return 0.0
    try:
        if isinstance(val, (int, float)): return float(val)
        return float(str(val).replace('$', '').replace(',', '').strip())
    except:
        return 0.0

@bp.route('/stats', methods=['GET'])
def get_stats():
    """Returns aggregated dashboard statistics."""
    month = request.args.get('month')   # e.g., "March"
    year = request.args.get('year')     # e.g., "2026"
    convocation = request.args.get('convocation')  # optional filter

    try:
        # User counts
        all_users = User.query.all()
        # Scholarship members in dufcad (Main Leader is also a paying student)
        MEMBER_ROLES = ('Student', 'Main Leader', 'Leader', 'Payment Sub Admin', 'Payment Admin', 'Media Admin')
        all_students = [u for u in all_users if u.role in MEMBER_ROLES]

        grad_students = [s for s in all_students if s.isGraduated]
        on_progress = [s for s in all_students if not s.isGraduated]

        # Convocations
        convocations = Convocation.query.all()
        grad_convs = [c for c in convocations if c.isGraduated]
        active_convs = [c for c in convocations if not c.isGraduated]

        # Transactions for this month
        txn_query = Transaction.query
        if month:
            txn_query = txn_query.filter_by(month=month)
        if year:
            txn_query = txn_query.filter_by(year=int(year))
        if convocation and convocation != 'All':
            txn_query = txn_query.filter(db.func.lower(Transaction.convocation) == db.func.lower(convocation))
        transactions = txn_query.all()
        total_collected = sum(parse_amount(t.amount) for t in transactions)

        # Expenses
        exp_query = Expense.query
        if month:
            exp_query = exp_query.filter_by(month=month)
        if year:
            exp_query = exp_query.filter_by(year=int(year))
        expenses = exp_query.all()
        total_spent = sum(e.amount for e in expenses)

        total_meetings = Meeting.query.count()

        return jsonify({
            "totalStudents": len(all_students),
            "graduatedStudents": len(grad_students),
            "onProgressStudents": len(on_progress),
            "totalConvocations": len(convocations),
            "graduatedConvocations": len(grad_convs),
            "activeConvocations": len(active_convs),
            "totalMeetings": total_meetings,
            "totalCollected": total_collected,
            "totalSpent": total_spent,
            "convocationBreakdown": [
                {
                    "name": c.name,
                    "totalStudents": len([s for s in all_students if s.convocation and s.convocation.lower() == c.name.lower()]),
                    "graduatedStudents": len([s for s in all_students if s.convocation and s.convocation.lower() == c.name.lower() and s.isGraduated]),
                }
                for c in convocations
            ]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@bp.route('/performance', methods=['GET'])
def get_performance():
    """Per-convocation payment + attendance stats."""
    month = request.args.get('month', '')
    year = request.args.get('year', '')

    try:
        convocations = Convocation.query.all()
        # Filter out Public Users
        all_students = User.hsf_members_query().all()
        meetings = Meeting.query.all()

        result = []
        for c in convocations:
            conv_students = [s for s in all_students if s.convocation and s.convocation.lower() == c.name.lower()]
            total = len(conv_students)

            # Paid = students with a transaction this month
            paid_ids = set()
            if month and year:
                paid_txns = Transaction.query.filter(db.func.lower(Transaction.convocation) == c.name.lower(), Transaction.month == month, Transaction.year == int(year)).all()
               
                paid_ids = {t.student_id for t in paid_txns}
            paid = len(paid_ids)
            unpaid = total - paid
            rate = round((paid / total * 100)) if total > 0 else 0
           

            # Attendance: average participants
            month_num = _month_to_num(month)
            relevant_meetings = [
                m for m in meetings
                if (m.convocation and m.convocation.lower() == c.name.lower() or m.convocation == 'All') and
                   (not month or m.date.startswith(f"{year}-{month_num}"))
            ]
            avg_attendance = (
                round(sum(m.participantsCount for m in relevant_meetings) / len(relevant_meetings))
                if relevant_meetings else 0
            )
            att_rate = min(100, round(avg_attendance / total * 100)) if total > 0 else 0

            result.append({
                "name": c.name,
                "total": total,
                "paid": paid,
                "unpaid": unpaid,
                "paymentRate": rate,
                "attendanceRate": att_rate
            })

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _month_to_num(month_name):
    months = {
        'January': '01', 'February': '02', 'March': '03',
        'April': '04', 'May': '05', 'June': '06',
        'July': '07', 'August': '08', 'September': '09',
        'October': '10', 'November': '11', 'December': '12'
    }
    return months.get(month_name, '01')

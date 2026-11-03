from datetime import datetime
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import inspect, text
from models import db, Transaction, Expense, FundEntry, User
from utils.email_helpers import send_payment_confirmation

bp = Blueprint('payments', __name__)


def init_expense_schema():
    """Add expense_date column on existing databases."""
    try:
        insp = inspect(db.engine)
        if not insp.has_table('expense'):
            return
        cols = {c['name'] for c in insp.get_columns('expense')}
        if 'expense_date' not in cols:
            db.session.execute(text(
                "ALTER TABLE expense ADD COLUMN expense_date VARCHAR(20)"
            ))
            db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f'Expense schema migration skipped: {e}')


def _normalize_amount(val):
    """Store payment amounts as $X.XX strings."""
    if val is None or val == '':
        return '$1.00'
    try:
        if isinstance(val, (int, float)):
            n = float(val)
        else:
            n = float(str(val).replace('$', '').replace(',', '').strip())
        if n <= 0:
            return '$1.00'
        return f'${n:.2f}'
    except (TypeError, ValueError):
        return '$1.00'


@bp.route('/transactions', methods=['GET', 'POST'])
def handle_transactions():
    if request.method == 'GET':
        convocation = request.args.get('convocation')
        month = request.args.get('month')
        year = request.args.get('year')
        student_id = request.args.get('student_id')
        query = Transaction.query
        if student_id:
            query = query.filter_by(student_id=student_id)
        if convocation and convocation != 'All':
            query = query.filter(db.func.lower(Transaction.convocation) == db.func.lower(convocation))
        if month and month != 'undefined':
            query = query.filter_by(month=month)
        if year and year != 'undefined':
            query = query.filter_by(year=int(year))
        transactions = query.order_by(Transaction.id.desc()).all()
        return jsonify([t.to_dict() for t in transactions])

    data = request.json
    try:
        student = db.session.get(User, data['student_id'])
        if not student:
            return jsonify({"error": "Member not found"}), 404

        amount_str = _normalize_amount(data.get('amount', '$1.00'))
        new_transaction = Transaction(
            date=data.get('date', ''),
            student_id=data['student_id'],
            name=student.name,
            month=data['month'],
            year=data.get('year', 2026),
            amount=amount_str,
            method=data.get('method', 'EVC Plus'),
            status=data.get('status', 'Success'),
            convocation=data.get('convocation', student.convocation or 'Admin'),
            collector=data.get('collector', 'Admin')
        )
        db.session.add(new_transaction)
        db.session.commit()

        try:
            app = current_app._get_current_object()
            send_payment_confirmation(
                app,
                student,
                data['month'],
                data.get('year') or datetime.utcnow().year,
                amount_str,
            )
        except Exception as e:
            print(f'Payment confirmation email skipped: {e}')

        return jsonify(new_transaction.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@bp.route('/transactions/<int:id>', methods=['DELETE'])
def delete_transaction(id):
    txn = db.session.get(Transaction, id)
    if not txn:
        return jsonify({"error": "Transaction not found"}), 404
    db.session.delete(txn)
    db.session.commit()
    return jsonify({"success": True})

@bp.route('/expenses', methods=['GET', 'POST'])
def handle_expenses():
    if request.method == 'GET':
        expenses = Expense.query.all()
        return jsonify([e.to_dict() for e in expenses])

    data = request.json
    new_expense = Expense(
        month=data['month'],
        year=data['year'],
        expense_date=(data.get('date') or '').strip() or None,
        amount=float(data['amount']),
        description=data.get('description', '')
    )
    db.session.add(new_expense)
    db.session.commit()
    return jsonify(new_expense.to_dict()), 201


@bp.route('/fund-entries', methods=['GET', 'POST'])
def handle_fund_entries():
    if request.method == 'GET':
        entries = FundEntry.query.order_by(FundEntry.id.desc()).all()
        return jsonify([e.to_dict() for e in entries])

    data = request.json or {}
    source_type = (data.get('source_type') or 'Supported').strip() or 'Supported'
    new_entry = FundEntry(
        month=data['month'],
        year=int(data['year']),
        entry_date=(data.get('date') or '').strip() or None,
        amount=float(data['amount']),
        source_type=source_type,
        description=(data.get('description') or '').strip(),
        recorded_by=(data.get('recorded_by') or '').strip() or None,
    )
    db.session.add(new_entry)
    db.session.commit()
    return jsonify(new_entry.to_dict()), 201

import random
import string
from sqlalchemy import func
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from flask_mail import Message
from extensions import db, mail, bcrypt
from models import User

bp = Blueprint('auth', __name__)

def generate_otp():
    return ''.join(random.choices(string.digits, k=6))

def send_otp_email(email, otp):
    from flask import current_app
    from utils.email_helpers import club_mail_sender, club_official_name
    app_obj = current_app._get_current_object()
    org = club_official_name(app_obj)
    sender = club_mail_sender(app_obj)
    msg = Message(
        subject=f'{org} — Password Reset Code',
        sender=sender,
        recipients=[email],
        body=(
            f'Your password reset code is: {otp}\n\n'
            f'This code expires in 5 minutes.\n\n'
            f'If you did not request this, ignore this email.\n\n'
            f'— {org}'
        ),
    )
    mail.send(msg)

@bp.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username', '').lower().strip()
    email = data.get('email', '').lower().strip()
    password = data.get('password', '').strip()
    full_name = data.get('full_name', '').strip()
    
    if User.query.filter_by(username=username).first():
        return jsonify({"success": False, "message": "Username already exists"}), 400
    # Public site emails are separate from HSF member notification emails.
    public_email_taken = User.query.filter(
        func.lower(User.email) == email,
        User.role == 'Public User',
    ).first()
    if public_email_taken:
        return jsonify({"success": False, "message": "Email already registered"}), 400
        
    new_user = User(
        id=f"HSF-{random.randint(100, 999)}", 
        username=username,
        email=email,
        password=password,
        name=full_name,
        role="Public User",
        convocation=None # Public users don't belong to a convocation
    )
    
    db.session.add(new_user)
    db.session.commit()

    try:
        from flask import current_app
        from utils.email_helpers import send_welcome_email, notify_main_leader
        app = current_app._get_current_object()
        send_welcome_email(app, new_user)
        notify_main_leader(
            app,
            f'New public site registration: {new_user.username}',
            f'Name: {full_name}\nEmail: {email}',
            'public_registration',
        )
    except Exception as e:
        print(f'Welcome email skipped: {e}')

    return jsonify({"success": True, "message": "Registration successful!", "user": new_user.to_dict()})

@bp.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '').lower().strip()
    password = data.get('password', '').strip()
    
    print(f"DEBUG: Login attempt for username: '{username}'")
    
    # Login with username + password only (email/ID are for contact & notifications)
    user = User.query.filter(func.lower(User.username) == username).first()

    if user:
        print(f"DEBUG: Found user: {user.username} (ID: {user.id})")
    else:
        print(f"DEBUG: No user found for username '{username}'")
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    if user.is_alnuur_guest():
        return jsonify({
            "success": False,
            "message": "Alnuur competitors are registered for Quran only — not portal members.",
        }), 403

    # Check if account is locked
    if user.is_locked:
        if user.lock_until and datetime.utcnow() < user.lock_until:
            remaining = int((user.lock_until - datetime.utcnow()).total_seconds() / 60)
            return jsonify({"success": False, "message": f"Account locked. Try again in {remaining} minutes."}), 403
        else:
            # Unlock after time passed
            user.is_locked = False
            user.login_attempts = 0
            db.session.commit()

    # Check password
    is_valid = False
    password_in_db = user.password

    if password_in_db == password:
        is_valid = True
    elif password_in_db.startswith('$2b$'):
        try:
            if bcrypt.check_password_hash(password_in_db, password):
                is_valid = True
                # Automatically migrate back to plain-text
                try:
                    user.password = password
                    db.session.commit()
                except Exception as e:
                    print(f"Error migrating password to plain-text: {e}")
                    db.session.rollback()
        except:
            is_valid = False

    if is_valid:
        user.login_attempts = 0
        user.is_locked = False
        db.session.commit()
        return jsonify({"success": True, "user": user.to_dict()})
    else:
        user.login_attempts += 1
        if user.login_attempts >= 5:
            user.is_locked = True
            user.lock_until = datetime.utcnow() + timedelta(minutes=10)
        db.session.commit()
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

@bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.json
    email = data.get('email', '').lower().strip()
    print(f"DEBUG: Forgot password attempt for email: '{email}'")
    user = User.query.filter(func.lower(User.email) == email).first()
    if not user:
        all_emails = [u.email for u in User.query.all()]
        print(f"DEBUG: No user found for '{email}'. All emails in DB: {all_emails}")
        return jsonify({"success": False, "message": "Email not found"}), 404
    
    otp = generate_otp()
    user.otp_code = otp
    user.otp_expiry = datetime.utcnow() + timedelta(minutes=5)
    user.otp_attempts = 0
    db.session.commit()
    
    try:
        send_otp_email(user.email, otp)
        return jsonify({"success": True, "message": "OTP sent to your email"})
    except Exception as e:
        return jsonify({"success": False, "message": f"Failed to send email: {str(e)}"}), 500

@bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    email = data.get('email', '').strip()
    otp = data.get('otp', '').strip()
    
    user = User.query.filter_by(email=email).first()
    if not user or not user.otp_code:
        return jsonify({"success": False, "message": "Invalid request"}), 400
        
    if user.otp_attempts >= 3:
        return jsonify({"success": False, "message": "Max attempts reached. Please resend OTP."}), 403
        
    if datetime.utcnow() > user.otp_expiry:
        return jsonify({"success": False, "message": "OTP expired"}), 410
        
    if user.otp_code == otp:
        # Success - allow reset
        # We don't clear OTP yet, we'll clear it after reset
        return jsonify({"success": True, "message": "OTP verified"})
    else:
        user.otp_attempts += 1
        db.session.commit()
        return jsonify({"success": False, "message": "Invalid OTP code"}), 401

@bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.json
    email = data.get('email', '').strip()
    otp = data.get('otp', '').strip()
    new_password = data.get('password', '').strip()
    
    user = User.query.filter_by(email=email, otp_code=otp).first()
    if not user:
        return jsonify({"success": False, "message": "Unauthorized reset attempt"}), 401
    
    if datetime.utcnow() > user.otp_expiry:
        return jsonify({"success": False, "message": "OTP expired"}), 410

    # Set plain-text password
    user.password = new_password
    # Clear OTP
    user.otp_code = None
    user.otp_expiry = None
    user.login_attempts = 0
    user.is_locked = False
    db.session.commit()
    
    return jsonify({"success": True, "message": "Password reset successful"})

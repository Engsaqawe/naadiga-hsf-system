from flask import Blueprint
from .auth import bp as auth_bp
from .students import bp as users_bp
from .convocations import bp as conv_bp
from .meetings import bp as meet_bp
from .payments import bp as pay_bp
from .attendance import bp as att_bp
from .stats import bp as stats_bp
from .uploads import bp as upload_bp
from .reports import bp as reports_bp
from .notifications import bp as notifications_bp
from .face_photos_api import bp as face_photos_bp

print("DEBUG: API Blueprint loading...")
bp = Blueprint('api', __name__, url_prefix='/api')

# Register sub-blueprints
bp.register_blueprint(auth_bp)
bp.register_blueprint(users_bp, url_prefix='/users')
bp.register_blueprint(conv_bp, url_prefix='/convocations')
bp.register_blueprint(meet_bp, url_prefix='/meetings')
bp.register_blueprint(pay_bp) # Includes /transactions and /expenses
bp.register_blueprint(att_bp, url_prefix='/attendance')
bp.register_blueprint(stats_bp) # Includes /stats and /performance
bp.register_blueprint(upload_bp)
bp.register_blueprint(reports_bp, url_prefix='/reports')
bp.register_blueprint(notifications_bp, url_prefix='/notifications')
bp.register_blueprint(face_photos_bp, url_prefix='/face-photos')

import os
import socket
from flask import Flask, send_from_directory, abort
from flask_cors import CORS
from config import Config
from extensions import db, mail, bcrypt
from routes.api import bp as api_bp
from routes.public_api import bp as public_bp, init_public_db
from routes.articles_api import bp as articles_bp, admin_bp as articles_admin_bp, seed_articles, init_articles_settings
from routes.books_api import bp as books_bp, admin_bp as books_admin_bp, init_books_settings
from routes.applications_api import bp as applications_bp, init_applications_schema
from routes.meetings import init_meeting_schema
from routes.attendance import init_attendance_schema
from routes.payments import init_expense_schema
from routes.students import init_user_schema

app = Flask(__name__)
app.config.from_object(Config)

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Enable CORS (phone on LAN, Live Server on another port, etc.)
CORS(app)

# Initialize Plugins
db.init_app(app)
mail.init_app(app)
bcrypt.init_app(app)

with app.app_context():
    print(f"DEBUG: Using database: {db.engine.url}")

# Register Blueprints
app.register_blueprint(api_bp)
app.register_blueprint(public_bp, url_prefix='/api/public')
app.register_blueprint(applications_bp, url_prefix='/api/public/applications')
app.register_blueprint(applications_bp, url_prefix='/api/applications', name='applications_admin')
app.register_blueprint(articles_bp, url_prefix='/api/articles')
app.register_blueprint(articles_admin_bp, url_prefix='/api/admin/articles')
app.register_blueprint(books_bp, url_prefix='/api/books')
app.register_blueprint(books_admin_bp, url_prefix='/api/admin/books')


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return '127.0.0.1'


def _safe_site_path(rel_path):
    rel = os.path.normpath(rel_path or '').lstrip(os.sep)
    if rel.startswith('..') or rel.startswith('backend'):
        return None
    full = os.path.join(PROJECT_ROOT, rel)
    if not full.startswith(PROJECT_ROOT):
        return None
    return full


@app.route('/', defaults={'filename': 'index.html'})
@app.route('/<path:filename>')
def serve_site(filename):
    """Serve public HTML/CSS/JS so phones can open http://YOUR_IP:5000/…"""
    if filename.startswith('api/') or filename == 'api':
        abort(404)
    target = _safe_site_path(filename)
    if not target:
        abort(404)
    if os.path.isdir(target):
        index = os.path.join(target, 'index.html')
        if os.path.isfile(index):
            return send_from_directory(target, 'index.html')
        abort(404)
    if not os.path.isfile(target):
        abort(404)
    directory, name = os.path.split(target)
    return send_from_directory(directory, name)


def initialize_database():
    """Create/migrate tables. Safe to call on every app start (local or Passenger)."""
    with app.app_context():
        db.create_all()
        init_meeting_schema()
        init_attendance_schema()
        init_expense_schema()
        init_user_schema()
        init_public_db()
        init_applications_schema()
        init_articles_settings()
        init_books_settings()
        seed_articles()


if __name__ == '__main__':
    initialize_database()

    port = int(os.environ.get('PORT', 5000))
    lan = _lan_ip()
    print('')
    print('=' * 56)
    print('  HSF server running')
    print(f'  On this PC:     http://127.0.0.1:{port}/')
    print(f'  On your phone:  http://{lan}:{port}/')
    print(f'  Summer form:    http://{lan}:{port}/summer-course.html')
    print('  (Phone must be on the same Wi-Fi as this computer)')
    print('=' * 56)
    print('')
    debug = os.environ.get('FLASK_DEBUG', '1').lower() in ('1', 'true', 'yes')
    app.run(host='0.0.0.0', debug=debug, port=port)

import os
import re
from urllib.parse import unquote

from flask import Blueprint, request, jsonify, current_app, send_from_directory
from werkzeug.utils import secure_filename
from models import db, User

bp = Blueprint('uploads', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}


def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _decode_user_id(raw_user_id):
    return unquote(str(raw_user_id or '')).strip()


def _profile_upload_filename(user_id, original_filename):
    safe_uid = re.sub(r'[^\w\-.]+', '_', _decode_user_id(user_id))[:50] or 'user'
    ext = original_filename.rsplit('.', 1)[-1].lower() if '.' in original_filename else 'jpg'
    if ext not in ALLOWED_EXTENSIONS:
        ext = 'jpg'
    base = secure_filename(original_filename.rsplit('.', 1)[0]) or 'photo'
    return secure_filename(f'{safe_uid}_{base}.{ext}')


@bp.route('/upload-profile/<path:user_id>', methods=['POST'])
def upload_profile_pic(user_id):
    user_id = _decode_user_id(user_id)
    if not user_id:
        return jsonify({"error": "Invalid user id"}), 400

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if not allowed_file(file.filename):
        return jsonify({
            "error": "File type not allowed. Use JPG, PNG, WebP, or GIF.",
        }), 400

    try:
        filename = _profile_upload_filename(user_id, file.filename)
        upload_dir = current_app.config['UPLOAD_FOLDER']

        if not os.path.exists(upload_dir):
            os.makedirs(upload_dir, exist_ok=True)

        file_path = os.path.join(upload_dir, filename)
        file.save(file_path)

        user = db.session.get(User, user_id)
        if user:
            url = f"/api/uploads/{filename}"
            user.profilePic = url
            db.session.commit()
            return jsonify({"success": True, "url": url})

        if os.path.isfile(file_path):
            os.remove(file_path)
        return jsonify({"error": "User not found in database"}), 404
    except Exception as e:
        print(f"CRITICAL UPLOAD ERROR: {str(e)}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@bp.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(current_app.config['UPLOAD_FOLDER'], filename)


@bp.route('/uploads/articles/<filename>')
def serve_article_upload(filename):
    articles_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], 'articles')
    if not os.path.exists(articles_dir):
        os.makedirs(articles_dir, exist_ok=True)
    return send_from_directory(articles_dir, filename)


@bp.route('/uploads/books/<filename>')
def serve_book_upload(filename):
    books_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], 'books')
    if not os.path.exists(books_dir):
        os.makedirs(books_dir, exist_ok=True)
    return send_from_directory(books_dir, filename)

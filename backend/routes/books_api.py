import os
import re
import uuid
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import or_
from extensions import db
from models import Book, BooksSettings

bp = Blueprint('books', __name__)
admin_bp = Blueprint('books_admin', __name__)

ALLOWED_COVER_EXT = {'jpg', 'jpeg', 'png', 'webp'}
ALLOWED_PDF_EXT = {'pdf'}
CATEGORIES = ('Graduation', 'Research', 'Memoir', 'Guide', 'Other')
AUDIENCES = ('graduated', 'active', 'all')
DEFAULT_AUTHOR = 'NAHS Foundation Alumni'


def _mysql_safe_book_order(query):
    """MySQL does not support NULLS LAST — use CASE for null published_at."""
    from sqlalchemy import case
    return query.order_by(
        case((Book.published_at.is_(None), 1), else_=0),
        Book.published_at.desc(),
        Book.created_at.desc(),
    )


def _resolve_author(author_name, title):
    name = (author_name or '').strip()
    if name:
        return name
    return DEFAULT_AUTHOR


def _books_upload_dir():
    base = current_app.config.get('UPLOAD_FOLDER', 'uploads')
    path = os.path.join(base, 'books')
    os.makedirs(path, exist_ok=True)
    return path


def _media_url(filename, subfolder=''):
    if not filename:
        return None
    if filename.startswith('http') or filename.startswith('/'):
        return filename
    if subfolder:
        return f'/api/uploads/books/{subfolder}/{filename}'
    return f'/api/uploads/books/{filename}'


def _save_cover(file):
    if not file or not file.filename:
        return None
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ALLOWED_COVER_EXT:
        raise ValueError('Cover must be JPG, PNG, or WebP')
    max_mb = 5
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > max_mb * 1024 * 1024:
        raise ValueError(f'Cover too large (max {max_mb}MB)')
    name = f"cover_{uuid.uuid4().hex}.{ext}"
    path = os.path.join(_books_upload_dir(), name)
    file.save(path)
    return _media_url(name)


def _save_pdf(file):
    if not file or not file.filename:
        return None
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ALLOWED_PDF_EXT:
        raise ValueError('Book file must be a PDF')
    max_mb = 25
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > max_mb * 1024 * 1024:
        raise ValueError(f'PDF too large (max {max_mb}MB)')
    name = f"book_{uuid.uuid4().hex}.pdf"
    path = os.path.join(_books_upload_dir(), name)
    file.save(path)
    return _media_url(name)


def _delete_file(url):
    if not url:
        return
    filename = url.split('/')[-1]
    if not filename:
        return
    filepath = os.path.join(_books_upload_dir(), filename)
    if os.path.isfile(filepath):
        try:
            os.remove(filepath)
        except OSError:
            pass


def _generate_slug(title, exclude_id=None):
    base = re.sub(r'[^a-z0-9]+', '-', title.lower().strip())
    base = re.sub(r'-+', '-', base).strip('-') or 'book'
    slug = base
    n = 2
    while True:
        q = Book.query.filter_by(slug=slug)
        if exclude_id:
            q = q.filter(Book.id != exclude_id)
        if not q.first():
            return slug
        slug = f'{base}-{n}'
        n += 1


def _get_settings():
    settings = BooksSettings.query.get(1)
    if not settings:
        settings = BooksSettings(id=1)
        db.session.add(settings)
        db.session.commit()
    return settings


def init_books_settings():
    _get_settings()


def _paginate(query, page, limit):
    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    total_pages = max(1, (total + limit - 1) // limit) if limit else 1
    return items, total, total_pages


# --- Public ---

@bp.route('/settings', methods=['GET'])
def books_settings():
    return jsonify(_get_settings().to_dict())


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
def list_books():
    page = max(1, int(request.args.get('page', 1)))
    limit = min(50, max(1, int(request.args.get('limit', 9))))
    category = request.args.get('category')
    search = (request.args.get('search') or '').strip()
    q = Book.query.filter_by(is_published=True)
    if category and category.lower() != 'all':
        q = q.filter(Book.category == category)
    if search:
        like = f'%{search}%'
        q = q.filter(or_(Book.title.ilike(like), Book.excerpt.ilike(like), Book.author_name.ilike(like)))

    q = _mysql_safe_book_order(q)
    items, total, total_pages = _paginate(q, page, limit)
    return jsonify({
        'books': [b.to_public_dict() for b in items],
        'pagination': {'page': page, 'limit': limit, 'total': total, 'total_pages': total_pages},
    })


@bp.route('/<slug>', methods=['GET'])
def get_book(slug):
    book = Book.query.filter_by(slug=slug, is_published=True).first()
    if not book:
        return jsonify({'error': 'Book not found'}), 404
    book.views = (book.views or 0) + 1
    db.session.commit()
    return jsonify(book.to_public_dict())


# --- Admin ---

@admin_bp.route('/stats', methods=['GET'])
def admin_stats():
    total = Book.query.count()
    published = Book.query.filter_by(is_published=True).count()
    drafts = total - published
    views = db.session.query(db.func.coalesce(db.func.sum(Book.views), 0)).scalar() or 0
    return jsonify({
        'total': total,
        'published': published,
        'drafts': drafts,
        'views': int(views),
    })


@admin_bp.route('/settings', methods=['GET', 'PUT'])
def admin_settings():
    settings = _get_settings()
    if request.method == 'GET':
        return jsonify(settings.to_dict())

    try:
        if request.content_type and 'multipart/form-data' in request.content_type:
            if request.form.get('hero_title'):
                settings.hero_title = request.form.get('hero_title').strip()
            if request.form.get('hero_subtitle') is not None:
                settings.hero_subtitle = request.form.get('hero_subtitle', '').strip()
            if 'hero_image' in request.files and request.files['hero_image'].filename:
                _delete_file(settings.hero_image_url)
                settings.hero_image_url = _save_cover(request.files['hero_image'])
            if request.form.get('remove_hero_image', 'false').lower() in ('true', '1'):
                _delete_file(settings.hero_image_url)
                settings.hero_image_url = None
        else:
            data = request.get_json() or {}
            if data.get('hero_title'):
                settings.hero_title = data['hero_title'].strip()
            if 'hero_subtitle' in data:
                settings.hero_subtitle = (data.get('hero_subtitle') or '').strip()
        settings.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify(settings.to_dict())
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@admin_bp.route('', methods=['GET'])
@admin_bp.route('/', methods=['GET'])
def admin_list_books():
    status = (request.args.get('status') or 'all').lower()
    search = (request.args.get('search') or '').strip()
    q = Book.query
    if status == 'published':
        q = q.filter_by(is_published=True)
    elif status == 'draft':
        q = q.filter_by(is_published=False)
    if search:
        like = f'%{search}%'
        q = q.filter(or_(Book.title.ilike(like), Book.excerpt.ilike(like)))
    books = q.order_by(Book.updated_at.desc()).all()
    return jsonify([b.to_public_dict() for b in books])


@admin_bp.route('', methods=['POST'])
@admin_bp.route('/', methods=['POST'])
def admin_create_book():
    try:
        title = (request.form.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'title is required'}), 400
        excerpt = (request.form.get('excerpt') or '')[:300]
        category = request.form.get('category') or 'Graduation'
        if category not in CATEGORIES:
            category = 'Graduation'
        audience = 'all'
        author_name = _resolve_author(request.form.get('author_name'), title)
        publish = request.form.get('is_published', 'false').lower() in ('true', '1', 'yes')
        slug = _generate_slug(title)
        cover = None
        pdf = None
        if 'cover_image' in request.files:
            cover = _save_cover(request.files['cover_image'])
        if 'pdf_file' in request.files:
            pdf = _save_pdf(request.files['pdf_file'])
        now = datetime.utcnow()
        book = Book(
            title=title,
            slug=slug,
            excerpt=excerpt,
            cover_image_url=cover,
            pdf_url=pdf,
            author_name=author_name,
            category=category,
            audience=audience,
            is_published=publish,
            published_at=now if publish else None,
            created_at=now,
            updated_at=now,
        )
        db.session.add(book)
        db.session.commit()
        return jsonify(book.to_public_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/<int:book_id>', methods=['PUT'])
def admin_update_book(book_id):
    book = Book.query.get_or_404(book_id)
    try:
        if request.form.get('title'):
            book.title = request.form.get('title').strip()
            slug_override = (request.form.get('slug') or '').strip()
            if slug_override:
                book.slug = _generate_slug(slug_override, exclude_id=book.id)
        if request.form.get('excerpt') is not None:
            book.excerpt = (request.form.get('excerpt') or '')[:300]
        if request.form.get('author_name') is not None:
            book.author_name = _resolve_author(request.form.get('author_name'), book.title)
        if request.form.get('category') in CATEGORIES:
            book.category = request.form.get('category')
        book.audience = 'all'
        if 'cover_image' in request.files and request.files['cover_image'].filename:
            _delete_file(book.cover_image_url)
            book.cover_image_url = _save_cover(request.files['cover_image'])
        if request.form.get('remove_cover', 'false').lower() in ('true', '1'):
            _delete_file(book.cover_image_url)
            book.cover_image_url = None
        if 'pdf_file' in request.files and request.files['pdf_file'].filename:
            _delete_file(book.pdf_url)
            book.pdf_url = _save_pdf(request.files['pdf_file'])
        if request.form.get('remove_pdf', 'false').lower() in ('true', '1'):
            _delete_file(book.pdf_url)
            book.pdf_url = None
        publish_field = request.form.get('is_published')
        if publish_field is not None:
            publish = publish_field.lower() in ('true', '1', 'yes')
            book.is_published = publish
            if publish and not book.published_at:
                book.published_at = datetime.utcnow()
        book.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify(book.to_public_dict())
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/<int:book_id>', methods=['DELETE'])
def admin_delete_book(book_id):
    book = Book.query.get_or_404(book_id)
    _delete_file(book.cover_image_url)
    _delete_file(book.pdf_url)
    db.session.delete(book)
    db.session.commit()
    return '', 204


@admin_bp.route('/<int:book_id>/publish', methods=['PATCH'])
def admin_toggle_publish(book_id):
    book = Book.query.get_or_404(book_id)
    book.is_published = not book.is_published
    if book.is_published and not book.published_at:
        book.published_at = datetime.utcnow()
    book.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({
        'id': book.id,
        'is_published': book.is_published,
        'published_at': book.published_at.isoformat() if book.published_at else None,
    })

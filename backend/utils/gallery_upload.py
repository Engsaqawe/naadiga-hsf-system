"""Save public gallery slide images as files (not base64 in the database)."""

import base64
import io
import os
from datetime import datetime

from flask import current_app
from werkzeug.utils import secure_filename

GALLERY_UPLOAD_PREFIX = 'portal/public/assets/uploads/gallery/'
ALLOWED_IMAGE_EXT = frozenset({'png', 'jpg', 'jpeg', 'webp', 'gif'})
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_DIMENSION = 1920
JPEG_QUALITY = 85


def is_gallery_upload_path(ref):
    return bool(ref and str(ref).startswith(GALLERY_UPLOAD_PREFIX))


def gallery_uploads_dir():
    root = os.path.abspath(os.path.join(current_app.root_path, '..'))
    return os.path.join(root, 'portal', 'public', 'assets', 'uploads', 'gallery')


def remove_gallery_image_file(relative_path):
    if not is_gallery_upload_path(relative_path):
        return
    root = os.path.abspath(os.path.join(current_app.root_path, '..'))
    full = os.path.join(root, str(relative_path).replace('/', os.sep))
    if os.path.isfile(full):
        os.remove(full)


def _decode_data_url(data_url):
    raw = str(data_url or '').strip()
    if not raw.startswith('data:'):
        raise ValueError('Invalid image data.')
    if ',' not in raw:
        raise ValueError('Invalid image data.')
    _header, payload = raw.split(',', 1)
    try:
        return base64.b64decode(payload)
    except (ValueError, TypeError) as exc:
        raise ValueError('Invalid image data.') from exc


def _prepare_image(img):
    from PIL import Image

    if img.mode in ('RGBA', 'LA', 'P'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        alpha = img.split()[-1] if img.mode in ('RGBA', 'LA') else None
        bg.paste(img, mask=alpha)
        img = bg
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    width, height = img.size
    if max(width, height) > MAX_DIMENSION:
        ratio = MAX_DIMENSION / float(max(width, height))
        img = img.resize((int(width * ratio), int(height * ratio)), Image.Resampling.LANCZOS)
    return img


def _write_jpeg(raw_bytes, filepath):
    from PIL import Image

    img = Image.open(io.BytesIO(raw_bytes))
    img = _prepare_image(img)
    img.save(filepath, 'JPEG', quality=JPEG_QUALITY, optimize=True)


def _write_raw_fallback(raw_bytes, filepath):
    with open(filepath, 'wb') as handle:
        handle.write(raw_bytes)


def save_gallery_slide_image(cat_id, slide_index, file_storage=None, data_url=None, old_ref=None):
    if old_ref:
        remove_gallery_image_file(old_ref)

    raw_bytes = None
    if file_storage is not None:
        file_storage.stream.seek(0)
        raw_bytes = file_storage.read()
        if file_storage.filename:
            ext = file_storage.filename.rsplit('.', 1)[-1].lower()
            if ext and ext not in ALLOWED_IMAGE_EXT:
                raise ValueError('Image type not allowed. Use JPG, PNG, WebP, or GIF.')
    elif data_url:
        raw_bytes = _decode_data_url(data_url)
    else:
        raise ValueError('No image provided.')

    if not raw_bytes:
        raise ValueError('No image provided.')
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise ValueError('Image is too large. Please use a file under 12 MB.')

    uploads_dir = gallery_uploads_dir()
    os.makedirs(uploads_dir, exist_ok=True)

    stamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    filename = secure_filename(f'cat_{cat_id}_slide_{slide_index}_{stamp}.jpg')
    filepath = os.path.join(uploads_dir, filename)

    try:
        _write_jpeg(raw_bytes, filepath)
    except ImportError:
        ext = 'jpg'
        if file_storage and file_storage.filename and '.' in file_storage.filename:
            ext = file_storage.filename.rsplit('.', 1)[-1].lower()
            if ext not in ALLOWED_IMAGE_EXT:
                ext = 'jpg'
        filename = secure_filename(f'cat_{cat_id}_slide_{slide_index}_{stamp}.{ext}')
        filepath = os.path.join(uploads_dir, filename)
        _write_raw_fallback(raw_bytes, filepath)
    except Exception as exc:
        raise ValueError('Could not process image. Try a different JPG or PNG file.') from exc

    return f'{GALLERY_UPLOAD_PREFIX}{filename}'

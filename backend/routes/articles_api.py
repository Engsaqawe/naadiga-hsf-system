import os
import re
import uuid
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import or_, func
from extensions import db
from models import Article, ArticleMember, ArticlesSettings, ArticleReaction, ArticleComment

bp = Blueprint('articles', __name__)
admin_bp = Blueprint('articles_admin', __name__)

ALLOWED_THUMB_EXT = {'jpg', 'jpeg', 'png', 'webp'}
CATEGORIES = (
    'Research', 'Opinion', 'Report', 'Story',
    'Education', 'Technology', 'Health', 'Interview', 'Analysis', 'Case Study',
)


def _articles_upload_dir():
    base = current_app.config.get('UPLOAD_FOLDER', 'uploads')
    path = os.path.join(base, 'articles')
    os.makedirs(path, exist_ok=True)
    return path


def _thumb_url(filename):
    if not filename:
        return None
    if filename.startswith('http') or filename.startswith('/'):
        return filename
    return f'/api/uploads/articles/{filename}'


def _save_thumbnail(file):
    if not file or not file.filename:
        return None
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ALLOWED_THUMB_EXT:
        raise ValueError('Only JPG, PNG, and WebP images are allowed')
    max_mb = 5
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > max_mb * 1024 * 1024:
        raise ValueError(f'File too large (max {max_mb}MB)')
    name = f"{uuid.uuid4().hex}.{ext}"
    path = os.path.join(_articles_upload_dir(), name)
    file.save(path)
    return _thumb_url(name)


def _delete_thumbnail_file(thumbnail_url):
    if not thumbnail_url:
        return
    filename = thumbnail_url.split('/')[-1]
    if not filename:
        return
    filepath = os.path.join(_articles_upload_dir(), filename)
    if os.path.isfile(filepath):
        try:
            os.remove(filepath)
        except OSError:
            pass


def _generate_slug(title, exclude_id=None):
    base = re.sub(r'[^a-z0-9]+', '-', title.lower().strip())
    base = re.sub(r'-+', '-', base).strip('-') or 'article'
    slug = base
    n = 2
    while True:
        q = Article.query.filter_by(slug=slug)
        if exclude_id:
            q = q.filter(Article.id != exclude_id)
        if not q.first():
            return slug
        slug = f'{base}-{n}'
        n += 1


def _get_settings():
    settings = ArticlesSettings.query.get(1)
    if not settings:
        settings = ArticlesSettings(id=1)
        db.session.add(settings)
        db.session.commit()
    return settings


def _paginate(query, page, limit):
    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    total_pages = max(1, (total + limit - 1) // limit) if limit else 1
    return items, total, total_pages


# --- Public routes (mounted at /api/articles) ---

@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
def list_articles():
    page = max(1, int(request.args.get('page', 1)))
    limit = min(50, max(1, int(request.args.get('limit', 9))))
    category = request.args.get('category')
    search = (request.args.get('search') or '').strip()
    tag = (request.args.get('tag') or '').strip()
    author_id = request.args.get('author_id') or request.args.get('author')

    q = Article.query.filter_by(is_published=True)
    if author_id and str(author_id).isdigit():
        q = q.filter(Article.author_id == int(author_id))
    if category and category.lower() != 'all':
        q = q.filter(Article.category == category)
    if search:
        like = f'%{search}%'
        q = q.filter(or_(Article.title.ilike(like), Article.excerpt.ilike(like)))
    if tag:
        q = q.filter(Article.tags.ilike(f'%{tag}%'))

    q = q.order_by(Article.published_at.desc(), Article.created_at.desc())
    items, total, total_pages = _paginate(q, page, limit)
    return jsonify({
        'articles': [a.to_public_dict() for a in items],
        'total': total,
        'page': page,
        'totalPages': total_pages,
    })


@bp.route('/settings', methods=['GET'])
def get_page_settings():
    return jsonify(_get_settings().to_dict())


@bp.route('/members/<int:member_id>', methods=['GET'])
def get_public_member(member_id):
    member = ArticleMember.query.get_or_404(member_id)
    count = Article.query.filter_by(author_id=member.id, is_published=True).count()
    data = member.to_dict()
    data['article_count'] = count
    return jsonify(data)


@bp.route('/categories', methods=['GET'])
def article_categories():
    rows = (
        db.session.query(Article.category, func.count(Article.id))
        .filter(Article.is_published.is_(True))
        .group_by(Article.category)
        .all()
    )
    return jsonify([{'category': c, 'count': n} for c, n in rows])


@bp.route('/<slug>', methods=['GET'])
def get_article(slug):
    article = Article.query.filter_by(slug=slug, is_published=True).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404
    article.views = (article.views or 0) + 1
    db.session.commit()
    data = article.to_public_dict(include_content=True)
    client_id = (request.args.get('client_id') or '').strip()[:64]
    if client_id:
        existing = ArticleReaction.query.filter_by(
            article_id=article.id, client_id=client_id
        ).first()
        data['user_reaction'] = existing.reaction if existing else None
    data['comment_count'] = ArticleComment.query.filter_by(article_id=article.id).count()
    return jsonify(data)


@bp.route('/<slug>/react', methods=['POST'])
def react_to_article(slug):
    article = Article.query.filter_by(slug=slug, is_published=True).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    payload = request.get_json(silent=True) or {}
    reaction_type = (payload.get('type') or '').strip().lower()
    client_id = (payload.get('client_id') or request.headers.get('X-Client-Id') or '').strip()[:64]

    if reaction_type not in ('like', 'dislike'):
        return jsonify({'error': 'Invalid reaction type'}), 400
    if not client_id or len(client_id) < 8:
        return jsonify({'error': 'client_id is required'}), 400

    article.likes = article.likes or 0
    article.dislikes = article.dislikes or 0
    existing = ArticleReaction.query.filter_by(
        article_id=article.id, client_id=client_id
    ).first()

    user_reaction = None
    if existing:
        if existing.reaction == reaction_type:
            if reaction_type == 'like':
                article.likes = max(0, article.likes - 1)
            else:
                article.dislikes = max(0, article.dislikes - 1)
            db.session.delete(existing)
        else:
            if existing.reaction == 'like':
                article.likes = max(0, article.likes - 1)
                article.dislikes += 1
            else:
                article.dislikes = max(0, article.dislikes - 1)
                article.likes += 1
            existing.reaction = reaction_type
            user_reaction = reaction_type
    else:
        db.session.add(ArticleReaction(
            article_id=article.id,
            client_id=client_id,
            reaction=reaction_type,
        ))
        if reaction_type == 'like':
            article.likes += 1
        else:
            article.dislikes += 1
        user_reaction = reaction_type

    db.session.commit()
    return jsonify({
        'likes': article.likes,
        'dislikes': article.dislikes,
        'user_reaction': user_reaction,
    })


@bp.route('/<slug>/comments', methods=['GET'])
def list_article_comments(slug):
    article = Article.query.filter_by(slug=slug, is_published=True).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404
    comments = (
        ArticleComment.query.filter_by(article_id=article.id)
        .order_by(ArticleComment.created_at.desc())
        .all()
    )
    return jsonify({
        'comments': [c.to_dict() for c in comments],
        'total': len(comments),
    })


@bp.route('/<slug>/comments', methods=['POST'])
def add_article_comment(slug):
    article = Article.query.filter_by(slug=slug, is_published=True).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    payload = request.get_json(silent=True) or {}
    author_name = (payload.get('author_name') or '').strip()[:120]
    body = (payload.get('body') or '').strip()[:2000]
    client_id = (payload.get('client_id') or '').strip()[:64] or None

    if len(author_name) < 2:
        return jsonify({'error': 'Please enter your name (at least 2 characters)'}), 400
    if len(body) < 3:
        return jsonify({'error': 'Comment must be at least 3 characters'}), 400

    comment = ArticleComment(
        article_id=article.id,
        author_name=author_name,
        body=body,
        client_id=client_id,
    )
    db.session.add(comment)
    db.session.commit()
    return jsonify(comment.to_dict()), 201


# --- Admin routes (mounted at /api/admin/articles) ---

@admin_bp.route('/settings', methods=['GET'])
def admin_get_settings():
    return jsonify(_get_settings().to_dict())


@admin_bp.route('/settings', methods=['PUT'])
def admin_update_settings():
    settings = _get_settings()
    try:
        if request.form.get('hero_title') is not None:
            settings.hero_title = (request.form.get('hero_title') or '').strip() or settings.hero_title
        if request.form.get('hero_subtitle') is not None:
            settings.hero_subtitle = (request.form.get('hero_subtitle') or '').strip() or settings.hero_subtitle
        if request.form.get('remove_hero_image', 'false').lower() in ('true', '1', 'yes'):
            _delete_thumbnail_file(settings.hero_image_url)
            settings.hero_image_url = None
        if 'hero_image' in request.files and request.files['hero_image'].filename:
            _delete_thumbnail_file(settings.hero_image_url)
            settings.hero_image_url = _save_thumbnail(request.files['hero_image'])
        settings.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify(settings.to_dict())
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/stats', methods=['GET'])
def admin_stats():
    total = Article.query.count()
    published = Article.query.filter_by(is_published=True).count()
    drafts = total - published
    total_views = db.session.query(func.coalesce(func.sum(Article.views), 0)).scalar() or 0
    total_authors = ArticleMember.query.count()
    top = (
        Article.query.order_by(Article.views.desc())
        .limit(5)
        .all()
    )
    return jsonify({
        'total': total,
        'published': published,
        'drafts': drafts,
        'total_views': int(total_views),
        'total_authors': total_authors,
        'top_articles': [
            {'id': a.id, 'title': a.title, 'views': a.views, 'slug': a.slug}
            for a in top
        ],
    })


@admin_bp.route('', methods=['GET'])
@admin_bp.route('/', methods=['GET'])
def admin_list_articles():
    page = max(1, int(request.args.get('page', 1)))
    limit = min(100, max(1, int(request.args.get('limit', 20))))
    status = request.args.get('status', 'all')
    search = (request.args.get('search') or '').strip()

    q = Article.query
    if status == 'published':
        q = q.filter_by(is_published=True)
    elif status == 'draft':
        q = q.filter_by(is_published=False)
    if search:
        like = f'%{search}%'
        q = q.filter(or_(Article.title.ilike(like), Article.excerpt.ilike(like)))

    q = q.order_by(Article.updated_at.desc(), Article.created_at.desc())
    items, total, total_pages = _paginate(q, page, limit)
    return jsonify({
        'articles': [a.to_public_dict() for a in items],
        'total': total,
        'page': page,
        'totalPages': total_pages,
    })


@admin_bp.route('/<int:article_id>', methods=['GET'])
def admin_get_article(article_id):
    article = Article.query.get_or_404(article_id)
    return jsonify(article.to_public_dict(include_content=True))


@admin_bp.route('', methods=['POST'])
@admin_bp.route('/', methods=['POST'])
def admin_create_article():
    try:
        title = (request.form.get('title') or '').strip()
        excerpt = (request.form.get('excerpt') or '').strip()
        content = (request.form.get('content') or '').strip()
        category = request.form.get('category') or 'Research'
        tags = request.form.get('tags') or ''
        author_id = request.form.get('author_id')
        slug_override = (request.form.get('slug') or '').strip()
        publish = request.form.get('is_published', 'false').lower() in ('true', '1', 'yes')

        if not title or len(title) < 3:
            return jsonify({'error': 'Title must be at least 3 characters'}), 400
        if not excerpt or not content:
            return jsonify({'error': 'Excerpt and content are required'}), 400
        if category not in CATEGORIES:
            return jsonify({'error': 'Invalid category'}), 400

        slug = slug_override or _generate_slug(title)
        thumb = None
        if 'thumbnail' in request.files:
            thumb = _save_thumbnail(request.files['thumbnail'])

        author_id_int = int(author_id) if author_id and str(author_id).isdigit() else None
        now = datetime.utcnow()
        article = Article(
            title=title,
            slug=slug,
            excerpt=excerpt[:200],
            content=content,
            thumbnail_url=thumb,
            author_id=author_id_int,
            category=category,
            tags=tags,
            is_published=publish,
            published_at=now if publish else None,
            created_at=now,
            updated_at=now,
        )
        db.session.add(article)
        db.session.commit()
        return jsonify(article.to_public_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/<int:article_id>', methods=['PUT'])
def admin_update_article(article_id):
    article = Article.query.get_or_404(article_id)
    try:
        title = request.form.get('title')
        if title is not None:
            title = title.strip()
            article.title = title
            slug_override = (request.form.get('slug') or '').strip()
            if slug_override:
                article.slug = _generate_slug(slug_override, exclude_id=article.id)
            elif request.form.get('regenerate_slug', 'false').lower() in ('true', '1'):
                article.slug = _generate_slug(title, exclude_id=article.id)

        if request.form.get('excerpt') is not None:
            article.excerpt = request.form.get('excerpt', '')[:200]
        if request.form.get('content') is not None:
            article.content = request.form.get('content', '')
        if request.form.get('category') is not None:
            cat = request.form.get('category')
            if cat in CATEGORIES:
                article.category = cat
        if request.form.get('tags') is not None:
            article.tags = request.form.get('tags', '')
        if request.form.get('author_id') is not None:
            aid = request.form.get('author_id')
            article.author_id = int(aid) if aid and str(aid).isdigit() else None

        if 'thumbnail' in request.files and request.files['thumbnail'].filename:
            _delete_thumbnail_file(article.thumbnail_url)
            article.thumbnail_url = _save_thumbnail(request.files['thumbnail'])

        if request.form.get('remove_thumbnail', 'false').lower() in ('true', '1'):
            _delete_thumbnail_file(article.thumbnail_url)
            article.thumbnail_url = None

        publish_field = request.form.get('is_published')
        if publish_field is not None:
            publish = publish_field.lower() in ('true', '1', 'yes')
            article.is_published = publish
            if publish and not article.published_at:
                article.published_at = datetime.utcnow()

        article.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify(article.to_public_dict(include_content=True))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/<int:article_id>', methods=['DELETE'])
def admin_delete_article(article_id):
    article = Article.query.get_or_404(article_id)
    _delete_thumbnail_file(article.thumbnail_url)
    db.session.delete(article)
    db.session.commit()
    return '', 204


@admin_bp.route('/<int:article_id>/publish', methods=['PATCH'])
def admin_toggle_publish(article_id):
    article = Article.query.get_or_404(article_id)
    article.is_published = not article.is_published
    if article.is_published and not article.published_at:
        article.published_at = datetime.utcnow()
    article.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({
        'id': article.id,
        'is_published': article.is_published,
        'published_at': article.published_at.isoformat() if article.published_at else None,
    })


@admin_bp.route('/members', methods=['GET'])
def admin_list_members():
    members = ArticleMember.query.order_by(ArticleMember.full_name).all()
    return jsonify([m.to_dict() for m in members])


@admin_bp.route('/members', methods=['POST'])
def admin_create_member():
    try:
        if request.content_type and 'multipart/form-data' in request.content_type:
            full_name = (request.form.get('full_name') or '').strip()
            if not full_name:
                return jsonify({'error': 'full_name is required'}), 400
            avatar_url = None
            if 'avatar' in request.files and request.files['avatar'].filename:
                avatar_url = _save_thumbnail(request.files['avatar'])
            member = ArticleMember(
                full_name=full_name,
                title=request.form.get('title'),
                bio=request.form.get('bio'),
                avatar_url=avatar_url,
            )
        else:
            data = request.get_json() or {}
            if not data.get('full_name'):
                return jsonify({'error': 'full_name is required'}), 400
            member = ArticleMember(
                full_name=data['full_name'],
                title=data.get('title'),
                bio=data.get('bio'),
                avatar_url=data.get('avatar_url'),
            )
        db.session.add(member)
        db.session.commit()
        return jsonify(member.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@admin_bp.route('/members/<int:member_id>', methods=['PUT'])
def admin_update_member(member_id):
    member = ArticleMember.query.get_or_404(member_id)
    try:
        if request.content_type and 'multipart/form-data' in request.content_type:
            if request.form.get('full_name'):
                member.full_name = request.form.get('full_name').strip()
            if request.form.get('title') is not None:
                member.title = request.form.get('title')
            if request.form.get('bio') is not None:
                member.bio = request.form.get('bio')
            if request.form.get('remove_avatar', 'false').lower() in ('true', '1', 'yes'):
                _delete_thumbnail_file(member.avatar_url)
                member.avatar_url = None
            if 'avatar' in request.files and request.files['avatar'].filename:
                _delete_thumbnail_file(member.avatar_url)
                member.avatar_url = _save_thumbnail(request.files['avatar'])
        else:
            data = request.get_json() or {}
            for field in ('full_name', 'title', 'bio', 'avatar_url'):
                if field in data:
                    setattr(member, field, data[field])
        db.session.commit()
        return jsonify(member.to_dict())
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@admin_bp.route('/members/<int:member_id>', methods=['DELETE'])
def admin_delete_member(member_id):
    member = ArticleMember.query.get_or_404(member_id)
    Article.query.filter_by(author_id=member.id).update({'author_id': None})
    db.session.delete(member)
    db.session.commit()
    return '', 204


@admin_bp.route('/comments/<int:comment_id>', methods=['DELETE'])
def admin_delete_comment(comment_id):
    comment = ArticleComment.query.get_or_404(comment_id)
    db.session.delete(comment)
    db.session.commit()
    return '', 204


def _migrate_article_columns():
    """Add likes/dislikes columns on existing SQLite DBs without full migration."""
    from sqlalchemy import inspect, text
    try:
        insp = inspect(db.engine)
        if 'articles' not in insp.get_table_names():
            return
        cols = {c['name'] for c in insp.get_columns('articles')}
        stmts = []
        if 'likes' not in cols:
            stmts.append('ALTER TABLE articles ADD COLUMN likes INTEGER DEFAULT 0')
        if 'dislikes' not in cols:
            stmts.append('ALTER TABLE articles ADD COLUMN dislikes INTEGER DEFAULT 0')
        if stmts:
            with db.engine.begin() as conn:
                for sql in stmts:
                    conn.execute(text(sql))
    except Exception as e:
        print(f'Article columns migration note: {e}')


def init_articles_settings():
    _get_settings()
    _migrate_article_columns()
    db.create_all()


def seed_articles():
    """Seed sample members and articles when tables are empty."""
    init_articles_settings()
    if Article.query.first() is not None:
        return

    members = [
        ArticleMember(
            full_name='Abdullahi Mohamud Hassan',
            title='BSc Computer Science, SIMAD University',
        ),
        ArticleMember(
            full_name='Faadumo Ahmed Yusuf',
            title='BSc Nursing, University of Somalia',
        ),
        ArticleMember(
            full_name='Mohamed Abdi Warsame',
            title='BSc Business Administration, Mogadishu University',
        ),
    ]
    for m in members:
        db.session.add(m)
    db.session.flush()

    now = datetime.utcnow()
    samples = [
        {
            'title': 'Digital Transformation in Somali Healthcare: Challenges and Opportunities',
            'slug': 'digital-transformation-somali-healthcare',
            'category': 'Research',
            'author_id': members[0].id,
            'excerpt': 'An examination of how digital tools can improve patient outcomes in Somali hospitals, drawing from field research at Mogadishu\'s major medical facilities.',
            'tags': 'healthcare,technology,research,Somalia',
            'content': _SEED_ARTICLE_1,
        },
        {
            'title': 'Community Tutoring Initiative: How We Helped 200 Students Pass Their Exams',
            'slug': 'community-tutoring-initiative-200-students',
            'category': 'Story',
            'author_id': members[1].id,
            'excerpt': 'In 2024, our scholarship club organized free tutoring sessions that reached over 200 secondary school students across Mogadishu — here is the story of how it happened.',
            'tags': 'community,education,volunteering,impact',
            'content': _SEED_ARTICLE_2,
        },
        {
            'title': 'Renewable Energy Solutions for Rural Somalia: A Student Perspective',
            'slug': 'renewable-energy-rural-somalia',
            'category': 'Opinion',
            'author_id': members[2].id,
            'excerpt': 'Somalia has some of the lowest electricity access rates in the world. As scholarship students, we believe the youth must lead the push for solar and wind energy adoption in rural communities.',
            'tags': 'energy,sustainability,rural,opinion',
            'content': _SEED_ARTICLE_3,
        },
    ]

    for s in samples:
        db.session.add(Article(
            title=s['title'],
            slug=s['slug'],
            excerpt=s['excerpt'][:200],
            content=s['content'],
            author_id=s['author_id'],
            category=s['category'],
            tags=s['tags'],
            is_published=True,
            published_at=now,
            views=0,
            created_at=now,
            updated_at=now,
        ))
    db.session.commit()
    print('Articles seeded successfully.')


_SEED_ARTICLE_1 = """## Introduction

Somalia's healthcare system has endured decades of disruption. Yet across Mogadishu, clinicians and patients are quietly adopting digital tools that promise safer care, faster referrals, and better record-keeping.

## Current State of Somali Healthcare

Public hospitals face chronic shortages of specialists, inconsistent supply chains, and paper-based records that are easily lost. Private clinics have expanded access but often operate in silos without shared data standards.

## Technology Gaps

- Limited electronic health records (EHR) adoption
- Weak internet infrastructure in rural districts
- Low digital literacy among some clinical staff
- Fragmented procurement for medical devices

## Mobile Health Opportunities

Mobile platforms can deliver appointment reminders, maternal health tips, and vaccination schedules directly to families. Pilot programs in Benadir region show high engagement when content is in Somali and audio formats are available.

## Telemedicine Potential

> "When a specialist in Mogadishu can review a scan from Kismayo within hours, we save lives that would otherwise be lost to delay." — Regional health coordinator

Telemedicine hubs linking university hospitals with district clinics could reduce unnecessary travel and centralize expertise.

## Recommendations

1. Invest in nationwide health data standards and privacy guidelines.
2. Partner universities with hospitals for ICT training and internships.
3. Expand solar-powered connectivity at rural health posts.
4. Fund open-source Somali-language health apps built by local developers.

## Conclusion

Digital transformation is not a luxury for Somali healthcare—it is a practical path toward equity, accountability, and resilience. Scholarship students in STEM and health sciences have a duty to contribute research, volunteer hours, and advocacy for thoughtful technology adoption.
"""

_SEED_ARTICLE_2 = """## The Problem We Saw

Every examination season, families in Mogadishu struggle to afford private tutoring. Scholarship students from Hormuud Salaam Foundation saw classmates in neighboring schools left behind—not from lack of ability, but from lack of support.

## Organizing the Initiative

We started with a simple pledge: **ten hours of free tutoring per volunteer, per month.** Leaders mapped subjects—mathematics, chemistry, English, and Somali—and matched students to mentors based on school curriculum.

## Volunteer Coordination

- Weekly planning meetings at the foundation office
- Shared lesson plans on a group channel
- Rotating venues at partner schools and community halls

## Challenges Faced

Transport costs, exam timetable clashes, and occasional security concerns required flexible scheduling. We learned to batch sessions on weekends and record short revision videos for students who could not attend in person.

## Results Achieved

By the end of 2024, more than **200 students** had attended at least six sessions. Teachers at two partner schools reported measurable improvement in mock exam averages.

> "I passed mathematics because the mentors explained problems in Somali and showed us how to practice daily." — Secondary student, Hodan district

## Lessons Learned

Community tutoring works when it is consistent, localized, and led by peers who understand the pressure of national exams. The foundation plans to scale the model to additional districts with alumni funding.

## Looking Ahead

We are recruiting new volunteers for the 2025 cycle and seeking partnerships with textbook donors. If you are a scholarship student, your expertise is needed—one hour a week can change a student's trajectory.
"""

_SEED_ARTICLE_3 = """## Somalia's Energy Reality

Electricity access in rural Somalia remains among the lowest globally. Diesel generators are expensive, unreliable, and contribute to air pollution. Families spend a large share of income on fuel that could instead fund education and health.

## Solar Energy Potential

Somalia receives strong year-round solar irradiation. Small home systems and community micro-grids can power schools, clinics, and phone charging stations without waiting for centralized grid expansion.

## Lessons from Other African Nations

Kenya and Rwanda have demonstrated how pay-as-you-go solar models and youth training programs accelerate adoption. Somali students can study these models and adapt them to clan-based land agreements and mobile money ecosystems.

## What Somali Students Can Do

- Conduct village energy surveys during university breaks
- Prototype low-cost solar kits in engineering clubs
- Advocate for tax incentives on imported solar components
- Document success stories from pilot villages

## Policy Recommendations

1. Streamline import procedures for certified solar equipment.
2. Train technicians in every federal member state.
3. Link energy access metrics to education and health funding.

## A Call to Action

> We do not need to wait for perfect infrastructure. We need committed youth who will install one panel, teach one family, and demand one policy change at a time.

The Hormuud Salaam Foundation scholarship community should lead by example—powering study halls, mentoring rural students, and publishing research that guides public investment in renewable energy.
"""

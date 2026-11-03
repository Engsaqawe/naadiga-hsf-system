from extensions import db
from datetime import datetime
import json
import re


class User(db.Model):
    ALNUUR_GUEST_ROLE = 'Alnuur'
    SUMMER_GUEST_ROLE = 'Summer Guest'
    HSF_MEMBER_ROLES = ('Student', 'Main Leader', 'Leader', 'Payment Sub Admin', 'Payment Admin', 'Media Admin')
    MEDIA_ADMIN_ROLE = 'Media Admin'

    id = db.Column(db.String(50), primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(50), nullable=False, unique=True)
    password = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(50), nullable=False) # e.g., 'Student', 'Main Leader'
    convocation = db.Column(db.String(50), db.ForeignKey('convocation.name'), nullable=True) # Enforcement
    university = db.Column(db.String(100), nullable=True)
    faculty = db.Column(db.String(100), nullable=True)
    semester = db.Column(db.String(50), nullable=True)
    has_works = db.Column(db.Boolean, default=False)
    work_place = db.Column(db.String(200), nullable=True)
    work_role = db.Column(db.String(100), nullable=True)
    work_started = db.Column(db.String(20), nullable=True)
    email = db.Column(db.String(100), nullable=True)
    phone = db.Column(db.String(50), nullable=True)
    bodyCard = db.Column(db.String(10), default='No')
    card_number = db.Column(db.String(50), nullable=True)
    isGraduated = db.Column(db.Boolean, default=False)
    meetingsMissed = db.Column(db.Integer, default=0)
    profilePic = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Security Fields
    otp_code = db.Column(db.String(6), nullable=True)
    otp_expiry = db.Column(db.DateTime, nullable=True)
    otp_attempts = db.Column(db.Integer, default=0)
    login_attempts = db.Column(db.Integer, default=0)
    is_locked = db.Column(db.Boolean, default=False)
    lock_until = db.Column(db.DateTime, nullable=True)

    def get_unpaid_months(self):
        if self.role == 'Public User':
            return []

        if not self.created_at:
            return []

        months_names = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]

        start_date = self.created_at
        end_date = datetime.utcnow()

        current_year = start_date.year
        current_month = start_date.month

        target_months = []
        while (current_year < end_date.year) or (current_year == end_date.year and current_month <= end_date.month):
            month_name = months_names[current_month - 1]
            target_months.append((month_name, current_year))
            current_month += 1
            if current_month > 12:
                current_month = 1
                current_year += 1

        txns = Transaction.query.filter_by(student_id=self.id).all()
        paid_statuses = {'paid', 'success'}
        paid_set = {
            (t.month.strip().lower(), int(t.year))
            for t in txns
            if str(t.status or '').lower() in paid_statuses
        }

        return [f"{m} {y}" for m, y in target_months if (m.lower(), y) not in paid_set]

    @classmethod
    def is_alnuur_guest_id(cls, user_id):
        return str(user_id or '').startswith('alnuur-')

    @classmethod
    def is_summer_guest_id(cls, user_id):
        return str(user_id or '').startswith('summer-guest-')

    def is_alnuur_guest(self):
        return self.role == self.ALNUUR_GUEST_ROLE or self.is_alnuur_guest_id(self.id)

    def is_summer_guest(self):
        return self.role == self.SUMMER_GUEST_ROLE or self.is_summer_guest_id(self.id)

    @classmethod
    def hsf_members_query(cls):
        """HSF scholarship members only — excludes public site users and Alnuur Quran guests."""
        return cls.query.filter(cls.role.in_(cls.HSF_MEMBER_ROLES))

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'username': self.username,
            'password': self.password,
            'role': self.role,
            'convocation': self.convocation,
            'university': self.university,
            'faculty': self.faculty,
            'semester': self.semester,
            'hasWorks': bool(self.has_works),
            'workPlace': self.work_place or '',
            'workRole': self.work_role or '',
            'workStarted': self.work_started or '',
            'email': self.email,
            'phone': self.phone,
            'bodyCard': self.bodyCard,
            'cardNumber': self.card_number or '',
            'isGraduated': self.isGraduated,
            'meetingsMissed': self.meetingsMissed,
            'profilePic': self.profilePic,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'unpaidMonths': self.get_unpaid_months()
        }


class Convocation(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    year = db.Column(db.Integer, nullable=False)
    isGraduated = db.Column(db.Boolean, default=False)

    users = db.relationship('User', backref='convocation_rel', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'year': self.year,
            'isGraduated': self.isGraduated
        }

class Meeting(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    topic = db.Column(db.String(200), nullable=False)
    date = db.Column(db.String(50), nullable=False) # Store as YYYY-MM-DD
    place = db.Column(db.String(100), nullable=False)
    presenter = db.Column(db.String(100), nullable=False)
    participantsCount = db.Column(db.Integer, default=0)
    convocation = db.Column(db.String(50), nullable=False) # 'All' or specific convocation
    target_audience = db.Column(db.String(20), default='active')  # active | graduated
    attendance_taken = db.Column(db.Boolean, default=False)
    eligible_member_ids = db.Column(db.Text, nullable=True)  # JSON list of user ids at creation

    def eligible_member_id_list(self):
        if not self.eligible_member_ids:
            return []
        try:
            data = json.loads(self.eligible_member_ids)
            return data if isinstance(data, list) else []
        except (TypeError, ValueError):
            return []

    def to_dict(self):
        return {
            'id': self.id,
            'topic': self.topic,
            'date': self.date,
            'place': self.place,
            'presenter': self.presenter,
            'participantsCount': self.participantsCount,
            'convocation': self.convocation,
            'target_audience': self.target_audience or 'active',
            'attendanceTaken': bool(self.attendance_taken),
            'eligibleMemberIds': self.eligible_member_id_list(),
        }

class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    date = db.Column(db.String(50), nullable=False)
    student_id = db.Column(db.String(50), db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    month = db.Column(db.String(50), nullable=False)
    year = db.Column(db.Integer, nullable=False, default=2026)
    amount = db.Column(db.String(20), nullable=False)
    method = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(50), nullable=False)
    convocation = db.Column(db.String(50), nullable=False)
    collector = db.Column(db.String(100), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'date': self.date,
            'student_id': self.student_id,
            'name': self.name,
            'month': self.month,
            'year': self.year,
            'amount': self.amount,
            'method': self.method,
            'status': self.status,
            'convocation': self.convocation,
            'collector': self.collector
        }

class Expense(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    month = db.Column(db.String(50), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    expense_date = db.Column(db.String(20), nullable=True)
    amount = db.Column(db.Float, nullable=False)
    description = db.Column(db.String(200), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'month': self.month,
            'year': self.year,
            'date': self.expense_date or '',
            'amount': self.amount,
            'description': self.description
        }


class FundEntry(db.Model):
    """Manual money-in from supporters / external sources (not member payments)."""
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    month = db.Column(db.String(50), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    entry_date = db.Column(db.String(20), nullable=True)
    amount = db.Column(db.Float, nullable=False)
    source_type = db.Column(db.String(50), nullable=False, default='Supported')
    description = db.Column(db.String(200), nullable=True)
    recorded_by = db.Column(db.String(100), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'month': self.month,
            'year': self.year,
            'date': self.entry_date or '',
            'amount': self.amount,
            'source_type': self.source_type or 'Supported',
            'description': self.description or '',
            'recorded_by': self.recorded_by or '',
        }


class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey('meeting.id'), nullable=False)
    student_id = db.Column(db.String(50), db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='Present') # Present, Absent, Late
    date = db.Column(db.String(50), nullable=False)
    is_excused = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'meeting_id': self.meeting_id,
            'student_id': self.student_id,
            'status': self.status,
            'date': self.date,
            'is_excused': bool(self.is_excused),
        }

# --- Public Website Models ---

class ContentCategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    image_base64 = db.Column(db.Text, nullable=True)
    caption = db.Column(db.String(200), nullable=True)
    slides_json = db.Column(db.Text, nullable=True)
    title = db.Column(db.String(300), nullable=True)
    description = db.Column(db.Text, nullable=True)
    section_title = db.Column(db.String(300), nullable=True)
    section_description = db.Column(db.Text, nullable=True)
    badge_text = db.Column(db.String(100), nullable=True)
    slides_text_json = db.Column(db.Text, nullable=True)

class Team(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(200))
    member_count = db.Column(db.Integer, default=0)
    category = db.Column(db.String(50))
    image_url = db.Column(db.String(200))


class SiteTeamMember(db.Model):
    """Leadership / staff shown on public site Our Team section."""
    __tablename__ = 'site_team_member'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(120), nullable=False)
    title = db.Column(db.String(200), nullable=False, default='')
    photo_url = db.Column(db.String(500), nullable=False, default='')
    sort_order = db.Column(db.Integer, default=0)
    is_published = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'title': self.title or '',
            'photo_url': self.photo_url or '',
            'sort_order': self.sort_order or 0,
            'is_published': bool(self.is_published),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class SiteStats(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    today_visitors = db.Column(db.Integer, default=0)
    total_visitors = db.Column(db.Integer, default=1250)
    visitors_date = db.Column(db.Date, nullable=True)


class SiteHomepageVideo(db.Model):
    """One row per homepage showcase video slot (ids 1–3)."""
    __tablename__ = 'site_homepage_video'
    id = db.Column(db.Integer, primary_key=True)
    custom_filename = db.Column(db.String(255), nullable=True)
    title = db.Column(db.String(300), nullable=True)
    description = db.Column(db.Text, nullable=True)

class AdminProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    foundation_name = db.Column(db.String(100), nullable=False)
    admin_email = db.Column(db.String(100), nullable=False)
    password = db.Column(db.String(100), nullable=False)
    theme = db.Column(db.String(20), default="dark")

class ContactMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=False)
    is_read = db.Column(db.Boolean, default=False)
    admin_reply = db.Column(db.Text, nullable=True)
    replied_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        from sqlalchemy import func
        user = User.query.filter(
            func.lower(User.email) == (self.email or '').strip().lower(),
            User.role == 'Public User',
        ).first()
        has_account = user is not None
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'message': self.message,
            'is_read': self.is_read,
            'admin_reply': self.admin_reply,
            'replied_at': self.replied_at.isoformat() if self.replied_at else None,
            'has_account': has_account,
            'username': user.username if user else None,
            'login_hint': (
                f'Can log in with username: {user.username}'
                if has_account
                else 'No login account — they must Register on the website to log in.'
            ),
            'created_at': self.created_at.isoformat()
        }


class ArticlesSettings(db.Model):
    """Singleton settings for the public articles listing page (not main site hero)."""
    __tablename__ = 'articles_settings'

    id = db.Column(db.Integer, primary_key=True, default=1)
    hero_image_url = db.Column(db.String(500), nullable=True)
    hero_title = db.Column(db.String(200), nullable=False, default="Members' Research & Articles")
    hero_subtitle = db.Column(
        db.String(300),
        nullable=False,
        default='Insights, research, and stories from our scholarship community',
    )
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'hero_image_url': self.hero_image_url,
            'hero_title': self.hero_title,
            'hero_subtitle': self.hero_subtitle,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class ArticleMember(db.Model):
    __tablename__ = 'article_members'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    full_name = db.Column(db.String(150), nullable=False)
    title = db.Column(db.String(200), nullable=True)
    bio = db.Column(db.Text, nullable=True)
    avatar_url = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    articles = db.relationship('Article', backref='author', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'full_name': self.full_name,
            'title': self.title,
            'bio': self.bio,
            'avatar_url': self.avatar_url,
        }


class Article(db.Model):
    __tablename__ = 'articles'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(300), nullable=False)
    slug = db.Column(db.String(300), unique=True, nullable=False, index=True)
    excerpt = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    thumbnail_url = db.Column(db.String(500), nullable=True)
    author_id = db.Column(db.Integer, db.ForeignKey('article_members.id', ondelete='SET NULL'), nullable=True)
    category = db.Column(db.String(50), default='Research')
    tags = db.Column(db.String(500), nullable=True)
    is_published = db.Column(db.Boolean, default=False)
    views = db.Column(db.Integer, default=0)
    likes = db.Column(db.Integer, default=0)
    dislikes = db.Column(db.Integer, default=0)
    published_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public_dict(self, include_content=False):
        data = {
            'id': self.id,
            'title': self.title,
            'slug': self.slug,
            'excerpt': self.excerpt,
            'thumbnail_url': self.thumbnail_url,
            'category': self.category,
            'tags': self.tags,
            'is_published': self.is_published,
            'views': self.views,
            'likes': self.likes or 0,
            'dislikes': self.dislikes or 0,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'author': self.author.to_dict() if self.author else None,
        }
        if include_content:
            data['content'] = self.content
        return data


class Notification(db.Model):
    __tablename__ = 'notifications'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(50), db.ForeignKey('user.id'), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50), default='email')
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'body': self.body,
            'category': self.category,
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class ArticleReaction(db.Model):
    __tablename__ = 'article_reactions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    article_id = db.Column(db.Integer, db.ForeignKey('articles.id', ondelete='CASCADE'), nullable=False)
    client_id = db.Column(db.String(64), nullable=False)
    reaction = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('article_id', 'client_id', name='uq_article_client_reaction'),
    )


class ArticleComment(db.Model):
    __tablename__ = 'article_comments'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    article_id = db.Column(db.Integer, db.ForeignKey('articles.id', ondelete='CASCADE'), nullable=False, index=True)
    author_name = db.Column(db.String(120), nullable=False)
    body = db.Column(db.Text, nullable=False)
    client_id = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'article_id': self.article_id,
            'author_name': self.author_name,
            'body': self.body,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class BooksSettings(db.Model):
    """Singleton settings for the public books listing page."""
    __tablename__ = 'books_settings'

    id = db.Column(db.Integer, primary_key=True, default=1)
    hero_image_url = db.Column(db.String(500), nullable=True)
    hero_title = db.Column(db.String(200), nullable=False, default="Graduation Books & Publications")
    hero_subtitle = db.Column(
        db.String(300),
        nullable=False,
        default='PDF publications and graduation books from our scholarship alumni',
    )
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'hero_image_url': self.hero_image_url,
            'hero_title': self.hero_title,
            'hero_subtitle': self.hero_subtitle,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Book(db.Model):
    __tablename__ = 'books'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(300), nullable=False)
    slug = db.Column(db.String(300), unique=True, nullable=False, index=True)
    excerpt = db.Column(db.String(300), nullable=False, default='')
    cover_image_url = db.Column(db.String(500), nullable=True)
    pdf_url = db.Column(db.String(500), nullable=True)
    author_name = db.Column(db.String(150), nullable=True)
    category = db.Column(db.String(50), default='Graduation')
    audience = db.Column(db.String(20), default='graduated')  # graduated | active | all
    is_published = db.Column(db.Boolean, default=False)
    views = db.Column(db.Integer, default=0)
    published_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'slug': self.slug,
            'excerpt': self.excerpt,
            'cover_image_url': self.cover_image_url,
            'pdf_url': self.pdf_url,
            'author_name': self.author_name,
            'category': self.category,
            'audience': self.audience or 'graduated',
            'is_published': self.is_published,
            'views': self.views or 0,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class QuranContestApplication(db.Model):
    __tablename__ = 'quran_contest_application'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(50), db.ForeignKey('user.id'), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    full_name = db.Column(db.String(200), nullable=False)
    whatsapp = db.Column(db.String(50), nullable=False)
    telephone = db.Column(db.String(50), nullable=False)
    convocation = db.Column(db.String(80), nullable=False)
    participated_before = db.Column(db.String(10), nullable=False)
    previous_section = db.Column(db.String(30), nullable=True)
    won_before = db.Column(db.String(30), nullable=True)
    section_this_year = db.Column(db.String(40), nullable=False)
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        user = User.query.get(self.user_id)
        conv = (self.convocation or '').strip().lower()
        is_alnuur = conv in ('alnuur', 'al-nuur')
        university = faculty = semester = None
        if not is_alnuur and user:
            university = (user.university or '').strip() or None
            faculty = (user.faculty or '').strip() or None
            semester = (
                'Graduated' if user.isGraduated
                else ((user.semester or '').strip() or None)
            )
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': user.username if user else None,
            'member_name': user.name if user else None,
            'email': self.email,
            'full_name': self.full_name,
            'whatsapp': self.whatsapp,
            'telephone': self.telephone,
            'convocation': self.convocation,
            'participated_before': self.participated_before,
            'previous_section': None if self.participated_before == 'Maya' else self.previous_section,
            'won_before': None if self.participated_before == 'Maya' else self.won_before,
            'section_this_year': self.section_this_year,
            'university': university,
            'faculty': faculty,
            'semester': semester,
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class QuranContestYear(db.Model):
    """Per-year Quran contest metadata (winners, venue)."""
    __tablename__ = 'quran_contest_year'

    year = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), default='')
    contest_date = db.Column(db.Date, nullable=True)
    place = db.Column(db.String(200), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    winner_first = db.Column(db.String(200), default='')
    winner_second = db.Column(db.String(200), default='')
    winner_third = db.Column(db.String(200), default='')
    winner_juz10_first = db.Column(db.String(200), default='')
    winner_juz10_second = db.Column(db.String(200), default='')
    winner_juz10_third = db.Column(db.String(200), default='')
    winner_juz20_first = db.Column(db.String(200), default='')
    winner_juz20_second = db.Column(db.String(200), default='')
    winner_juz20_third = db.Column(db.String(200), default='')
    winner_juz30_first = db.Column(db.String(200), default='')
    winner_juz30_second = db.Column(db.String(200), default='')
    winner_juz30_third = db.Column(db.String(200), default='')
    contest_closed = db.Column(db.Boolean, default=False)
    winners_completed_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            'id': self.year,
            'year': self.year,
            'title': self.title or '',
            'contest_date': self.contest_date.isoformat() if self.contest_date else None,
            'place': self.place or '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'winner_first': self.winner_first or '',
            'winner_second': self.winner_second or '',
            'winner_third': self.winner_third or '',
            'winner_juz10_first': self.winner_juz10_first or self.winner_first or '',
            'winner_juz10_second': self.winner_juz10_second or '',
            'winner_juz10_third': self.winner_juz10_third or '',
            'winner_juz20_first': self.winner_juz20_first or self.winner_second or '',
            'winner_juz20_second': self.winner_juz20_second or '',
            'winner_juz20_third': self.winner_juz20_third or '',
            'winner_juz30_first': self.winner_juz30_first or self.winner_third or '',
            'winner_juz30_second': self.winner_juz30_second or '',
            'winner_juz30_third': self.winner_juz30_third or '',
            'contest_closed': bool(self.contest_closed),
            'winners_completed_at': (
                self.winners_completed_at.isoformat() if self.winners_completed_at else None
            ),
            'winners': {
                'juz10': {
                    'first': self.winner_juz10_first or self.winner_first or '',
                    'second': self.winner_juz10_second or '',
                    'third': self.winner_juz10_third or '',
                },
                'juz20': {
                    'first': self.winner_juz20_first or self.winner_second or '',
                    'second': self.winner_juz20_second or '',
                    'third': self.winner_juz20_third or '',
                },
                'juz30': {
                    'first': self.winner_juz30_first or self.winner_third or '',
                    'second': self.winner_juz30_second or '',
                    'third': self.winner_juz30_third or '',
                },
            },
        }


class SummerCourseYear(db.Model):
    """Per-year summer program metadata (courses offered, venue)."""
    __tablename__ = 'summer_course_year'

    year = db.Column(db.Integer, primary_key=True)
    place = db.Column(db.String(200), default='')
    courses_offered = db.Column(db.Text, default='')
    start_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    program_closed = db.Column(db.Boolean, default=False)
    day6_attendance_saved_at = db.Column(db.DateTime, nullable=True)

    def courses_list(self):
        if not self.courses_offered:
            return []
        items = []
        for part in re.split(r'[\n,]+', self.courses_offered):
            p = (part or '').strip()
            if p:
                items.append(p)
        return items

    def to_dict(self):
        return {
            'year': self.year,
            'place': self.place or '',
            'courses_offered': self.courses_offered or '',
            'courses_list': self.courses_list(),
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'program_closed': bool(self.program_closed),
            'day6_attendance_saved_at': (
                self.day6_attendance_saved_at.isoformat() if self.day6_attendance_saved_at else None
            ),
        }


class SummerCourseApplication(db.Model):
    __tablename__ = 'summer_course_application'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(50), db.ForeignKey('user.id'), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    convocation = db.Column(db.String(80), nullable=False)
    faculty = db.Column(db.String(120), nullable=False)
    university = db.Column(db.String(120), nullable=False)
    semester = db.Column(db.String(80), nullable=True)
    attendance_day1 = db.Column(db.Boolean, default=False)
    attendance_day2 = db.Column(db.Boolean, default=False)
    attendance_day3 = db.Column(db.Boolean, default=False)
    attendance_day4 = db.Column(db.Boolean, default=False)
    attendance_day5 = db.Column(db.Boolean, default=False)
    attendance_day6 = db.Column(db.Boolean, default=False)
    # Comma-separated day numbers already emailed for absence (e.g. "1,3")
    absence_notified_days = db.Column(db.String(40), default='')
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def attendance_days(self):
        return [
            bool(self.attendance_day1),
            bool(self.attendance_day2),
            bool(self.attendance_day3),
            bool(self.attendance_day4),
            bool(self.attendance_day5),
            bool(self.attendance_day6),
        ]

    def attendance_count(self):
        return sum(1 for d in self.attendance_days() if d)

    def to_dict(self):
        user = User.query.get(self.user_id)
        sem = (self.semester or '').strip() or ((user.semester or '').strip() if user else '')
        if user and user.isGraduated:
            sem = 'Graduated'
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': user.username if user else None,
            'email': self.email,
            'name': self.name,
            'convocation': self.convocation,
            'faculty': self.faculty,
            'university': self.university,
            'semester': sem or None,
            'attendance': {
                'day1': bool(self.attendance_day1),
                'day2': bool(self.attendance_day2),
                'day3': bool(self.attendance_day3),
                'day4': bool(self.attendance_day4),
                'day5': bool(self.attendance_day5),
                'day6': bool(self.attendance_day6),
            },
            'attendance_count': self.attendance_count(),
            'absence_notified_days': [
                int(x) for x in (self.absence_notified_days or '').split(',')
                if str(x).strip().isdigit()
            ],
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class ApplicationFormSettings(db.Model):
    """Singleton — admin toggles for member registration forms."""
    __tablename__ = 'application_form_settings'

    id = db.Column(db.Integer, primary_key=True, default=1)
    quran_contest_open = db.Column(db.Boolean, default=False)
    summer_course_open = db.Column(db.Boolean, default=False)
    help_open = db.Column(db.Boolean, default=True)
    quran_closed_message = db.Column(
        db.Text,
        nullable=False,
        default='Quran contest registration is closed now. Please check back when registration opens.',
    )
    summer_closed_message = db.Column(
        db.Text,
        nullable=False,
        default='Summer course registration is closed now. Please check back when registration opens.',
    )
    quran_headline = db.Column(
        db.String(200),
        nullable=False,
        default='Quran Contest Registration',
    )
    quran_subtitle = db.Column(
        db.String(200),
        nullable=False,
        default='Naadiga Ardayda Deeqda Waxbarasho HSF',
    )
    quran_deadline_message = db.Column(
        db.Text,
        nullable=False,
        default='Waqtiga uu dhammaanayo ee diiwaangelinta waa 15 January 2026.',
    )
    summer_deadline_message = db.Column(
        db.Text,
        nullable=False,
        default='Waqtiga uu dhammaanayo ee diiwaangelinta waa 30 June 2026.',
    )
    summer_headline = db.Column(
        db.String(200),
        nullable=False,
        default='Summer Course 2025',
    )
    summer_subtitle = db.Column(
        db.String(200),
        nullable=False,
        default='Naadiga Ardayda Deeqda Waxbarasho HSF',
    )
    help_headline = db.Column(
        db.String(200),
        nullable=False,
        default='Cudurdaar Maqnaanshaha',
    )
    help_subtitle = db.Column(
        db.String(200),
        nullable=False,
        default='Naadiga Ardayda Deeqda Waxbarasho HSF',
    )
    help_meeting_time = db.Column(
        db.String(50),
        nullable=False,
        default='04:00pm',
    )
    help_default_meeting_date = db.Column(db.String(20), nullable=True)
    # When True: 10/20 Juz may retry the same section unless they won 1st place (like 30 Juz).
    quran_allow_same_section_retry_below_30 = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'quran_contest_open': bool(self.quran_contest_open),
            'summer_course_open': bool(self.summer_course_open),
            'help_open': bool(self.help_open),
            'quran_closed_message': self.quran_closed_message or '',
            'summer_closed_message': self.summer_closed_message or '',
            'quran_headline': self.quran_headline or 'Quran Contest Registration',
            'quran_subtitle': self.quran_subtitle or 'Naadiga Ardayda Deeqda Waxbarasho HSF',
            'quran_deadline_message': self.quran_deadline_message or '',
            'summer_headline': self.summer_headline or 'Summer Course 2025',
            'summer_subtitle': self.summer_subtitle or 'Naadiga Ardayda Deeqda Waxbarasho HSF',
            'summer_deadline_message': self.summer_deadline_message or '',
            'help_headline': self.help_headline or 'Cudurdaar Maqnaanshaha',
            'help_subtitle': self.help_subtitle or 'Naadiga Ardayda Deeqda Waxbarasho HSF',
            'help_meeting_time': self.help_meeting_time or '04:00pm',
            'help_default_meeting_date': self.help_default_meeting_date or '',
            'quran_allow_same_section_retry_below_30': bool(
                getattr(self, 'quran_allow_same_section_retry_below_30', False)
            ),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class MemberHelpRequest(db.Model):
    __tablename__ = 'member_help_request'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(50), db.ForeignKey('user.id'), nullable=False)
    subject = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text, nullable=False)
    is_read = db.Column(db.Boolean, default=False)
    response_status = db.Column(db.String(20), nullable=False, default='pending')
    meeting_date = db.Column(db.String(20), nullable=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey('meeting.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        user = User.query.get(self.user_id)
        meeting = Meeting.query.get(self.meeting_id) if self.meeting_id else None
        if not meeting and self.meeting_date:
            meeting = Meeting.query.filter_by(date=str(self.meeting_date)[:10]).order_by(Meeting.id.desc()).first()
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': user.username if user else None,
            'member_name': user.name if user else None,
            'member_email': user.email if user else None,
            'subject': self.subject,
            'message': self.message,
            'is_read': self.is_read,
            'response_status': self.response_status or 'pending',
            'meeting_date': self.meeting_date or (meeting.date if meeting else ''),
            'meeting_id': self.meeting_id or (meeting.id if meeting else None),
            'meeting_topic': meeting.topic if meeting else '',
            'meeting_place': meeting.place if meeting else '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

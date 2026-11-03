"""Default image slide paths per content category (5 slides each)."""

_IMG = 'portal/public/assets/default-images/'


def _paths(*names):
    return [f'{_IMG}{n}' for n in names]


CONTENT_DEFAULT_SLIDES = {
    1: _paths(
        'Impact Activities one.jpg', 'Impact Activities one 1.jpg', 'Impact Activities one 2.jpg',
        'Impact Activities one 3.jpg', 'Impact Activities one 4.jpg',
    ),
    2: _paths(
        'Impact Activities two.jpg', 'Impact Activities two 1.jpg', 'Impact Activities two 2.jpg',
        'Impact Activities two 3.jpg', 'Impact Activities two 4.jpg',
    ),
    3: _paths(
        'Impact Activities three.jpg', 'Impact Activities three 1.jpg', 'Impact Activities three 2.jpg',
        'Impact Activities three 3.jpg', 'Impact Activities three 4.jpg',
    ),
    4: _paths(
        'Impact Activities four.jpg', 'Impact Activities four 1.jpg', 'Impact Activities four 2.jpg',
        'Impact Activities four 3.jpg', 'Impact Activities four 4.jpg',
    ),
    5: _paths(
        'Impact Activities five.jpg', 'Impact Activities five 1.jpg', 'Impact Activities five 2.jpg',
        'Impact Activities five 3.jpg', 'Impact Activities five 4.jpg',
    ),
    6: _paths('hero.jpg', 'hero1.jpg', 'hero2.jpg', 'hero3.jpg', 'hero4.jpg'),
    7: _paths(
        'gallery slot one.jpg', 'gallery slot one 1.jpg', 'gallery slot one 2.jpg',
        'gallery slot one 3.jpg', 'gallery slot one 4.jpg',
    ),
    8: _paths(
        'gallery slot two.jpg', 'gallery slot two 1.jpg', 'gallery slot two 2.jpg',
        'gallery slot two 3.JPG', 'gallery slot two 4.jpg',
    ),
    9: _paths(
        'gallery slot three.jpg', 'gallery slot three 1.jpg', 'gallery slot three 2.jpg',
        'gallery slot three 3.jpg', 'gallery slot three 4.jpg',
    ),
    11: _paths(
        'gallery slot four.jpg', 'gallery slot four 1.jpg', 'gallery slot four 2.jpg',
        'gallery slot four 3.jpg', 'gallery slot four 4.jpg',
    ),
    14: _paths(
        'sharing joy on eid.jpg', 'sharing joy on eid 1.jpg', 'sharing joy on eid 2.jpg',
        'sharing joy on eid 3.jpg', 'sharing joy on eid 4.jpg',
    ),
    15: _paths(
        'Feeding Hearts in Ramadan.jpg', 'Feeding Hearts in Ramadan 1.jpg', 'Feeding Hearts in Ramadan 2.jpg',
        'Feeding Hearts in Ramadan 3.jpg', 'Feeding Hearts in Ramadan 4.jpg',
    ),
    16: _paths(
        'Monthly Meetings().jpg', 'Monthly Meetings() 1.jpg', 'Monthly Meetings() 2.jpg',
        'Monthly Meetings() 3.jpg', 'Monthly Meetings() 4.jpg',
    ),
    17: _paths(
        'summer courses.jpg', 'summer courses 1.jpg', 'summer courses 2.jpg',
        'summer courses 3.jpg', 'summer courses 4.jpg',
    ),
}

# Admin groups (3 main sections on homepage)
ADMIN_GROUP_MOMENTS = [7, 8, 9, 11]
ADMIN_GROUP_IMPACT = [1, 2, 3, 4, 5]
ADMIN_GROUP_SITE = [6, 14, 15, 16, 17]

CONTENT_CATEGORY_IDS = sorted(CONTENT_DEFAULT_SLIDES.keys())
HOMEPAGE_CONTENT_IDS = CONTENT_CATEGORY_IDS

CONTENT_DEFAULT_TEXT = {
    6: {
        'title': 'Giving Back with Purpose',
        'description': 'Scholarship students united to serve, inspire, and transform our community.',
    },
    1: {
        'title': '🏖️ Beach Cleaning',
        'description': 'Volunteers restoring Liido Beach, removing plastic waste.',
        'badge_text': 'Feb 2025',
    },
    2: {
        'title': '🧥 Eid Clothing',
        'description': 'New clothes for underprivileged and orphan children.',
        'badge_text': 'Apr 2025',
    },
    3: {
        'title': '🌙 Ramadan Program',
        'description': 'Hot meals for families across Mogadishu.',
        'badge_text': 'Mar 2025',
    },
    4: {
        'title': '📚 Monthly Meetings',
        'description': 'We empower young minds monthly workshops , we take actions monthly',
        'badge_text': 'Monthly',
    },
    5: {
        'title': '☀️ Summer Courses',
        'description': 'hormuud salaam foundation organize workshops to the students.',
        'badge_text': 'Jul 2025',
    },
    7: {'caption': 'Liido Beach Action'},
    8: {'caption': 'Eid Giving'},
    9: {'caption': 'Ramadan Unity'},
    11: {'caption': 'Summer Courses'},
    14: {
        'title': 'Sharing Joy on Eid',
        'description': (
            'We provide new clothing for underprivileged children, ensuring every child '
            'celebrates Eid with dignity and happiness. Over 400 children received gifts last year.'
        ),
    },
    15: {
        'title': 'Feeding Hearts in Ramadan',
        'description': (
            'During the holy month, we organize community iftars and distribute meals to '
            'hundreds of families. A moment of unity and compassion.'
        ),
    },
    16: {
        'title': 'Monthly Meetings',
        'description': (
            'We empower young minds through leadership workshops and mentorship programs. '
            'Knowledge shared is knowledge multiplied.'
        ),
    },
    17: {
        'title': 'Summer Courses',
        'description': (
            'We get free summer courses organized by hormuud salaam foundation for students, '
            'helping them prepare for a brighter future , these programs offer students essential '
            'skills and professional mentorship at no cost.'
        ),
    },
}

# Per-slide text defaults (5 each); falls back to CONTENT_DEFAULT_TEXT when not listed
CONTENT_DEFAULT_SLIDE_TEXT = {
    cat_id: [dict(CONTENT_DEFAULT_TEXT.get(cat_id, {})) for _ in range(5)]
    for cat_id in CONTENT_CATEGORY_IDS
}

# Fullscreen homepage videos (place default .mp4 files in default-images/)
HOMEPAGE_VIDEO_COUNT = 3
DEFAULT_HOMEPAGE_VIDEO_PATHS = [
    f'{_IMG}hsf-impact-video-1.mp4',
    f'{_IMG}hsf-impact-video-2.mp4',
    f'{_IMG}hsf-impact-video-3.mp4',
]
DEFAULT_HOMEPAGE_VIDEO_TEXTS = [
    {
        'title': 'Our Impact in Motion',
        'description': (
            'Watch how Hormuud Salaam Foundation scholars turn opportunity into action — '
            'from beach cleanups to community programs across Mogadishu.'
        ),
    },
    {
        'title': 'Service That Inspires',
        'description': (
            'Every month our members lead programs that strengthen families, '
            'protect the environment, and uplift the community.'
        ),
    },
    {
        'title': 'Leaders in Action',
        'description': (
            'From Ramadan iftars to summer courses — see the moments '
            'that define who we are as HSF scholars.'
        ),
    },
]
# Legacy single-video default (migrated to slot 1 if present)
DEFAULT_HOMEPAGE_VIDEO_PATH = DEFAULT_HOMEPAGE_VIDEO_PATHS[0]
DEFAULT_HOMEPAGE_VIDEO_TEXT = DEFAULT_HOMEPAGE_VIDEO_TEXTS[0]

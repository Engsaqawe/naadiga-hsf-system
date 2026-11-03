import os
from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

from org_constants import CLUB_OFFICIAL_NAME as _CLUB_NAME, CLUB_OFFICIAL_EMAIL as _CLUB_EMAIL

class Config:
    # Set DATABASE_URL in .env for MySQL, e.g.:
    # DATABASE_URL=mysql+pymysql://user:password@localhost/hsf_system
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Shared hosting (Namecheap/Passenger): MySQL drops idle SSL connections.
    # pre_ping recycles dead connections; recycle before typical wait_timeout.
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 280,
        'pool_size': 5,
        'max_overflow': 10,
    }
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'super-secret-hsf-key-2026'
    
    # Mail Configuration (Environment Driven)
    MAIL_SERVER = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.environ.get('MAIL_PORT', 587))
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
    MAIL_USE_SSL = os.environ.get('MAIL_USE_SSL', 'False').lower() == 'true'
    CLUB_OFFICIAL_NAME = os.environ.get('CLUB_OFFICIAL_NAME', _CLUB_NAME)
    CLUB_OFFICIAL_EMAIL = os.environ.get('CLUB_OFFICIAL_EMAIL', _CLUB_EMAIL)
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER') or os.environ.get('MAIL_USERNAME')
    
    UPLOAD_FOLDER = os.path.join(basedir, 'uploads')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB limit

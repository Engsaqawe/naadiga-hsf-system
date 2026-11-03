import sys
import os

# Application root = this file's directory (backend/)
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

os.chdir(APP_ROOT)

# Load .env from backend/ when Passenger starts the app
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(APP_ROOT, '.env'))
except Exception:
    pass

# Passenger expects the Flask app as `application`
from app import app as application, initialize_database

initialize_database()

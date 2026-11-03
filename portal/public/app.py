from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

# Database Configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- Models ---
class ContentCategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    image_base64 = db.Column(db.Text, nullable=True)

class Team(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(200))
    member_count = db.Column(db.Integer, default=0)
    category = db.Column(db.String(50))
    image_url = db.Column(db.String(200))

class SiteStats(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    today_visitors = db.Column(db.Integer, default=0)
    total_visitors = db.Column(db.Integer, default=1250)

class AdminProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    foundation_name = db.Column(db.String(100), default="H Team Club")
    admin_email = db.Column(db.String(100), default="admin@hsf.so")
    password = db.Column(db.String(100), default="password123")
    theme = db.Column(db.String(20), default="light")

# --- Initial Data ---
def init_db():
    with app.app_context():
        db.create_all()
        # Ensure all 12 Categories exist
        for i in range(1, 13):
            cat = ContentCategory.query.get(i)
            if not cat:
                db.session.add(ContentCategory(id=i, name=f"Category {i}"))
        
        # Initial Teams if none exist
        if not Team.query.first():
            db.session.add(Team(name="Beach Cleaning Squad", category="Environmental", member_count=24, image_url="https://images.pexels.com/photos/4101553/pexels-photo-4101553.jpeg?auto=compress&cs=tinysrgb&w=600"))
            db.session.add(Team(name="Ramadan Iftar Heroes", category="Charity", member_count=42, image_url="https://images.pexels.com/photos/6994982/pexels-photo-6994982.jpeg?auto=compress&cs=tinysrgb&w=600"))
            db.session.add(Team(name="Summer Mentors", category="Education", member_count=18, image_url="https://images.pexels.com/photos/5212345/pexels-photo-5212345.jpeg?auto=compress&cs=tinysrgb&w=600"))
            db.session.commit()
            
        db.session.commit()
    return True

# --- Bootstrap ---
with app.app_context():
    init_db()

# --- Routes ---
@app.route('/api/content/<int:cat_id>', methods=['GET'])
def get_content(cat_id):
    content = ContentCategory.query.get_or_404(cat_id)
    return jsonify({"id": content.id, "image": content.image_base64})

@app.route('/api/content/<int:cat_id>', methods=['POST'])
def update_content(cat_id):
    content = ContentCategory.query.get_or_404(cat_id)
    data = request.json
    content.image_base64 = data.get('image')
    db.session.commit()
    return jsonify({"success": True})

@app.route('/api/content/<int:cat_id>', methods=['DELETE'])
def delete_content(cat_id):
    content = ContentCategory.query.get_or_404(cat_id)
    content.image_base64 = None
    db.session.commit()
    return jsonify({"success": True})

@app.route('/api/teams', methods=['GET'])
def get_teams():
    teams = Team.query.all()
    return jsonify([{"id": t.id, "name": t.name, "category": t.category, "members": t.member_count, "image": t.image_url} for t in teams])

@app.route('/api/stats', methods=['GET'])
def get_stats():
    stats = SiteStats.query.first()
    gallery_count = ContentCategory.query.filter(ContentCategory.image_base64 != None).count()
    return jsonify({
        "visitors": stats.today_visitors if stats else 0,
        "total_visitors": stats.total_visitors if stats else 1250,
        "gallery_images": gallery_count,
        "new_members": 12, # Still simulated
        "avg_session": "4m 32s"
    })

@app.route('/api/track-visitor', methods=['POST'])
def track_visitor():
    stats = SiteStats.query.first()
    if stats:
        stats.today_visitors += 1
        stats.total_visitors += 1
        db.session.commit()
    return jsonify({"success": True})

@app.route('/api/admin/settings', methods=['GET', 'POST'])
def admin_settings():
    admin = AdminProfile.query.first()
    if not admin:
        admin = AdminProfile()
        db.session.add(admin)
        db.session.commit()

    if request.method == 'POST':
        data = request.json
        if not data: return jsonify({"error": "No data"}), 400
        
        if 'foundation_name' in data: admin.foundation_name = data['foundation_name']
        if 'admin_email' in data: admin.admin_email = data['admin_email']
        if 'password' in data: admin.password = data['password']
        if 'theme' in data: admin.theme = data['theme']
        db.session.commit()
        return jsonify({"success": True})
    
    return jsonify({
        "foundation_name": admin.foundation_name,
        "admin_email": admin.admin_email,
        "theme": admin.theme
    })

# Serve Static Files (Development)
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_file(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    app.run(debug=True, port=5000)

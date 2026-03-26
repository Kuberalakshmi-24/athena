from flask import Flask, request, make_response
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from .models import db
from .api.routes import api
import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

# Load .env.local if it exists (for local development), otherwise load .env (for production)
backend_dir = Path(__file__).parent.parent
env_local_path = backend_dir / '.env.local'
env_path = backend_dir / '.env'

if env_local_path.exists():
    load_dotenv(env_local_path)
else:
    load_dotenv(env_path)


def _normalize_database_url(raw_url: str) -> str:
    if not raw_url:
        return 'sqlite:///athena.db'
    # Render and some providers may still emit postgres:// URLs.
    if raw_url.startswith('postgres://'):
        return raw_url.replace('postgres://', 'postgresql://', 1)
    return raw_url

app = Flask(__name__)

# Root route for health checks
@app.route("/")
def home():
    return {"status": "Backend is running 🚀"}

CORS(
    app,
    supports_credentials=True,
    resources={r"/api/*": {
        "origins": [
            os.getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
            "http://127.0.0.1:3000"
        ],
        "allow_headers": ["Content-Type", "Authorization"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    }}
)

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = _normalize_database_url(os.getenv('DATABASE_URL', 'sqlite:///athena.db'))
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
jwt_secret = os.getenv('JWT_SECRET_KEY', '') or os.getenv('JWT_SECRET', '')
if len(jwt_secret) < 32:
    jwt_secret = 'athena-development-jwt-secret-key-min-32-bytes-please-change'
app.config['JWT_SECRET_KEY'] = jwt_secret
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies']
app.config['JWT_COOKIE_SECURE'] = os.getenv('JWT_COOKIE_SECURE', 'false').lower() == 'true'
app.config['JWT_COOKIE_SAMESITE'] = os.getenv('JWT_COOKIE_SAMESITE', 'Lax')
app.config['JWT_COOKIE_CSRF_PROTECT'] = False
app.config['JWT_REFRESH_COOKIE_PATH'] = '/'
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(minutes=int(os.getenv('JWT_ACCESS_MINUTES', '30')))
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=int(os.getenv('JWT_REFRESH_DAYS', '30')))

db.init_app(app)
jwt = JWTManager(app)

with app.app_context():
    try:
        db.create_all()
        # Incremental migration: add selected_subject column if it doesn't exist yet
        try:
            from sqlalchemy import text
            with db.engine.connect() as conn:
                conn.execute(text('ALTER TABLE user ADD COLUMN selected_subject VARCHAR(100)'))
                conn.commit()
        except Exception:
            pass  # Column already exists
    except Exception as db_error:
        print(f"[WARNING] Could not initialize database: {db_error}")
        print("[INFO] Using fallback mode - database operations will be limited")

app.register_blueprint(api, url_prefix='/api')

# Pre-initialize RAG service after app startup to avoid timeout on first request
@app.after_request
def postprocess_request(response):
    """Pre-warm RAG service in background after first request completes."""
    if not hasattr(app, '_rag_service_initialized'):
        try:
            # Import here to avoid circular imports
            from .api.routes import get_rag_service
            get_rag_service()  # Force initialization
            app._rag_service_initialized = True
            print("[INFO] RAG service pre-initialized successfully")
        except Exception as e:
            print(f"[WARN] RAG service pre-initialization failed: {e}")
            app._rag_service_initialized = False
    return response

@app.before_request
def handle_options_preflight():
    if request.method == 'OPTIONS':
        resp = make_response('', 200)
        resp.headers['Access-Control-Allow-Origin'] = request.headers.get('Origin', 'http://localhost:3000')
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        return resp

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', '5000')))
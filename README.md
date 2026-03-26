# Athena - AI-Powered Tutoring System

**Athena** is an intelligent, adaptive tutoring platform that leverages Retrieval-Augmented Generation (RAG) to provide personalized learning experiences. It adapts to individual learning levels, provides interactive quizzes, visual diagrams, and tracks progress across multiple subjects.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Usage Guide](#usage-guide)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Troubleshooting](#troubleshooting)
- [Future Enhancements](#future-enhancements)

---

## 🎯 Overview

Athena is a comprehensive educational platform that combines artificial intelligence with proven pedagogical principles. The system uses advanced natural language processing to understand student questions, retrieve relevant information from uploaded course materials, and generate detailed explanations with examples, visualizations, and assessments.

### What Makes Athena Unique?

- **Curriculum-Driven Learning**: Systematic journey from foundational overviews to deep-dive topics.
- **Llama-3.1-8B Engine**: Optimized for high-speed, structured teaching with superior logic.
- **Learning Roadmaps**: Interactive visual guides showing your progress and next steps.
- **The Big Picture**: Every topic starts with contextual positioning within the subject.
- **Adaptive Learning**: Automatically adjusts complexity based on real-time quiz performance.
- **Visual Concept Maps**: Automated Mermaid diagrams with enhanced stable UI layout.
- **Progress Tracking**: Comprehensive dashboard with analytics and insights.

---

## ✨ Key Features

### 🎓 Curriculum-Driven Tutoring
- **Foundation First**: Explains *why* before *how*, building core conceptual strength.
- **Interactive Roadmaps**: Displays previous topics, current position, and future steps.
- **Pedagogical Personas**: Tone and depth adapt to Student Level (Beginner/Intermediate/Advanced).

### 📊 Visual Learning & Stability
- **Stable UI Containers**: Fixed-height placeholders prevent layout shifts during graph generation.
- **Conceptual Bridges**: Visual diagrams link multiple topics into a single mental model.
- **Pulse Indicators**: Real-time feedback for a premium feel.

### 🧩 Diagnostic Assessments
- **Diagnostic Quizzes**: 3-question assessments that target weak topics and mastery gaps.
- **Recovery Logic**: Frontend can gracefully handle and parse partial quiz responses.

### 📈 Analytics Dashboard
- Learning level progression
- Topic proficiency breakdown
- Quiz accuracy metrics
- Strong and weak topic identification
- Recent quiz history
- Chat conversation history

### 💬 Conversation Management
- Per-user conversation memory
- Chat history persistence
- Subject-specific context retention
- Seamless topic transitions

---

## 🛠 Technology Stack

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.11+ | Backend runtime |
| Flask | 2.3.2 | Web framework |
| SQLAlchemy | 2.0.19 | ORM for database operations |
| Flask-JWT-Extended | 4.5.2 | Authentication & authorization |
| LangChain | 0.1.0+ | RAG orchestration framework |
| Groq | Llama-3.1-8B-Instant | High-speed LLM engine |
| ChromaDB | 0.4.0+ | Vector database for embeddings |
| HuggingFace | Latest | Embeddings (all-MiniLM-L6-v2) |
| PyPDF | 3.0+ | PDF document parsing |
| python-dotenv | 1.0.0 | Environment variable management |
| tqdm | 4.66+ | Progress bar for ingestion |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 17.0.2 | UI framework |
| TypeScript | 4.9+ | Type-safe JavaScript |
| React Router | 6.0.0 | Client-side routing |
| Framer Motion | 6.0.0 | Animations and transitions |
| React Markdown | 8.0.7 | Markdown rendering |
| Remark GFM | 3.0.1 | GitHub Flavored Markdown |
| Mermaid | 10.6.1 | Diagram rendering |
| Lucide React | 0.263.1 | Icon library |
| Axios | 0.21.1 | HTTP client |

### Database
- **SQLite** (development) - File-based relational database
- Easily upgradable to PostgreSQL/MySQL for production

### AI/ML Components
- **LLM**: Groq's llama-3.3-70b-versatile model
- **Embeddings**: HuggingFace all-MiniLM-L6-v2
- **Retrieval**: MMR (Maximum Marginal Relevance) search
- **Vector Store**: ChromaDB with persistent storage
- **Chunking**: RecursiveCharacterTextSplitter (800 chars, 150 overlap)

---

## 🏗 Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │   Login/Auth  │  │     Chat     │  │    Dashboard     │ │
│  └───────────────┘  └──────────────┘  └──────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/REST API
┌──────────────────────────▼──────────────────────────────────┐
│                      Flask Backend                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Auth Routes  │  │ Query Routes │  │ Upload Routes    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                  │                    │            │
│  ┌──────▼──────────────────▼────────────────────▼─────────┐ │
│  │              RAG Service Layer                          │ │
│  │  ┌────────────────┐  ┌───────────────────────────┐     │ │
│  │  │ Document Loader│  │  Conversation Chain       │     │ │
│  │  └────────┬───────┘  └───────────┬───────────────┘     │ │
│  └───────────┼──────────────────────┼──────────────────────┘ │
│              │                      │                        │
│  ┌───────────▼──────────┐  ┌────────▼─────────────────┐    │
│  │   Vector Database    │  │    Groq LLM API          │    │
│  │   (ChromaDB)         │  │  (llama-3.3-70b)         │    │
│  └──────────────────────┘  └──────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          SQLite Database                              │  │
│  │  • Users  • QuizHistory  • UserAbility  • ChatMessage│  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Document Upload**: PDFs/TXT → PyPDF Parser → Text Splitter → Embeddings → ChromaDB
2. **Query Processing**: User Question → RAG Service → Vector Search → Context Retrieval → LLM → Response Generation
3. **Quiz Generation**: LLM Response → Quiz Parser → Frontend Display → User Answer → Database Storage
4. **Learning Adaptation**: Quiz Results → Performance Calculation → Level Update → Next Query Context

---

## 📁 Project Structure

```
rag-tutoring-system/
│
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes.py              # API endpoints
│   │   ├── services/
│   │   │   ├── generator.py           # Quiz generation
│   │   │   ├── rag_service.py         # Core RAG logic
│   │   │   └── retriever.py           # Document retrieval
│   │   ├── custom_types/
│   │   │   └── __init__.py
│   │   ├── models.py                  # Database models
│   │   └── app.py                     # Flask application entry
│   ├── data/
│   │   └── [Subject Folders]/         # Course materials (PDF, TXT)
│   ├── chroma_db/                     # Vector database storage
│   ├── instance/                      # SQLite database
│   ├── requirements.txt               # Python dependencies
│   ├── .env                           # Environment variables
│   ├── Dockerfile                     # Docker configuration
│   └── README.md
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat.tsx               # Main chat interface
│   │   │   ├── Dashboard.tsx          # Analytics dashboard
│   │   │   ├── Login.tsx              # Login page
│   │   │   └── Register.tsx           # Registration page
│   │   ├── context/
│   │   │   └── AuthContext.tsx        # Authentication state
│   │   ├── types/
│   │   │   └── index.ts               # TypeScript types
│   │   ├── App.tsx                    # Root component
│   │   ├── index.tsx                  # Entry point
│   │   └── index.css                  # Global styles
│   ├── public/
│   │   └── index.html
│   ├── package.json                   # Node dependencies
│   ├── tsconfig.json                  # TypeScript config
│   └── README.md
│
└── README.md                          # This file
```

---

## 📋 Prerequisites

Before installing Athena, ensure you have the following:

### Required Software
- **Python**: Version 3.11 or higher
- **Node.js**: Version 16.x or higher
- **npm**: Version 8.x or higher (comes with Node.js)
- **Git**: For version control (optional)

### Required API Keys
- **Groq API Key**: Free tier available at [groq.com](https://groq.com)
  - Sign up for an account
  - Generate an API key from the dashboard
  - Free tier includes generous token limits

### System Requirements
- **RAM**: Minimum 4GB (8GB recommended)
- **Storage**: 2GB free space
- **OS**: Windows 10/11, macOS 10.15+, or Linux (Ubuntu 20.04+)

---

## 🚀 Installation

### Step 1: Clone or Download the Project

```bash
cd C:\Users\kumar\Desktop\Athena
# Or download and extract the ZIP file
```

### Step 2: Backend Setup

#### 2.1 Navigate to Backend Directory
```bash
cd rag-tutoring-system\backend
```

#### 2.2 Create Virtual Environment
```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

#### 2.3 Install Python Dependencies
```bash
pip install -r requirements.txt
```

**Key Dependencies Installed:**
- Flask and extensions (JWT, CORS, SQLAlchemy)
- LangChain ecosystem (classic, groq, chroma, huggingface)
- ChromaDB for vector storage
- PyPDF for document parsing
- tqdm for progress tracking

#### 2.4 Create Environment Configuration
Create a `.env` file in the `backend` directory:

```env
# Groq API Configuration
GROQ_API_KEY=your_groq_api_key_here

# Database Configuration
DATABASE_URL=sqlite:///instance/athena.db

# JWT Secret Key (generate a secure random string)
JWT_SECRET_KEY=your_super_secret_jwt_key_here

# Optional: Flask Configuration
FLASK_ENV=development
FLASK_DEBUG=True
```

**Generate a secure JWT secret:**
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Step 3: Frontend Setup

#### 3.1 Navigate to Frontend Directory
```bash
cd ..\frontend
# Or: cd C:\Users\kumar\Desktop\Athena\rag-tutoring-system\frontend
```

#### 3.2 Install Node Dependencies
```bash
npm install
```

**Key Dependencies Installed:**
- React and React DOM
- TypeScript
- React Router for navigation
- Framer Motion for animations
- React Markdown for formatted text
- Mermaid for diagram rendering
- Lucide React for icons

**Note:** This may take 2-5 minutes depending on your internet connection.

### Step 4: Prepare Course Materials

#### 4.1 Create Subject Folders
```bash
cd ..\backend\data
mkdir "Data Science"
mkdir "Machine Learning"
mkdir "Web Development"
```

#### 4.2 Add Course Materials
Place your course materials (PDF or TXT files) in the respective subject folders:

```
backend/data/
├── Data Science/
│   ├── introduction_to_data_science.pdf
│   ├── statistics_fundamentals.pdf
│   └── data_visualization.txt
├── Machine Learning/
│   └── ml_algorithms.pdf
└── Web Development/
    └── html_css_basics.pdf
```

**Supported Formats:**
- PDF files (.pdf)
- Text files (.txt)

**Automatic Ingestion:**
- The system automatically processes and indexes all documents on first startup.
- No manual ingestion required.
- New materials uploaded via the UI are indexed instantly.

---

## ⚙️ Configuration

### Backend Configuration Options

**Environment Variables (`backend/.env`):**

```env
# Required
GROQ_API_KEY=gsk_...                    # Your Groq API key
JWT_SECRET_KEY=abc123...                # Secure random string

# Optional
DATABASE_URL=sqlite:///instance/athena.db  # Database path
FLASK_ENV=development                   # Environment mode
FLASK_DEBUG=True                        # Debug mode
PORT=5000                               # Backend port (default: 5000)
```

### Frontend Configuration

**API Endpoint (`frontend/src/components`):**

The frontend is configured to connect to `http://localhost:5000` by default. If you change the backend port, update the fetch URLs in:
- `Chat.tsx`
- `Dashboard.tsx`
- `Login.tsx`
- `Register.tsx`

### LLM Configuration

**Model Settings (`backend/src/services/rag_service.py`):**

```python
ChatGroq(
    groq_api_key=self.api_key,
    model_name="llama-3.3-70b-versatile",  # Model choice
    temperature=0.2                         # Creativity (0-1)
)
```

**Vector Search Settings:**

```python
search_type="mmr",                     # Maximum Marginal Relevance
search_kwargs={
    "k": 6,                            # Top 6 results
    "fetch_k": 20                      # Fetch 20, return best 6
}
```

**Document Chunking:**

```python
RecursiveCharacterTextSplitter(
    chunk_size=800,                    # Characters per chunk
    chunk_overlap=150                  # Overlap for context
)
```

---

## 🏃 Running the Application

### Method 1: Manual Startup (Recommended for Development)

#### Terminal 1: Start Backend
```bash
cd C:\Users\kumar\Desktop\Athena\rag-tutoring-system\backend
venv\Scripts\activate
python src/app.py
```

**Expected Output:**
```
✅ All subjects ingested and indexed.
 * Serving Flask app 'app'
 * Debug mode: on
WARNING: This is a development server.
 * Running on http://127.0.0.1:5000
```

#### Terminal 2: Start Frontend
```bash
cd C:\Users\kumar\Desktop\Athena\rag-tutoring-system\frontend
npm start
```

**Expected Output:**
```
Compiled successfully!

You can now view rag-tutoring-system-frontend in the browser.

  Local:            http://localhost:3000
  On Your Network:  http://192.168.x.x:3000
```

**The application will automatically open in your browser at `http://localhost:3000`**

### Method 2: Docker (Production)

#### Build Docker Image
```bash
cd backend
docker build -t athena-backend .
```

#### Run Container
```bash
docker run -p 5000:5000 --env-file .env athena-backend
```

---

## 📖 Usage Guide

### 1. User Registration

1. Navigate to `http://localhost:3000`
2. Click **"Register"**
3. Fill in:
   - Username (unique)
   - Email address
   - Password
4. Click **"Sign Up"**

### 2. Login

1. Enter your credentials
2. Check **"Remember me"** (optional)
3. Click **"Login"**

### 3. Select a Subject

1. In the sidebar, under **"CHOOSE SUBJECT"**, click on a subject (e.g., "Data Science")
2. Wait for confirmation: *"Subject 'Data Science' loaded!"*
3. The status indicator will show the selected subject

### 4. Ask Questions

1. Type your question in the input box
2. Press **Enter** or click **"Send"**
3. Wait for the AI to respond with:
   - Detailed explanation
   - Real-world examples
   - Visual diagram (Mermaid or table)
   - 3-question quiz

### 5. Answer Quizzes

1. Read the quiz question
2. Click on your answer (A, B, or C)
3. Receive immediate feedback
4. Continue to next question
5. View results after completing all questions

### 6. View Dashboard

1. Click **"My Dashboard"** in the sidebar
2. Review:
   - Current learning level
   - Strong and weak topics
   - Topic proficiency bars
   - Quiz performance metrics
   - Recent quiz history
   - Chat conversation history

### 7. Upload Additional Materials

1. Under **"ADD MATERIAL"**, click **"Upload File"**
2. Select a PDF or TXT file
3. Wait for processing confirmation
4. New content is now searchable

### 8. Off-Topic Questions

If you ask something unrelated to the subject:
- AI provides a brief answer
- Gently redirects to subject topics
- Suggests relevant questions
- **No quiz generated** for off-topic queries

---

## 🔌 API Documentation

### Authentication Endpoints

#### POST `/api/register`
Register a new user.

**Request Body:**
```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "message": "User registered successfully"
}
```

#### POST `/api/login`
Authenticate and receive JWT token.

**Request Body:**
```json
{
  "username": "john_doe",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user": {
    "username": "john_doe",
    "level": "Beginner"
  }
}
```

### Subject Management

#### GET `/api/subjects`
Get list of available subjects.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "subjects": ["Data Science", "Machine Learning", "Web Development"]
}
```

#### POST `/api/load_subject`
Load a specific subject.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "subject": "Data Science"
}
```

**Response:**
```json
{
  "message": "Subject Data Science ready. Using existing index."
}
```

### Query & Chat

#### POST `/api/query`
Ask a question and get AI response.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "query": "What is machine learning?",
  "subject": "Data Science"
}
```

**Response:**
```json
{
  "response": "Topic: Machine Learning\n\n**Explanation:**\n- Machine learning is...",
  "topic": "Machine Learning",
  "level": "Beginner"
}
```

#### GET `/api/chat_history?limit=50`
Retrieve chat history.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "history": [
    {
      "role": "user",
      "content": "What is machine learning?",
      "timestamp": "2026-02-11T10:30:00"
    },
    {
      "role": "ai",
      "content": "Machine learning is...",
      "timestamp": "2026-02-11T10:30:05"
    }
  ]
}
```

### Quiz Management

#### POST `/api/submit_quiz`
Submit quiz answers and get results.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "topic": "Machine Learning",
  "is_correct": true,
  "subject": "Data Science"
}
```

**Response:**
```json
{
  "message": "Quiz submitted",
  "new_level": "Intermediate"
}
```

### Dashboard

#### GET `/api/dashboard`
Get user analytics and progress.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "user": {
    "username": "john_doe",
    "level": "Intermediate"
  },
  "stats": [
    {
      "topic": "Machine Learning",
      "score": 8,
      "total": 10,
      "proficiency": 80
    }
  ],
  "strong_topics": ["Neural Networks"],
  "weak_topics": ["Statistics"],
  "quiz": {
    "total": 50,
    "correct": 38,
    "accuracy": 76
  },
  "recent_quizzes": [...],
  "recent_chats": [...]
}
```

### File Upload

#### POST `/api/upload`
Upload course materials.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Form Data:**
```
file: <PDF or TXT file>
```

**Response:**
```json
{
  "message": "Document loaded and indexed successfully"
}
```

---

## 🗄️ Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(80) UNIQUE NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password VARCHAR(200) NOT NULL,
    learning_level VARCHAR(20) DEFAULT 'Beginner',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### QuizHistory Table
```sql
CREATE TABLE quiz_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject VARCHAR(100),
    topic VARCHAR(100),
    is_correct BOOLEAN NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### UserAbility Table
```sql
CREATE TABLE user_ability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    topic VARCHAR(100) NOT NULL,
    score INTEGER DEFAULT 0,
    total_attempts INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, topic)
);
```

### ChatMessage Table
```sql
CREATE TABLE chat_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role VARCHAR(10) NOT NULL,   -- 'user' or 'ai'
    content TEXT NOT NULL,
    subject VARCHAR(100),
    topic VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 🐛 Troubleshooting

### Common Issues and Solutions

#### 1. Backend Won't Start

**Error:** `ModuleNotFoundError: No module named 'flask'`

**Solution:**
```bash
cd backend
venv\Scripts\activate
pip install -r requirements.txt
```

#### 2. Groq API Key Error

**Error:** `GROQ_API_KEY not found in environment variables`

**Solution:**
- Create `backend/.env` file
- Add: `GROQ_API_KEY=gsk_your_actual_key_here`
- Restart backend

#### 3. Frontend Compilation Error

**Error:** `Module not found: Error: Can't resolve 'mermaid'`

**Solution:**
```bash
cd frontend
npm install
npm start
```

#### 4. Database Migration Error

**Error:** `no such table: chat_message`

**Solution:**
- Delete `backend/instance/athena.db`
- Restart backend (tables will be recreated)

#### 5. ChromaDB Persistence Error

**Error:** `AttributeError: 'Chroma' object has no attribute 'persist'`

**Solution:**
- Already handled in code with `_persist_if_supported()`
- Update langchain-chroma: `pip install --upgrade langchain-chroma`

#### 6. CORS Error in Browser

**Error:** `Access to fetch blocked by CORS policy`

**Solution:**
- Ensure backend is running on port 5000
- Check `Flask-CORS` is installed
- Verify `CORS(app)` in `app.py`

#### 7. Memory/Performance Issues

**Problem:** Slow response times or high memory usage

**Solution:**
- Reduce chunk size: `chunk_size=500`
- Reduce retrieval count: `k=3, fetch_k=10`
- Use smaller embedding model
- Clear ChromaDB: delete `backend/chroma_db/` folder

#### 8. PDF Parsing Warnings

**Warning:** `[pypdf] Ignoring wrong pointing object`

**Solution:**
- These warnings are suppressed in code
- They don't affect functionality
- If persistent, try converting PDF to text first

---

## 🚀 Future Enhancements

### Planned Features

1. **Multi-Modal Learning**
   - Image-based questions
   - Video content integration
   - Audio explanations

2. **Advanced Analytics**
   - Learning curve visualization
   - Predicted time to proficiency
   - Peer comparison (anonymized)

3. **Collaboration Features**
   - Study groups
   - Shared quiz challenges
   - Peer-to-peer tutoring

4. **Enhanced AI Capabilities**
   - Multi-turn complex problem solving
   - Code execution for programming subjects
   - Real-time Voice interaction

5. **Gamification**
   - Achievement badges
   - Leaderboards
   - Daily challenges
   - Streak tracking

6. **Mobile Applications**
   - iOS app
   - Android app
   - Progressive Web App (PWA)

7. **Admin Dashboard**
   - User management
   - Content moderation
   - Usage analytics
   - System health monitoring

8. **Content Creation Tools**
   - Built-in document editor
   - Quiz builder interface
   - Learning path designer

---

## 📞 Support

For issues, questions, or contributions:

- **Project Location**: `C:\Users\kumar\Desktop\Athena\rag-tutoring-system`
- **Backend Port**: 5000
- **Frontend Port**: 3000
- **Database**: SQLite (upgradable to PostgreSQL)

---

## 📄 License

This project is for educational purposes. Please ensure compliance with:
- Groq API terms of service
- LangChain license
- Course material copyrights

---

## 🙏 Acknowledgments

- **Groq** for providing fast LLM inference
- **LangChain** for RAG framework
- **ChromaDB** for vector storage
- **HuggingFace** for embeddings
- **React** and **TypeScript** communities

---

**Last Updated**: February 11, 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
# Software Requirements Specification (SRS)
## Project: Athena - RAG Tutoring System

Version: 1.0  
Date: 2026-02-24

---

## 1. Purpose
This document defines the software requirements for Athena, an AI-powered tutoring platform using Retrieval-Augmented Generation (RAG), adaptive quizzes, and analytics dashboards.

It is based on analysis of the current project implementation across backend, frontend, data model, and deployment files.

---

## 2. Product Overview
Athena enables learners to:
- Register and authenticate securely
- Select subjects from indexed learning materials
- Ask questions and receive contextual AI explanations
- View mandatory visual explanations (Mermaid/table formats)
- Attempt generated quizzes and receive adaptive difficulty updates
- Track performance and history via a dashboard

---

## 3. System Scope
### In Scope
- Web-based tutoring experience
- RAG with vector search over uploaded material
- User-level chat and quiz history persistence
- Learning-level adaptation from quiz results
- Subject/file upload and indexing

### Out of Scope (Current Version)
- Multi-tenant org admin panel
- Role-based access beyond learner mode
- Distributed deployment orchestration
- Native mobile apps

---

## 4. Architecture Requirements
### 4.1 High-Level Architecture
The system SHALL implement a 3-layer architecture:
1. Frontend SPA (React + TypeScript)
2. Backend API (Flask)
3. Storage layer (SQLite + Chroma vector DB)

### 4.2 External Services
The system SHALL integrate with:
- Groq LLM API (`llama-3.3-70b-versatile`)
- HuggingFace sentence embedding model (`all-MiniLM-L6-v2`)

### 4.3 Data Flow Requirements
- Uploaded/seed documents SHALL be chunked and embedded into Chroma.
- Queries SHALL retrieve context via MMR retrieval (`k=6`, `fetch_k=20`).
- Response generation SHALL use retrieved context and user learning level.

---

## 5. Module-Wise Requirements

## 5.1 Backend Modules

### A) App Bootstrap Module (`backend/src/app.py`)
The backend SHALL:
- Load environment variables from `.env`
- Configure CORS for cross-origin frontend access
- Configure JWT authentication
- Configure SQLAlchemy database connection
- Auto-create DB tables at startup
- Expose API routes under `/api`
- Start HTTP service on port `5000` by default

### B) API Module (`backend/src/api/routes.py`)
The API SHALL provide the following endpoints:
- `POST /api/register`
- `POST /api/login`
- `POST /api/query` (JWT required)
- `POST /api/upload`
- `GET /api/subjects`
- `POST /api/load_subject`
- `POST /api/update_level` (JWT required)
- `GET /api/dashboard` (JWT required)
- `GET /api/chat_history` (JWT required)
- `GET /api/health`

API behavior requirements:
- Registration SHALL reject duplicate username/email.
- Login SHALL return JWT access token on valid credentials.
- Query endpoint SHALL store user + AI chat messages.
- Dashboard endpoint SHALL return user level, topic stats, quiz stats, and recent history.
- Chat history endpoint SHALL support `limit` query parameter.

### C) RAG Service Module (`backend/src/services/rag_service.py`)
The RAG service SHALL:
- Require `GROQ_API_KEY` in environment
- Load/create persistent Chroma store in `backend/chroma_db`
- Auto-ingest documents from subject folders if vector store is empty
- Support `.pdf` and `.txt` ingestion
- Maintain per-user conversation memory
- Enforce response format with topic + explanation + examples + visual + quiz (for on-topic)
- Detect off-topic queries and return brief redirection response
- Exclude source listing for off-topic responses
- Append unique source names for on-topic responses when available

### D) Data Model Module (`backend/src/models.py`)
The system SHALL maintain these entities:
- `User`: identity, credentials hash, learning level
- `QuizHistory`: per-attempt correctness with subject/topic/timestamp
- `UserAbility`: per-topic score and attempt totals
- `ChatMessage`: persisted user/AI conversation records

Password requirements:
- Passwords SHALL be hashed using Werkzeug hashing utilities.
- Plain text password storage SHALL NOT be used.

## 5.2 Frontend Modules

### A) Application Shell (`frontend/src/App.tsx`)
The frontend SHALL:
- Use client-side routes for login, register, chat, dashboard
- Restrict chat/dashboard routes using auth-protected route logic

### B) Authentication Context (`frontend/src/context/AuthContext.tsx`)
The frontend SHALL:
- Store and provide auth state and JWT token
- Provide login/logout behavior to app components

### C) Chat Module (`frontend/src/components/Chat.tsx`)
The chat module SHALL:
- Load subjects and chat history at initialization
- Allow subject selection and material upload
- Send user queries to `/api/query`
- Parse and display quiz blocks from AI response
- Submit quiz outcomes to `/api/update_level`
- Render markdown responses via `react-markdown` + `remark-gfm`
- Render Mermaid code blocks as diagrams
- Track and display current topic and learning level

### D) Dashboard Module (`frontend/src/components/Dashboard.tsx`)
The dashboard SHALL:
- Fetch and display user-level analytics from `/api/dashboard`
- Present topic proficiency, strong/weak topics, and recent activity

### E) Auth UI Modules (`Login.tsx`, `Register.tsx`)
The UI SHALL provide:
- User registration flow
- Login flow with token-based session establishment

---

## 6. Functional Requirements

### FR-1 User Management
- Users SHALL be able to register with unique username and email.
- Users SHALL be able to authenticate and receive JWT.

### FR-2 Subject Management
- System SHALL list available subject folders from backend data directory.
- User SHALL be able to load/select a subject for focused tutoring.

### FR-3 RAG Querying
- User SHALL be able to submit natural-language questions.
- System SHALL return context-grounded answers based on indexed documents.

### FR-4 Visual Response Output
- For on-topic queries, response SHALL include at least one visual representation.
- Visual format MAY be Mermaid flowchart/graph or markdown table.

### FR-5 Quiz Interaction
- System SHALL include a 3-question MCQ quiz for on-topic responses.
- User answers SHALL be processed client-side and reported to backend.

### FR-6 Adaptive Learning
- System SHALL update user learning level using cumulative quiz accuracy.
- Level thresholds SHALL map to Beginner / Intermediate / Advanced.

### FR-7 Progress Analytics
- System SHALL compute and expose per-topic proficiency.
- System SHALL identify strong topics (`>=70%`) and weak topics (`<70%`).

### FR-8 Conversation Persistence
- Chat messages SHALL be persisted by user and retrievable by history API.

### FR-9 Material Upload
- System SHALL accept PDF/TXT uploads and index them into vector storage.

### FR-10 Health Monitoring
- System SHALL expose `/api/health` for status and vector count checks.

---

## 7. Non-Functional Requirements

### NFR-1 Performance
- Query response time SHOULD be suitable for interactive tutoring usage.
- Startup ingestion SHALL provide progress indication for long operations.

### NFR-2 Reliability
- Persistent vector storage SHALL survive service restarts.
- SQLite data SHALL persist user, quiz, and chat records locally.

### NFR-3 Security
- Authentication SHALL use JWT tokens.
- Passwords SHALL be hashed.
- Secrets SHALL be supplied via environment variables.

### NFR-4 Usability
- UI SHALL support clear separation of subject selection, chat, and dashboard.
- System SHALL provide helpful feedback for failures (upload/query/auth).

### NFR-5 Maintainability
- Backend SHALL separate concerns: routing, services, models.
- Frontend SHALL separate concerns: views, auth context, types.

### NFR-6 Compatibility
- Development runtime SHALL support Windows/macOS/Linux.
- Browser compatibility SHALL align with React scripts browserslist settings.

---

## 8. Software Requirements (Environment & Dependencies)

## 8.1 Runtime Requirements
- Python `>=3.11`
- Node.js `>=16`
- npm `>=8`

## 8.2 Backend Dependency Requirements
Required Python packages:
- Flask
- Flask-Cors
- flask-sqlalchemy
- flask-jwt-extended
- python-dotenv
- requests
- groq
- langchain
- langchain-groq
- langchain-community
- langchain-huggingface
- langchain-chroma
- langchain-text-splitters
- langchain-classic
- chromadb
- sentence-transformers
- pypdf
- tqdm

## 8.3 Frontend Dependency Requirements
Required Node packages:
- react `^17.0.2`
- react-dom `^17.0.2`
- react-scripts `5.0.1`
- axios `^0.21.1`
- react-router-dom `^6.0.0`
- framer-motion `^6.0.0`
- lucide-react `^0.263.1`
- react-markdown `^8.0.7`
- remark-gfm `^3.0.1`
- mermaid `^10.6.1`

Dev dependencies:
- typescript `^4.1.2`
- @types/react `^17.0.0`
- @types/react-dom `^17.0.0`

## 8.4 External Configuration Requirements
Environment variables required:
- `GROQ_API_KEY` (mandatory)
- `JWT_SECRET_KEY` (mandatory for secure deployments)

Environment variables optional:
- `DATABASE_URL` (default SQLite path)
- `FLASK_ENV`
- `FLASK_DEBUG`
- `PORT`

---

## 9. Data & Storage Requirements
- Relational data SHALL be stored in SQLite DB file under backend instance path.
- Vector embeddings SHALL be stored in persistent Chroma directory.
- Subject materials SHALL be stored under `backend/data/<subject>`.

Input format requirements:
- Accept `.pdf` and `.txt` files for ingestion.

---

## 10. API Contract Requirements
- All protected endpoints SHALL require `Authorization: Bearer <token>`.
- API responses SHALL be JSON-formatted.
- Error responses SHALL include meaningful `error` fields.

---

## 11. Installation & Run Requirements

### Backend install/run
1. Create and activate Python virtual environment
2. Install dependencies from `backend/requirements.txt`
3. Configure `.env` with required keys
4. Run `python src/app.py`

### Frontend install/run
1. Run `npm install` in `frontend`
2. Run `npm start`
3. Access UI at `http://localhost:3000`

Backend default URL: `http://localhost:5000`

---

## 12. Constraints & Assumptions
- System currently assumes single backend instance with local file persistence.
- SQLite is suitable for development/small deployments; production scaling may require PostgreSQL.
- LLM quality/latency depend on external Groq API availability.
- Subject relevance behavior depends on quality of indexed materials.

---

## 13. Acceptance Criteria
A deployment SHALL be considered valid when:
1. User can register and login successfully.
2. Subject list loads and subject can be selected.
3. Query returns contextual response with visual and on-topic quiz.
4. Quiz submission updates user level.
5. Dashboard displays quiz and topic analytics.
6. Uploaded PDF/TXT files are indexed and answerable.
7. Chat history persists and is retrievable.
8. Health endpoint reports `status: healthy`.

---

## 14. Traceability (Module → Requirement)
- `app.py` → bootstrap, CORS, JWT, DB initialization
- `routes.py` → functional API behavior
- `rag_service.py` → RAG, retrieval, adaptation, prompt policy
- `models.py` → relational schema and persistence
- `App.tsx` + `AuthContext.tsx` → protected frontend access
- `Chat.tsx` → tutoring interaction, quiz, Mermaid rendering
- `Dashboard.tsx` → analytics presentation

---

## 15. Recommended Next Improvements (Optional)
- Add endpoint-level input validation schema
- Add rate-limiting and brute-force protection on auth endpoints
- Add unit/integration tests for API and RAG formatting guarantees
- Add environment-specific configs for production deployment
- Add migration tooling (Alembic) for DB schema versioning

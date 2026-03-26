from flask import Blueprint, request, jsonify, Response, stream_with_context
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    get_jwt_identity,
    set_refresh_cookies,
    unset_jwt_cookies,
)
from werkzeug.security import generate_password_hash, check_password_hash
from ..services.rag_service import RAGService
from ..models import (
    db, User, QuizHistory, UserAbility, ChatMessage, LearningProgress,
    Curriculum, CurriculumModule, CurriculumTopic, TopicProgress
)
from datetime import datetime
from pathlib import Path
import os
import json

api = Blueprint('api', __name__)


class _UnavailableRAGService:
    """Fallback object so API module import never crashes on startup.

    Tests can replace `rag_service` with a mock implementation, and production
    logs the root cause instead of failing import-time.
    """

    def __init__(self, reason):
        self.reason = str(reason)
        self.learning_level = 'Beginner'
        self.data_dir = Path(__file__).resolve().parents[2] / "data"

        class _Collection:
            @staticmethod
            def count():
                return 0

        class _VectorDB:
            _collection = _Collection()

            @staticmethod
            def similarity_search(*_args, **_kwargs):
                return []

        self.vector_db = _VectorDB()

    def _ensure_initialized(self):
        """Fallback: raise error with helpful message."""
        raise RuntimeError(f'RAG service unavailable: {self.reason}')
    
    def list_subjects(self):
        """Fallback: return empty list instead of crashing."""
        return []
    
    def load_subject(self, subject):
        """Fallback: raise error."""
        raise RuntimeError(f'RAG service unavailable: {self.reason}')

    def __getattr__(self, _name):
        raise RuntimeError(f'RAG service unavailable: {self.reason}')


# Lazy-load RAG service to avoid memory issues on startup
_rag_service_instance = None


def _create_rag_service():
    try:
        return RAGService()
    except Exception as e:
        print(f"[WARN] RAGService initialization failed: {e}")
        return _UnavailableRAGService(e)


def get_rag_service():
    """Get RAG service instance, creating it lazily on first use."""
    global _rag_service_instance
    if _rag_service_instance is None:
        _rag_service_instance = _create_rag_service()
    return _rag_service_instance


def _upsert_learning_progress(user_id, subject, concept, status=None, mastery_delta=0.0):
    if not concept:
        return
    subj = (subject or "General").strip() or "General"
    concept_name = concept.strip()
    row = LearningProgress.query.filter_by(user_id=user_id, subject=subj, concept=concept_name).first()
    if not row:
        row = LearningProgress(user_id=user_id, subject=subj, concept=concept_name)
        db.session.add(row)

    if status in {"not_started", "learning", "mastered"}:
        row.status = status
    if mastery_delta:
        row.mastery_score = max(0.0, min(1.0, (row.mastery_score or 0.0) + mastery_delta))


@api.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already exists'}), 400

    user = User(username=username, email=email)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'User registered successfully'}), 201

@api.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        response = jsonify(access_token=access_token, user={
            'id': user.id,
            'username': user.username,
            'level': user.learning_level,
            'topic': user.current_topic,
            'proficiency': user.proficiency_score,
            'selected_subject': user.selected_subject or ''
        })
        set_refresh_cookies(response, refresh_token)
        return response, 200
    
    return jsonify({'error': 'Invalid credentials'}), 401


@api.route('/refresh', methods=['POST'])
@jwt_required(refresh=True, locations=['cookies'])
def refresh_access_token():
    # Diagnostic print to help debug 401s
    from flask import request
    print(f"[DEBUG] Refresh attempt. Cookies: {request.cookies.keys()}")
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    access_token = create_access_token(identity=str(user.id))
    return jsonify(access_token=access_token, user={
        'id': user.id,
        'username': user.username,
        'level': user.learning_level,
        'topic': user.current_topic,
        'proficiency': user.proficiency_score,
        'selected_subject': user.selected_subject or ''
    }), 200


@api.route('/logout', methods=['POST'])
def logout():
    response = jsonify({'message': 'Logged out successfully'})
    unset_jwt_cookies(response)
    return response, 200


@api.route('/user/subject', methods=['PUT'])
@jwt_required()
def save_user_subject():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    subject = (request.json or {}).get('subject', '')
    user.selected_subject = subject if subject else None
    db.session.commit()
    return jsonify({'selected_subject': user.selected_subject or ''}), 200

@api.route('/query', methods=['POST'])
@jwt_required()
def handle_query():
    data = request.json
    user_query = data.get('query')
    subject = data.get('subject')
    current_topic = data.get('current_topic')
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    
    if not user_query:
        return jsonify({'error': 'Query is required'}), 400
    
    try:
        # Get and initialize RAG service
        rag = get_rag_service()
        rag._ensure_initialized()
        
        db.session.add(ChatMessage(
            user_id=user.id,
            role='user',
            content=user_query,
            subject=subject
        ))
        db.session.commit()
        # Calculate context for intelligent teaching
        abilities = UserAbility.query.filter_by(user_id=user.id).all()
        weak_topics = [a.topic for a in abilities if (a.score / a.total_attempts) < 0.6 and a.total_attempts > 0]
        proficiency = user.proficiency_score or 0.0

        # Pass user context to rag service with subject for relevance checking
        response, topic = rag.get_response(
            user_query, 
            user.learning_level, 
            user_id,
            subject=subject,
            proficiency_score=proficiency,
            weak_topics=weak_topics,
            current_topic=(current_topic or user.current_topic),
        )
        db.session.add(ChatMessage(
            user_id=user.id,
            role='ai',
            content=response,
            subject=subject,
            topic=topic
        ))

        if topic and topic != "General":
            _upsert_learning_progress(user.id, subject, topic, status="learning", mastery_delta=0.05)
        
        # PERSIST CURRENT TOPIC
        if topic and topic != "General":
            user.current_topic = topic
            
        db.session.commit()
        return jsonify({'response': response, 'topic': topic, 'level': user.learning_level}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/query_stream', methods=['POST'])
@jwt_required()
def handle_query_stream():
    data = request.json
    user_query = data.get('query')
    subject = data.get('subject')
    current_topic = data.get('current_topic')
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)

    if not user_query:
        return jsonify({'error': 'Query is required'}), 400

    def sse_event(payload):
        return f"data: {json.dumps(payload)}\n\n"

    def generate():
        try:
            # Get and initialize RAG service
            rag = get_rag_service()
            rag._ensure_initialized()
            
            db.session.add(ChatMessage(
                user_id=user.id,
                role='user',
                content=user_query,
                subject=subject
            ))
            db.session.commit()

            abilities = UserAbility.query.filter_by(user_id=user.id).all()
            weak_topics = [a.topic for a in abilities if (a.score / a.total_attempts) < 0.6 and a.total_attempts > 0]
            proficiency = user.proficiency_score or 0.0

            full_ai_text = ""
            final_topic = "General"

            for event in rag.stream_response(
                user_query,
                user.learning_level,
                user_id,
                subject=subject,
                proficiency_score=proficiency,
                weak_topics=weak_topics,
                current_topic=(current_topic or user.current_topic),
            ):
                event_type = event.get('type')

                if event_type == 'chunk':
                    chunk = event.get('content', '')
                    full_ai_text += chunk
                    yield sse_event({'type': 'chunk', 'content': chunk})
                elif event_type == 'done':
                    final_topic = event.get('topic', 'General')
                    final_response = event.get('final_response', full_ai_text)

                    db.session.add(ChatMessage(
                        user_id=user.id,
                        role='ai',
                        content=final_response,
                        subject=subject,
                        topic=final_topic
                    ))
                    if final_topic and final_topic != "General":
                        _upsert_learning_progress(user.id, subject, final_topic, status="learning", mastery_delta=0.05)
                    if final_topic and final_topic != "General":
                        user.current_topic = final_topic
                    db.session.commit()

                    yield sse_event({
                        'type': 'done',
                        'topic': final_topic,
                        'level': user.learning_level,
                        'final_response': final_response
                    })
                elif event_type == 'error':
                    yield sse_event({'type': 'error', 'error': event.get('error', 'Streaming failed')})
        except Exception as e:
            db.session.rollback()
            yield sse_event({'type': 'error', 'error': str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )


@api.route('/upload', methods=['POST'])
def upload_document():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    subject = request.form.get('subject') or 'General'

    # Ensure subject directory exists so uploads also contribute to subject curriculum map.
    rag = get_rag_service()
    rag._ensure_initialized()
    data_dir = os.path.join(rag.data_dir, subject)
    os.makedirs(data_dir, exist_ok=True)

    file_path = os.path.join(data_dir, file.filename)
    file.save(file_path)
    
    try:
        msg = rag.load_document(file_path, subject=subject)
        return jsonify({'message': msg}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api.route('/subjects', methods=['GET'])
def list_subjects():
    try:
        rag = get_rag_service()
        rag._ensure_initialized()
        subjects = rag.list_subjects()
        return jsonify({'subjects': subjects}), 200
    except Exception as e:
        print(f"[ERROR] /subjects endpoint failed: {e}")
        return jsonify({'error': str(e), 'subjects': []}), 500

@api.route('/load_subject', methods=['POST'])
def select_subject():
    data = request.json
    subject_name = data.get('subject')
    if not subject_name:
        return jsonify({'error': 'Subject name required'}), 400
    
    try:
        rag = get_rag_service()
        rag._ensure_initialized()
        msg = rag.load_subject(subject_name)
        return jsonify({'message': msg}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api.route('/update_level', methods=['POST'])
@jwt_required()
def update_level():
    data = request.json
    user_id = int(get_jwt_identity())
    results = data.get('quiz_results') # {'correct': 1, 'total': 1, 'subject': '...', 'topic': '...'}
    
    if not results:
        return jsonify({'error': 'Quiz results required'}), 400
    
    rag = get_rag_service()
    rag._ensure_initialized()
        
    user = User.query.get(user_id)
    subject = results.get('subject')
    topic = results.get('topic', 'General')
    is_correct = results.get('correct', 0) > 0

    # Save history
    history = QuizHistory(user_id=user.id, subject=subject, topic=topic, is_correct=is_correct)
    db.session.add(history)

    # Update ability
    ability = UserAbility.query.filter_by(user_id=user.id, topic=topic).first()
    if not ability:
        ability = UserAbility(user_id=user.id, topic=topic)
        db.session.add(ability)
    if ability.total_attempts is None:
        ability.total_attempts = 0
    if ability.score is None:
        ability.score = 0
    
    ability.total_attempts += 1
    if is_correct:
        ability.score += 1

    # Progress tracking at concept level.
    if topic and topic != 'General':
        if is_correct:
            _upsert_learning_progress(user.id, subject, topic, status='mastered', mastery_delta=0.2)
        else:
            _upsert_learning_progress(user.id, subject, topic, status='learning', mastery_delta=0.02)

    # Update global level
    current_proficiency = user.proficiency_score or 0.0
    rag = get_rag_service()
    rag._ensure_initialized()
    new_level, new_proficiency = rag.update_learning_level(results, current_proficiency)
    
    user.learning_level = new_level
    user.proficiency_score = new_proficiency
    db.session.commit()

    return jsonify({'level': new_level, 'proficiency': new_proficiency}), 200

@api.route('/dashboard', methods=['GET'])
@jwt_required()
def get_dashboard():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    abilities = UserAbility.query.filter_by(user_id=user_id).all()
    quiz_history = QuizHistory.query.filter_by(user_id=user_id).order_by(QuizHistory.timestamp.desc()).limit(10).all()
    chat_history = ChatMessage.query.filter_by(user_id=user_id).order_by(ChatMessage.created_at.desc()).limit(10).all()
    total_quizzes = QuizHistory.query.filter_by(user_id=user_id).count()
    total_correct = QuizHistory.query.filter_by(user_id=user_id, is_correct=True).count()
    accuracy = (total_correct / total_quizzes * 100) if total_quizzes > 0 else 0
    
    stats = []
    for a in abilities:
        stats.append({
            'topic': a.topic,
            'score': a.score,
            'total': a.total_attempts,
            'proficiency': (a.score / a.total_attempts * 100) if a.total_attempts > 0 else 0
        })
    
    # Identify strong and weak areas
    strong = [s['topic'] for s in stats if s['proficiency'] >= 70]
    weak = [s['topic'] for s in stats if s['proficiency'] < 70]

    return jsonify({
        'user': {'username': user.username, 'level': user.learning_level},
        'stats': stats,
        'strong_topics': strong,
        'weak_topics': weak,
        'quiz': {
            'total': total_quizzes,
            'correct': total_correct,
            'accuracy': accuracy
        },
        'recent_quizzes': [
            {
                'subject': q.subject,
                'topic': q.topic,
                'is_correct': q.is_correct,
                'timestamp': q.timestamp.isoformat()
            }
            for q in quiz_history
        ],
        'recent_chats': [
            {
                'role': c.role,
                'content': c.content,
                'subject': c.subject,
                'topic': c.topic,
                'timestamp': c.created_at.isoformat()
            }
            for c in reversed(chat_history)
        ]
    }), 200


@api.route('/learning_path', methods=['GET'])
@jwt_required()
def get_learning_path():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    subject = request.args.get('subject', default='General', type=str)

    abilities = UserAbility.query.filter_by(user_id=user_id).all()
    weak_topics = [a.topic for a in abilities if a.total_attempts and (a.score / a.total_attempts) < 0.6]

    progress_rows = LearningProgress.query.filter_by(user_id=user_id, subject=subject).all()
    progress_map = {
        p.concept: {
            'status': p.status,
            'mastery_score': p.mastery_score,
            'last_seen': p.last_seen.isoformat() if p.last_seen else None,
        }
        for p in progress_rows
    }

    rag = get_rag_service()
    rag._ensure_initialized()
    
    path = rag.generate_learning_path(
        subject=subject,
        level=user.learning_level,
        weak_topics=weak_topics,
        progress_map=progress_map,
    )
    
    rag = get_rag_service()
    rag._ensure_initialized()

    return jsonify(path), 200


@api.route('/learning_progress', methods=['POST'])
@jwt_required()
def update_learning_progress():
    user_id = int(get_jwt_identity())
    data = request.json or {}
    subject = data.get('subject', 'General')
    concept = data.get('concept')
    status = data.get('status')
    mastery_score = data.get('mastery_score')

    if not concept:
        return jsonify({'error': 'concept is required'}), 400

    row = LearningProgress.query.filter_by(user_id=user_id, subject=subject, concept=concept).first()
    if not row:
        row = LearningProgress(user_id=user_id, subject=subject, concept=concept)
        db.session.add(row)

    if status in {'not_started', 'learning', 'mastered'}:
        row.status = status
    if mastery_score is not None:
        try:
            row.mastery_score = max(0.0, min(1.0, float(mastery_score)))
        except Exception:
            return jsonify({'error': 'mastery_score must be numeric'}), 400

    db.session.commit()
    return jsonify({'message': 'progress updated'}), 200


@api.route('/chat_history', methods=['GET'])
@jwt_required()
def get_chat_history():
    user_id = int(get_jwt_identity())
    limit = request.args.get('limit', default=50, type=int)
    history = ChatMessage.query.filter_by(user_id=user_id).order_by(ChatMessage.created_at.desc()).limit(limit).all()
    return jsonify({
        'messages': [
            {
                'role': m.role,
                'content': m.content,
                'subject': m.subject,
                'topic': m.topic,
                'timestamp': m.created_at.isoformat()
            }
            for m in reversed(history)
        ]
    }), 200

@api.route('/clear_chat', methods=['DELETE'])
@jwt_required()
def clear_chat():
    user_id = int(get_jwt_identity())
    try:
        # Delete only messages, keeping dashboard/ability/quiz history intact
        ChatMessage.query.filter_by(user_id=user_id).delete()
        db.session.commit()
        return jsonify({'message': 'Chat history cleared. Analytics preserved.'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/health', methods=['GET'])
def health_check():
    """Simple health check that doesn't require RAG service initialization."""
    return jsonify({
        'status': 'healthy',
        'message': 'API server is running'
    }), 200


# ── Curriculum / Tutor Routes ─────────────────────────────────────────────────

def _serialize_curriculum(cur, user_id):
    modules = []
    for mod in cur.modules:
        topics = []
        for top in mod.topics:
            prog = TopicProgress.query.filter_by(user_id=user_id, topic_id=top.id).first()
            topics.append({
                'id': top.id,
                'name': top.name,
                'difficulty': top.difficulty,
                'status': prog.status if prog else 'not_started',
                'score': prog.score if prog else 0.0,
            })
        modules.append({
            'id': mod.id,
            'name': mod.name,
            'order': mod.order,
            'topics': topics,
        })
    return {
        'id': cur.id,
        'subject': cur.subject,
        'generated_at': cur.generated_at.isoformat(),
        'modules': modules,
    }


@api.route('/curriculum/generate', methods=['POST'])
@jwt_required()
def generate_curriculum():
    data = request.json or {}
    subject = data.get('subject')
    if not subject:
        return jsonify({'error': 'subject is required'}), 400
    user_id = int(get_jwt_identity())

    try:
        rag = get_rag_service()
        rag._ensure_initialized()
        curriculum_data = rag.generate_curriculum(subject)

        # Replace existing curriculum for this subject
        existing = Curriculum.query.filter_by(subject=subject).first()
        if existing:
            db.session.delete(existing)
            db.session.flush()

        cur = Curriculum(subject=subject)
        db.session.add(cur)
        db.session.flush()

        for mod_idx, mod_data in enumerate(curriculum_data.get('modules', [])):
            mod = CurriculumModule(
                curriculum_id=cur.id,
                order=mod_idx,
                name=mod_data['name']
            )
            db.session.add(mod)
            db.session.flush()
            for top_idx, top_data in enumerate(mod_data.get('topics', [])):
                top = CurriculumTopic(
                    module_id=mod.id,
                    order=top_idx,
                    name=top_data['name'],
                    difficulty=top_data.get('difficulty', 'medium')
                )
                db.session.add(top)

        db.session.commit()
        return jsonify({
            'message': 'Curriculum generated',
            'curriculum': _serialize_curriculum(cur, user_id)
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/curriculum/<path:subject>', methods=['GET'])
@jwt_required()
def get_curriculum(subject):
    user_id = int(get_jwt_identity())
    cur = Curriculum.query.filter_by(subject=subject).first()
    if not cur:
        return jsonify({'curriculum': None}), 200
    return jsonify({'curriculum': _serialize_curriculum(cur, user_id)}), 200


@api.route('/curriculum/teach_stream', methods=['POST'])
@jwt_required()
def teach_topic_stream():
    data = request.json or {}
    topic_id = data.get('topic_id')
    topic_name = data.get('topic_name')
    difficulty = data.get('difficulty', 'medium')
    subject = data.get('subject', 'General')
    simplify = bool(data.get('simplify', False))
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)

    if not topic_name:
        return jsonify({'error': 'topic_name is required'}), 400

    def sse_event(payload):
        return f"data: {json.dumps(payload)}\n\n"

    def generate():
        try:
            # Get and initialize RAG service
            rag = get_rag_service()
            rag._ensure_initialized()
            
            # Fetch relevant context from vector DB
            context_text = ""
            try:
                docs = rag.vector_db.similarity_search(topic_name, k=4)
                context_text = "\n".join(d.page_content[:300] for d in docs)
            except Exception:
                pass

            lesson = rag.teach_topic(
                topic_name=topic_name,
                difficulty=difficulty,
                subject=subject,
                context_text=context_text,
                level=user.learning_level,
                simplify=simplify
            )

            # Stream lesson in small chunks for typewriter effect
            chunk_size = 6
            for i in range(0, len(lesson), chunk_size):
                yield sse_event({'type': 'chunk', 'content': lesson[i:i + chunk_size]})

            # Persist lesson as chat message
            db.session.add(ChatMessage(
                user_id=user_id,
                role='ai',
                content=lesson,
                subject=subject,
                topic=topic_name
            ))

            # Mark topic as in_progress if not completed yet
            if topic_id:
                prog = TopicProgress.query.filter_by(
                    user_id=user_id, topic_id=int(topic_id)
                ).first()
                if not prog:
                    prog = TopicProgress(user_id=user_id, topic_id=int(topic_id))
                    db.session.add(prog)
                if prog.status == 'not_started':
                    prog.status = 'in_progress'

            # Keep active topic in sync with sidebar learning flow.
            user.current_topic = topic_name

            db.session.commit()
            yield sse_event({
                'type': 'done',
                'topic': topic_name,
                'level': user.learning_level,
                'final_response': lesson
            })
        except Exception as e:
            db.session.rollback()
            yield sse_event({'type': 'error', 'error': str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


@api.route('/curriculum/progress', methods=['POST'])
@jwt_required()
def update_curriculum_topic_progress():
    data = request.json or {}
    topic_id = data.get('topic_id')
    status = data.get('status')
    score = data.get('score')
    user_id = int(get_jwt_identity())

    if not topic_id:
        return jsonify({'error': 'topic_id is required'}), 400

    topic = CurriculumTopic.query.get(int(topic_id))
    if not topic:
        return jsonify({'error': 'Topic not found'}), 404

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    prog = TopicProgress.query.filter_by(user_id=user_id, topic_id=int(topic_id)).first()
    if not prog:
        prog = TopicProgress(user_id=user_id, topic_id=int(topic_id))
        db.session.add(prog)

    if status in ('not_started', 'in_progress', 'completed'):
        prog.status = status
        if status == 'completed' and not prog.completed_at:
            prog.completed_at = datetime.utcnow()
        # Whenever learner interacts with a curriculum topic, make it the active topic.
        user.current_topic = topic.name
    if score is not None:
        try:
            prog.score = max(0.0, min(1.0, float(score)))
        except (ValueError, TypeError):
            return jsonify({'error': 'score must be numeric'}), 400

    db.session.commit()
    return jsonify({'message': 'Progress updated'}), 200


@api.route('/curriculum/topic_quiz_stream', methods=['POST'])
@jwt_required()
def topic_quiz_stream():
    data = request.json or {}
    topic_id = data.get('topic_id')
    topic_name = data.get('topic_name', '')
    difficulty = data.get('difficulty', 'medium')
    subject = data.get('subject', 'General')
    is_retry = bool(data.get('is_retry', False))
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)

    if not topic_name:
        return jsonify({'error': 'topic_name is required'}), 400

    def sse_event(payload):
        return f"data: {json.dumps(payload)}\n\n"

    def generate():
        try:
            # Get and initialize RAG service
            rag = get_rag_service()
            rag._ensure_initialized()
            
            context_text = ""
            try:
                docs = rag.vector_db.similarity_search(topic_name, k=3)
                context_text = "\n".join(d.page_content[:300] for d in docs)
            except Exception:
                pass

            quiz_text = rag.generate_topic_quiz(
                topic_name=topic_name,
                difficulty=difficulty,
                subject=subject,
                context_text=context_text,
                level=user.learning_level,
                is_retry=is_retry
            )

            chunk_size = 6
            for i in range(0, len(quiz_text), chunk_size):
                yield sse_event({'type': 'chunk', 'content': quiz_text[i:i + chunk_size]})

            db.session.add(ChatMessage(
                user_id=user_id,
                role='ai',
                content=quiz_text,
                subject=subject,
                topic=topic_name
            ))
            db.session.commit()
            yield sse_event({'type': 'done', 'topic': topic_name, 'final_response': quiz_text})
        except Exception as e:
            db.session.rollback()
            yield sse_event({'type': 'error', 'error': str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


@api.route('/curriculum/module_quiz_stream', methods=['POST'])
@jwt_required()
def module_quiz_stream():
    data = request.json or {}
    module_id = data.get('module_id')
    module_name = data.get('module_name', '')
    subject = data.get('subject', 'General')
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)

    if not module_name:
        return jsonify({'error': 'module_name is required'}), 400

    def sse_event(payload):
        return f"data: {json.dumps(payload)}\n\n"

    def generate():
        try:
            # Get and initialize RAG service
            rag = get_rag_service()
            rag._ensure_initialized()
            
            # Gather topic names for this module
            topic_names = []
            if module_id:
                mod = CurriculumModule.query.get(int(module_id))
                if mod:
                    topic_names = [t.name for t in mod.topics]

            context_text = ""
            try:
                query = module_name + " " + " ".join(topic_names[:3])
                docs = rag.vector_db.similarity_search(query, k=4)
                context_text = "\n".join(d.page_content[:300] for d in docs)
            except Exception:
                pass

            quiz_text = rag.generate_module_quiz(
                module_name=module_name,
                topic_names=topic_names,
                subject=subject,
                context_text=context_text,
                level=user.learning_level
            )

            chunk_size = 6
            for i in range(0, len(quiz_text), chunk_size):
                yield sse_event({'type': 'chunk', 'content': quiz_text[i:i + chunk_size]})

            db.session.add(ChatMessage(
                user_id=user_id,
                role='ai',
                content=quiz_text,
                subject=subject,
                topic=f"Module Quiz: {module_name}"
            ))
            db.session.commit()
            yield sse_event({'type': 'done', 'module': module_name, 'final_response': quiz_text})
        except Exception as e:
            db.session.rollback()
            yield sse_event({'type': 'error', 'error': str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


@api.route('/curriculum/final_test_stream', methods=['POST'])
@jwt_required()
def final_test_stream():
    data = request.json or {}
    subject = data.get('subject', 'General')
    curriculum_id = data.get('curriculum_id')
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)

    def sse_event(payload):
        return f"data: {json.dumps(payload)}\n\n"

    def generate():
        try:
            # Get and initialize RAG service
            rag = get_rag_service()
            rag._ensure_initialized()
            
            module_names = []
            if curriculum_id:
                cur = Curriculum.query.get(int(curriculum_id))
                if cur:
                    module_names = [m.name for m in cur.modules]

            context_text = ""
            try:
                docs = rag.vector_db.similarity_search(subject, k=5)
                context_text = "\n".join(d.page_content[:300] for d in docs)
            except Exception:
                pass

            test_text = rag.generate_final_test(
                subject=subject,
                module_names=module_names,
                level=user.learning_level,
                context_text=context_text
            )

            chunk_size = 6
            for i in range(0, len(test_text), chunk_size):
                yield sse_event({'type': 'chunk', 'content': test_text[i:i + chunk_size]})

            db.session.add(ChatMessage(
                user_id=user_id,
                role='ai',
                content=test_text,
                subject=subject,
                topic=f"Final Test: {subject}"
            ))
            db.session.commit()
            yield sse_event({'type': 'done', 'subject': subject, 'final_response': test_text})
        except Exception as e:
            db.session.rollback()
            yield sse_event({'type': 'error', 'error': str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )
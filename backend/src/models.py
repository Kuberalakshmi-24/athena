from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128))
    learning_level = db.Column(db.String(20), default='Beginner')
    current_topic = db.Column(db.String(100), default='General')
    selected_subject = db.Column(db.String(100), default=None)
    proficiency_score = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class QuizHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    subject = db.Column(db.String(100))
    topic = db.Column(db.String(100))
    is_correct = db.Column(db.Boolean)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class UserAbility(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    topic = db.Column(db.String(100))
    score = db.Column(db.Integer, default=0) # Total correct
    total_attempts = db.Column(db.Integer, default=0)

class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    role = db.Column(db.String(10), nullable=False)  # 'user' or 'ai'
    content = db.Column(db.Text, nullable=False)
    subject = db.Column(db.String(100))
    topic = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class LearningProgress(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    subject = db.Column(db.String(100), nullable=False, index=True)
    concept = db.Column(db.String(150), nullable=False)
    status = db.Column(db.String(20), default='not_started')  # not_started | learning | mastered
    mastery_score = db.Column(db.Float, default=0.0)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'subject', 'concept', name='uq_user_subject_concept'),
    )


# ── Tutor / Curriculum Engine ────────────────────────────────────────────────

class Curriculum(db.Model):
    __tablename__ = 'curriculum'
    id = db.Column(db.Integer, primary_key=True)
    subject = db.Column(db.String(100), unique=True, nullable=False, index=True)
    generated_at = db.Column(db.DateTime, default=datetime.utcnow)
    modules = db.relationship(
        'CurriculumModule', backref='curriculum',
        cascade='all, delete-orphan',
        order_by='CurriculumModule.order'
    )


class CurriculumModule(db.Model):
    __tablename__ = 'curriculum_module'
    id = db.Column(db.Integer, primary_key=True)
    curriculum_id = db.Column(db.Integer, db.ForeignKey('curriculum.id'), nullable=False)
    order = db.Column(db.Integer, nullable=False, default=0)
    name = db.Column(db.String(200), nullable=False)
    topics = db.relationship(
        'CurriculumTopic', backref='module',
        cascade='all, delete-orphan',
        order_by='CurriculumTopic.order'
    )


class CurriculumTopic(db.Model):
    __tablename__ = 'curriculum_topic'
    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey('curriculum_module.id'), nullable=False)
    order = db.Column(db.Integer, nullable=False, default=0)
    name = db.Column(db.String(200), nullable=False)
    difficulty = db.Column(db.String(20), default='medium')  # easy | medium | hard


class TopicProgress(db.Model):
    __tablename__ = 'topic_progress'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    topic_id = db.Column(db.Integer, db.ForeignKey('curriculum_topic.id'), nullable=False)
    status = db.Column(db.String(20), default='not_started')  # not_started | in_progress | completed
    score = db.Column(db.Float, default=0.0)
    completed_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'topic_id', name='uq_user_topic_progress'),
    )

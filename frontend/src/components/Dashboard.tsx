import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Brain, TrendingUp, AlertTriangle, BookOpen, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchLearningPath, fetchSubjects, fetchCurriculum, loadSubject, saveUserSubject } from '../services/api';
import { CurriculumData } from './sidebar/RoadmapPanel';

interface TopicStat {
    topic: string;
    score: number;
    total: number;
    proficiency: number;
}

interface DashboardData {
    user: { username: string; level: string };
    stats: TopicStat[];
    strong_topics: string[];
    weak_topics: string[];
    quiz: { total: number; correct: number; accuracy: number };
    recent_quizzes: { subject: string; topic: string; is_correct: boolean; timestamp: string }[];
    recent_chats: { role: 'user' | 'ai'; content: string; subject?: string; topic?: string; timestamp: string }[];
}

interface LearningPathStep {
    order: number;
    concept: string;
    status: 'not_started' | 'learning' | 'mastered';
    mastery_score: number;
}

interface LearningPathData {
    subject: string;
    steps: LearningPathStep[];
    graph: {
        nodes: string[];
        edges: string[][];
    };
}

const Dashboard: React.FC = () => {
    const [data, setData] = useState<DashboardData | null>(null);
    const [learningPath, setLearningPath] = useState<LearningPathData | null>(null);
    const [curriculumList, setCurriculumList] = useState<CurriculumData[]>([]);
    const [subjects, setSubjects] = useState<string[]>([]);
    const [activeSubject, setActiveSubject] = useState<string>(
        () => sessionStorage.getItem('athena_sel_subject') || ''
    );
    const [subjectSwitching, setSubjectSwitching] = useState(false);
    const { token, authFetch } = useAuth();
    const navigate = useNavigate();
    const truncate = (text: string, max = 150) => (text.length > max ? `${text.slice(0, max)}...` : text);

    const handleChangeSubject = async (subj: string) => {
        if (subj === activeSubject || subjectSwitching) return;
        setSubjectSwitching(true);
        try {
            const res = await loadSubject(authFetch, subj);
            if (res.ok) {
                sessionStorage.setItem('athena_sel_subject', subj);
                sessionStorage.removeItem('athena_last_topic_id');
                setActiveSubject(subj);
                await saveUserSubject(authFetch, subj);
            }
        } catch { /* ignore */ }
        setSubjectSwitching(false);
    };

    useEffect(() => {
        const fetchDashboard = async () => {
            try {
                const response = await authFetch('http://localhost:10000/api/dashboard');
                const d = await response.json();
                if (response.ok) {
                    setData(d);

                    const subjectsResponse = await fetchSubjects(authFetch);
                    const subjectsData = await subjectsResponse.json();
                    const subjects: string[] = subjectsData.subjects || [];
                    setSubjects(subjects);
                    const candidateSubject = subjects[0] || 'General';

                    if (candidateSubject) {
                        const pathRes = await fetchLearningPath(authFetch, candidateSubject);
                        const pathData = await pathRes.json();
                        if (pathRes.ok) {
                            setLearningPath(pathData);
                        }
                    }

                    // Load curriculum for all subjects to show progress
                    const curriculumResults: CurriculumData[] = [];
                    for (const subj of subjects) {
                        try {
                            const curRes = await fetchCurriculum(authFetch, subj);
                            const curData = await curRes.json();
                            if (curRes.ok && curData.curriculum) {
                                curriculumResults.push(curData.curriculum);
                            }
                        } catch { /* skip */ }
                    }
                    setCurriculumList(curriculumResults);
                }
            } catch (err) {
                console.error(err);
            }
        };
        fetchDashboard();
    }, [token, authFetch]);

    if (!data) return (
        <div className="dashboard-wrapper" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="status-indicator">
                <div className="status-dot"></div>
                Analyzing performance...
            </div>
        </div>
    );

    return (
        <div className="dashboard-wrapper">
            <nav className="dashboard-nav">
                <button onClick={() => navigate('/')} className="back-btn">
                    <ArrowLeft size={18} /> Back to Learning
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="user-avatar" style={{ width: '32px', height: '32px', fontSize: '13px' }}>
                        {data.user.username.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>{data.user.username}</span>
                </div>
            </nav>

            <main className="dashboard-content">
                <header className="dashboard-header-text">
                    <motion.h1
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                    >
                        Learning Dashboard
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                    >
                        Detailed analysis of your educational progress and mastery.
                    </motion.p>
                </header>

                <div className="stats-grid">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="premium-card">
                        <div className="card-icon-box blue-icon">
                            <Brain size={20} />
                        </div>
                        <span className="stat-label">Level</span>
                        <div className="stat-value" style={{ color: '#1e293b', fontSize: '24px' }}>{data.user.level}</div>
                        <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>Optimized via EMA</p>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="premium-card">
                        <div className="card-icon-box green-icon">
                            <TrendingUp size={20} />
                        </div>
                        <span className="stat-label">Top Mastery</span>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                            {data.strong_topics.map(t => (
                                <span key={t} className="badge badge-green" style={{ fontSize: '10px' }}>{t}</span>
                            ))}
                            {data.strong_topics.length === 0 && <span style={{ color: '#94a3b8', fontSize: '12px' }}>N/A</span>}
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="premium-card">
                        <div className="card-icon-box red-icon">
                            <AlertTriangle size={20} />
                        </div>
                        <span className="stat-label">Improvement</span>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                            {data.weak_topics.map(t => (
                                <span key={t} className="badge badge-red" style={{ fontSize: '10px' }}>{t}</span>
                            ))}
                            {data.weak_topics.length === 0 && <span style={{ color: '#94a3b8', fontSize: '12px' }}>N/A</span>}
                        </div>
                    </motion.div>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.32 }}
                    className="premium-card"
                    style={{ marginTop: '16px', padding: '16px 20px' }}
                >
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <RefreshCw size={15} style={{ color: '#2563eb' }} />
                        Active Subject
                        {subjectSwitching && <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}>Switching...</span>}
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {subjects.map(s => {
                            const isActive = s === activeSubject;
                            return (
                                <button
                                    key={s}
                                    onClick={() => handleChangeSubject(s)}
                                    disabled={subjectSwitching}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: '10px',
                                        border: `1.5px solid ${isActive ? '#2563eb' : '#e2e8f0'}`,
                                        background: isActive ? '#2563eb' : '#f8fafc',
                                        color: isActive ? 'white' : '#475569',
                                        fontSize: '13px',
                                        fontWeight: isActive ? 700 : 500,
                                        cursor: subjectSwitching ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.15s',
                                        opacity: subjectSwitching && !isActive ? 0.5 : 1,
                                    }}
                                >
                                    {isActive ? '✓ ' : ''}{s}
                                </button>
                            );
                        })}
                        {subjects.length === 0 && (
                            <span style={{ fontSize: '13px', color: '#94a3b8' }}>No subjects uploaded yet.</span>
                        )}
                    </div>
                    {activeSubject && (
                        <p style={{ marginTop: '10px', fontSize: '11px', color: '#94a3b8' }}>
                            The selected subject will be active when you return to the Learning Assistant.
                        </p>
                    )}
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 }}
                    className="premium-card"
                    style={{ marginTop: '16px', padding: '16px 20px' }}
                >
                    <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '12px' }}>
                        Learning Path {learningPath?.subject ? `(${learningPath.subject})` : ''}
                    </h3>
                    {learningPath && learningPath.steps.length > 0 ? (
                        <div style={{ display: 'grid', gap: '10px' }}>
                            {learningPath.steps.map(step => {
                                const marker = step.status === 'mastered' ? '✔' : step.status === 'learning' ? '▶' : '⬜';
                                return (
                                    <div key={`${step.order}-${step.concept}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#f8fafc' }}>
                                        <span style={{ color: '#1e293b', fontSize: '13px', fontWeight: 600 }}>
                                            {marker} {step.order}. {step.concept}
                                        </span>
                                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                                            {Math.round((step.mastery_score || 0) * 100)}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                            Learning path will appear after curriculum extraction from subject documents.
                        </div>
                    )}
                </motion.div>

                {curriculumList.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.38 }}
                        className="premium-card"
                        style={{ marginTop: '16px', padding: '16px 20px' }}
                    >
                        <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <BookOpen size={16} style={{ color: '#2563eb' }} />
                            Curriculum Progress
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                            {curriculumList.map(cur => {
                                const totalTopics = cur.modules.reduce((a, m) => a + m.topics.length, 0);
                                const completedTopics = cur.modules.reduce((a, m) => a + m.topics.filter(t => t.status === 'completed').length, 0);
                                const subjectPct = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;
                                return (
                                    <div key={cur.id}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>{cur.subject}</span>
                                            <span style={{ fontSize: '12px', color: '#64748b' }}>{completedTopics}/{totalTopics} topics</span>
                                        </div>
                                        <div style={{ display: 'grid', gap: '8px' }}>
                                            {cur.modules.map(mod => {
                                                const modTotal = mod.topics.length;
                                                const modDone = mod.topics.filter(t => t.status === 'completed').length;
                                                const modStudied = mod.topics.filter(t => t.status !== 'not_started').length;
                                                const modPct = modTotal > 0 ? Math.round((modDone / modTotal) * 100) : 0;
                                                const barColor = modDone === modTotal && modTotal > 0
                                                    ? 'linear-gradient(90deg, #22c55e, #10b981)'
                                                    : modStudied > 0
                                                        ? 'linear-gradient(90deg, #f59e0b, #eab308)'
                                                        : '#e2e8f0';
                                                return (
                                                    <div key={mod.id} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#f8fafc' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{mod.name}</span>
                                                            <span style={{ fontSize: '11px', color: '#64748b' }}>{modDone}/{modTotal} done · {modPct}%</span>
                                                        </div>
                                                        <div style={{ height: '6px', borderRadius: '4px', background: '#e2e8f0', overflow: 'hidden' }}>
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${modPct}%` }}
                                                                transition={{ duration: 0.8, ease: 'easeOut' }}
                                                                style={{ height: '100%', background: barColor, borderRadius: '4px' }}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px', marginTop: '16px' }}>
                    {/* Proficiency Detailed */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="premium-card"
                        style={{ gridColumn: 'span 8', padding: '16px 20px' }}
                    >
                        <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '16px' }}>Subject Analysis</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {data.stats.map(s => (
                                <div key={s.topic}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '4px' }}>
                                        <div>
                                            <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155', display: 'block' }}>{s.topic}</span>
                                            <span style={{ fontSize: '11px', color: '#64748b' }}>{s.score}/{s.total} Correct</span>
                                        </div>
                                        <span style={{ fontSize: '13px', fontWeight: '800', color: '#1e293b' }}>{Math.round(s.proficiency)}%</span>
                                    </div>
                                    <div className="proficiency-bar-container">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${s.proficiency}%` }}
                                            transition={{ duration: 1, ease: 'easeOut' }}
                                            style={{
                                                height: '100%',
                                                background: s.proficiency >= 75 ? 'linear-gradient(90deg, #22c55e, #10b981)' : s.proficiency >= 45 ? 'linear-gradient(90deg, #f59e0b, #eab308)' : 'linear-gradient(90deg, #ef4444, #f87171)',
                                                borderRadius: '6px'
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                            {data.stats.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                                    <Brain size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                    <p>Engage with the assistant to populate your learning profile.</p>
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {/* Overall Accuracy */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="premium-card"
                        style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '16px' }}
                    >
                        <h3 className="stat-label" style={{ marginBottom: '12px' }}>Accuracy</h3>
                        <div style={{ position: 'relative', width: '110px', height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {/* Simple CSS Circle for accuracy */}
                            <svg style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                                <circle cx="55" cy="55" r="48" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                                <motion.circle
                                    cx="55" cy="55" r="48" fill="none" stroke="#2563eb" strokeWidth="8"
                                    strokeDasharray="301"
                                    initial={{ strokeDashoffset: 301 }}
                                    animate={{ strokeDashoffset: 301 - (301 * data.quiz.accuracy / 100) }}
                                    transition={{ duration: 1.5, ease: 'easeInOut' }}
                                    strokeLinecap="round"
                                />
                            </svg>
                            <div style={{ position: 'absolute', textAlign: 'center' }}>
                                <span style={{ fontSize: '22px', fontWeight: '800', color: '#1e293b' }}>{Math.round(data.quiz.accuracy)}%</span>
                            </div>
                        </div>
                        <p style={{ marginTop: '12px', fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
                            Across <strong>{data.quiz.total}</strong> points
                        </p>
                    </motion.div>

                    {/* Quick History List */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        className="premium-card"
                        style={{ gridColumn: 'span 6', padding: '16px 20px' }}
                    >
                        <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '16px' }}>Evaluation Journal</h3>
                        <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
                            {data.recent_quizzes.map((q, idx) => (
                                <div key={idx} className={`history-item-row ${q.is_correct ? 'correct' : 'incorrect'}`}>
                                    <div>
                                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>{q.topic}</span>
                                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{new Date(q.timestamp).toLocaleDateString()} • {q.subject}</span>
                                    </div>
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        color: q.is_correct ? '#16a34a' : '#dc2626',
                                        background: q.is_correct ? '#dcfce7' : '#fee2e2',
                                        padding: '4px 10px',
                                        borderRadius: '12px'
                                    }}>
                                        {q.is_correct ? 'PASSED' : 'FAILED'}
                                    </span>
                                </div>
                            ))}
                            {data.recent_quizzes.length === 0 && <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>No evaluation results recorded.</div>}
                        </div>
                    </motion.div>

                    {/* Chat Snapshots */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                        className="premium-card"
                        style={{ gridColumn: 'span 6', padding: '0' }}
                    >
                        <div style={{ padding: '16px 20px 0 20px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '14px' }}>Interactions</h3>
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {data.recent_chats.slice(0, 10).map((c, idx) => (
                                <div key={idx} className="chat-log-item" style={{ padding: '12px 20px' }}>
                                    <div className={`role-tag ${c.role === 'ai' ? 'role-ai' : 'role-user'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                                        {c.role === 'ai' ? 'AI' : 'YOU'}
                                    </div>
                                    <div style={{ overflow: 'hidden' }}>
                                        <p style={{ fontSize: '11px', color: '#334155', lineHeight: '1.5' }}>{truncate(c.content, 120)}</p>
                                    </div>
                                </div>
                            ))}
                            {data.recent_chats.length === 0 && <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>Empty.</div>}
                        </div>
                    </motion.div>
                </div>
            </main>
        </div>
    );
};

export default Dashboard;

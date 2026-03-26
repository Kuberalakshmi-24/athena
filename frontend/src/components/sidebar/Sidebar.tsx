import React from 'react';
import { LayoutDashboard, LogOut, Trash2 } from 'lucide-react';
import RoadmapPanel, { CurriculumData, CurriculumModule, CurriculumTopic } from './RoadmapPanel';

interface SidebarProps {
    username?: string;
    level: string;
    currentTopic: string;
    selectedSubject: string;
    curriculum?: CurriculumData | null;
    isGeneratingCurriculum?: boolean;
    lastTaughtTopic?: CurriculumTopic | null;
    onLogout: () => void;
    onGoDashboard: () => void;
    onClearChat: () => void;
    onUploadClick: () => void;
    onGenerateCurriculum?: () => void;
    onStudyTopic?: (topic: CurriculumTopic) => void;
    onMarkComplete?: (topic: CurriculumTopic) => void;
    onTopicQuiz?: (topic: CurriculumTopic) => void;
    onModuleQuiz?: (mod: CurriculumModule) => void;
    onFinalTest?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
    username,
    level,
    currentTopic,
    selectedSubject,
    curriculum = null,
    isGeneratingCurriculum = false,
    lastTaughtTopic = null,
    onLogout,
    onGoDashboard,
    onClearChat,
    onUploadClick,
    onGenerateCurriculum,
    onStudyTopic,
    onMarkComplete,
    onTopicQuiz,
    onModuleQuiz,
    onFinalTest,
}) => {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="logo">Athena</div>
                <button onClick={onLogout} className="logout-trigger" title="Logout">
                    <LogOut size={18} />
                </button>
            </div>

            <div className="stat-card" style={{ padding: '10px 12px' }}>
                {/* Row: avatar + name + dashboard icon */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' }}>
                    <div className="user-avatar" style={{ width: '30px', height: '30px', fontSize: '12px', flexShrink: 0 }}>
                        {username?.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</div>
                        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.38)', letterSpacing: '0.5px' }}>Adaptive Learner</div>
                    </div>
                    <button
                        onClick={onGoDashboard}
                        title="My Dashboard"
                        style={{ flexShrink: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', padding: '5px 7px', cursor: 'pointer', color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center' }}
                    >
                        <LayoutDashboard size={13} />
                    </button>
                </div>
                {/* 3-column metrics grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Level</div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: level === 'Advanced' ? '#4ade80' : level === 'Intermediate' ? '#facc15' : '#a78bfa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{level}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '5px 4px', textAlign: 'center', overflow: 'hidden' }}>
                        <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Topic</div>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={currentTopic}>{currentTopic}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '5px 4px', textAlign: 'center', overflow: 'hidden' }}>
                        <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Session</div>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: selectedSubject ? '#60a5fa' : 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedSubject}>{selectedSubject || 'None'}</div>
                    </div>
                </div>
            </div>

            {/* Curriculum Roadmap Panel — flex-grow fills remaining sidebar space */}
            {onGenerateCurriculum && onStudyTopic && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <RoadmapPanel
                    curriculum={curriculum}
                    isGenerating={isGeneratingCurriculum}
                    selectedSubject={selectedSubject}
                    lastTaughtTopic={lastTaughtTopic}
                    onGenerate={onGenerateCurriculum}
                    onStudyTopic={onStudyTopic}
                    onMarkComplete={onMarkComplete}
                    onTopicQuiz={onTopicQuiz}
                    onModuleQuiz={onModuleQuiz}
                    onFinalTest={onFinalTest}
                />
            </div>
            )}

            <div className="stat-card" style={{ marginTop: 'auto', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                <button
                    onClick={onClearChat}
                    className="upload-btn"
                    style={{ width: '100%', fontSize: '12px', color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '8px', height: '36px' }}
                >
                    <Trash2 size={14} /> Clear Chat
                </button>
            </div>

            <div style={{ marginTop: 'auto', fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center' }}>
                Powered by Groq & RAG
            </div>
        </aside>
    );
};

export default React.memo(Sidebar);

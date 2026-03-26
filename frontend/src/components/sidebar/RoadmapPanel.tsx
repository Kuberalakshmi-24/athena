import React, { useState } from 'react';
import { BookOpen, CheckCircle, Circle, Clock, ChevronDown, ChevronRight, Zap, RefreshCw, ClipboardList, Trophy } from 'lucide-react';

export interface CurriculumTopic {
    id: number;
    name: string;
    difficulty: 'easy' | 'medium' | 'hard';
    status: 'not_started' | 'in_progress' | 'completed';
    score: number;
}

export interface CurriculumModule {
    id: number;
    name: string;
    order: number;
    topics: CurriculumTopic[];
}

export interface CurriculumData {
    id: number;
    subject: string;
    generated_at: string;
    modules: CurriculumModule[];
}

interface RoadmapPanelProps {
    curriculum: CurriculumData | null;
    isGenerating: boolean;
    selectedSubject: string;
    lastTaughtTopic?: CurriculumTopic | null;
    onGenerate: () => void;
    onStudyTopic: (topic: CurriculumTopic) => void;
    onMarkComplete?: (topic: CurriculumTopic) => void;
    onTopicQuiz?: (topic: CurriculumTopic) => void;
    onModuleQuiz?: (mod: CurriculumModule) => void;
    onFinalTest?: () => void;
}

const DIFFICULTY_COLORS: Record<string, string> = {
    easy: '#4ade80',
    medium: '#facc15',
    hard: '#f87171',
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
    if (status === 'completed') return <CheckCircle size={12} color="#4ade80" style={{ flexShrink: 0 }} />;
    if (status === 'in_progress') return <Clock size={12} color="#facc15" style={{ flexShrink: 0 }} />;
    return <Circle size={12} color="rgba(255,255,255,0.25)" style={{ flexShrink: 0 }} />;
};

const RoadmapPanel: React.FC<RoadmapPanelProps> = ({
    curriculum,
    isGenerating,
    selectedSubject,
    lastTaughtTopic = null,
    onGenerate,
    onStudyTopic,
    onMarkComplete,
    onTopicQuiz,
    onModuleQuiz,
    onFinalTest,
}) => {
    const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set([0]));

    // Tracks which module IDs have already been seen as fully-completed so we only
    // trigger the "close completed → open next" animation on the transition, not on load.
    const completedModuleIdsRef = React.useRef<Set<number>>(new Set());
    // Tracks the curriculum ID so we can re-initialise when a new curriculum is generated.
    const prevCurriculumIdRef = React.useRef<number | null>(null);
    // Track the previously-active module index so we can collapse it when the topic moves.
    const prevActiveModIdxRef = React.useRef<number>(-1);

    // On curriculum (re-)load: expand the first module that still has incomplete topics.
    // Also initialise completedModuleIdsRef so we don't fire the "newly done" logic for
    // modules that were already complete when the curriculum was loaded.
    React.useEffect(() => {
        if (!curriculum) return;
        if (prevCurriculumIdRef.current === curriculum.id) return;
        prevCurriculumIdRef.current = curriculum.id;

        // Seed the completed-set with already-done modules (no transition needed for these).
        completedModuleIdsRef.current = new Set(
            curriculum.modules
                .filter(m => m.topics.length > 0 && m.topics.every(t => t.status === 'completed'))
                .map(m => m.id)
        );

        // Open the first module that still has work to do.
        const firstIncompleteIdx = curriculum.modules.findIndex(
            m => !(m.topics.length > 0 && m.topics.every(t => t.status === 'completed'))
        );
        setExpandedModules(new Set([firstIncompleteIdx !== -1 ? firstIncompleteIdx : 0]));
        prevActiveModIdxRef.current = -1;
    }, [curriculum]);

    // When a module transitions to fully-completed: collapse it and open the next one.
    React.useEffect(() => {
        if (!curriculum) return;
        const newlyCompleted: number[] = [];
        curriculum.modules.forEach((mod, idx) => {
            const allDone = mod.topics.length > 0 && mod.topics.every(t => t.status === 'completed');
            if (allDone && !completedModuleIdsRef.current.has(mod.id)) {
                newlyCompleted.push(idx);
                completedModuleIdsRef.current.add(mod.id);
            }
        });
        if (newlyCompleted.length === 0) return;
        setExpandedModules(prev => {
            const next = new Set(prev);
            newlyCompleted.forEach(idx => {
                next.delete(idx); // collapse the just-completed module
                // Open the next incomplete module so the learner can continue right away.
                const nextIdx = curriculum.modules.findIndex(
                    (m, i) => i > idx && !(m.topics.length > 0 && m.topics.every(t => t.status === 'completed'))
                );
                if (nextIdx !== -1) next.add(nextIdx);
            });
            return next;
        });
        prevActiveModIdxRef.current = -1; // reset so the next taught topic re-triggers expansion
    }, [curriculum]);

    // Auto-expand the module containing the currently-taught topic, collapse the old one.
    React.useEffect(() => {
        if (!curriculum) return;
        const newIdx = lastTaughtTopic
            ? curriculum.modules.findIndex(m => m.topics.some(t => t.id === lastTaughtTopic.id))
            : -1;
        const oldIdx = prevActiveModIdxRef.current;

        if (newIdx !== -1 && newIdx !== oldIdx) {
            prevActiveModIdxRef.current = newIdx;
            setExpandedModules(prev => {
                const next = new Set(prev);
                // Collapse the old active module (unless the user opened it manually — we
                // only close it if it was previously set as the "active" one).
                if (oldIdx !== -1) next.delete(oldIdx);
                next.add(newIdx);
                return next;
            });
        }
    }, [lastTaughtTopic, curriculum]);

    const toggleModule = (idx: number) => {
        setExpandedModules(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const moduleProgress = (mod: CurriculumModule) => {
        const completed = mod.topics.filter(t => t.status === 'completed').length;
        const studied = mod.topics.filter(t => t.status !== 'not_started').length;
        return { completed, studied, total: mod.topics.length };
    };

    const totalTopics = curriculum?.modules.reduce((a, m) => a + m.topics.length, 0) ?? 0;
    const completedTopics = curriculum?.modules.reduce(
        (a, m) => a + m.topics.filter(t => t.status === 'completed').length,
        0
    ) ?? 0;
    // All topics in every module are completed → show Final Test button
    const allModulesComplete = curriculum
        ? curriculum.modules.length > 0 && curriculum.modules.every(m => m.topics.length > 0 && m.topics.every(t => t.status === 'completed'))
        : false;

    return (
        <div
            className="stat-card"
            style={{ gap: '10px', display: 'flex', flexDirection: 'column', padding: '14px 12px', flex: 1, minHeight: 0, height: '100%' }}
        >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                    className="stat-label"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}
                >
                    <BookOpen size={12} />
                    Learning Roadmap
                </span>
                {curriculum && (
                    <button
                        onClick={onGenerate}
                        disabled={isGenerating}
                        title="Regenerate curriculum"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: isGenerating ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.4)',
                            cursor: isGenerating ? 'not-allowed' : 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                        }}
                    >
                        <RefreshCw size={12} style={{ animation: isGenerating ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                )}
            </div>

            {/* Overall progress bar */}
            {curriculum && totalTopics > 0 && (
                <div>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '10px',
                            color: 'rgba(255,255,255,0.4)',
                            marginBottom: '4px',
                        }}
                    >
                        <span>{completedTopics}/{totalTopics} topics</span>
                        <span>{Math.round((completedTopics / totalTopics) * 100)}%</span>
                    </div>
                    <div
                        style={{
                            height: '3px',
                            borderRadius: '2px',
                            background: 'rgba(255,255,255,0.08)',
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            style={{
                                height: '100%',
                                width: `${(completedTopics / totalTopics) * 100}%`,
                                background: 'linear-gradient(90deg, #3b82f6, #4ade80)',
                                borderRadius: '2px',
                                transition: 'width 0.4s ease',
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Generate button when no curriculum */}
            {!curriculum && (
                <button
                    onClick={onGenerate}
                    disabled={isGenerating || !selectedSubject}
                    style={{
                        width: '100%',
                        fontSize: '12px',
                        height: '36px',
                        background: isGenerating || !selectedSubject
                            ? 'rgba(255,255,255,0.05)'
                            : 'rgba(37,99,235,0.3)',
                        border: '1px solid rgba(96,165,250,0.3)',
                        color: !selectedSubject ? 'rgba(255,255,255,0.3)' : 'white',
                        borderRadius: '10px',
                        cursor: isGenerating || !selectedSubject ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'background 0.2s',
                    }}
                >
                    <Zap size={13} />
                    {isGenerating
                        ? 'Generating curriculum...'
                        : !selectedSubject
                        ? 'Select a subject first'
                        : 'Generate Curriculum'}
                </button>
            )}

            {/* Module list */}
            {curriculum && (
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        flex: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        paddingRight: '4px',
                    }}
                >
                    {curriculum.modules.map((mod, idx) => {
                        const { completed, studied, total } = moduleProgress(mod);
                        const expanded = expandedModules.has(idx);
                        const allDone = completed === total && total > 0;
                        // Show module quiz button when all topics studied (in_progress or completed)
                        const allStudied = studied === total && total > 0;
                        const isActiveModule = lastTaughtTopic != null && mod.topics.some(t => t.id === lastTaughtTopic.id);

                        return (
                            <div key={mod.id}>
                                {/* Module header button */}
                                <button
                                    onClick={() => toggleModule(idx)}
                                    style={{
                                        width: '100%',
                                        background: allDone
                                            ? 'rgba(74,222,128,0.08)'
                                            : isActiveModule
                                            ? 'rgba(59,130,246,0.08)'
                                            : 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${allDone ? 'rgba(74,222,128,0.15)' : isActiveModule ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.07)'}`,
                                        borderRadius: '8px',
                                        padding: '7px 9px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        color: 'white',
                                        textAlign: 'left',
                                        gap: '6px',
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            flex: 1,
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {allDone ? (
                                            <CheckCircle size={11} color="#4ade80" style={{ flexShrink: 0 }} />
                                        ) : (
                                            <div
                                                style={{
                                                    width: '11px',
                                                    height: '11px',
                                                    borderRadius: '50%',
                                                    border: '1.5px solid rgba(255,255,255,0.2)',
                                                    flexShrink: 0,
                                                }}
                                            />
                                        )}
                                        <span
                                            style={{
                                                fontSize: '11px',
                                                fontWeight: '600',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {mod.name}
                                        </span>
                                    </div>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                                            {completed}/{total}
                                        </span>
                                        {expanded ? (
                                            <ChevronDown size={11} color="rgba(255,255,255,0.5)" />
                                        ) : (
                                            <ChevronRight size={11} color="rgba(255,255,255,0.5)" />
                                        )}
                                    </div>
                                </button>

                                {/* Topics list */}
                                {expanded && (
                                    <div
                                        style={{
                                            paddingLeft: '10px',
                                            paddingTop: '3px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '2px',
                                        }}
                                    >
                                        {mod.topics.map(topic => {
                                            const isActive = lastTaughtTopic?.id === topic.id;
                                            return (
                                                <div key={topic.id}>
                                                    {/* Topic row */}
                                                    <button
                                                        onClick={() => onStudyTopic(topic)}
                                                        title={`Study: ${topic.name}`}
                                                        style={{
                                                            width: '100%',
                                                            background:
                                                                isActive && topic.status !== 'completed'
                                                                    ? 'rgba(59,130,246,0.12)'
                                                                    : topic.status === 'completed'
                                                                    ? 'rgba(74,222,128,0.05)'
                                                                    : topic.status === 'in_progress'
                                                                    ? 'rgba(250,204,21,0.07)'
                                                                    : 'transparent',
                                                            border: `1px solid ${
                                                                isActive && topic.status !== 'completed'
                                                                    ? 'rgba(59,130,246,0.4)'
                                                                    : topic.status === 'completed'
                                                                    ? 'rgba(74,222,128,0.12)'
                                                                    : topic.status === 'in_progress'
                                                                    ? 'rgba(250,204,21,0.15)'
                                                                    : 'transparent'
                                                            }`,
                                                            borderRadius: '6px',
                                                            padding: '5px 8px',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            color:
                                                                topic.status === 'completed'
                                                                    ? 'rgba(255,255,255,0.35)'
                                                                    : 'rgba(255,255,255,0.82)',
                                                            textAlign: 'left',
                                                            gap: '6px',
                                                            transition: 'background 0.15s',
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                                            <StatusIcon status={topic.status} />
                                                                <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {topic.name}
                                                                </span>
                                                                {isActive && topic.status !== 'completed' && (
                                                                    <span style={{
                                                                        flexShrink: 0,
                                                                        fontSize: '8px',
                                                                        fontWeight: 700,
                                                                        letterSpacing: '0.5px',
                                                                        padding: '1px 4px',
                                                                        borderRadius: '3px',
                                                                        background: 'rgba(59,130,246,0.25)',
                                                                        color: '#93c5fd',
                                                                        border: '1px solid rgba(59,130,246,0.4)',
                                                                        textTransform: 'uppercase' as const,
                                                                        animation: 'nowPulse 2s ease-in-out infinite',
                                                                    }}>NOW</span>
                                                                )}
                                                        </div>
                                                        <span
                                                            style={{
                                                                fontSize: '9px',
                                                                fontWeight: '700',
                                                                padding: '2px 5px',
                                                                borderRadius: '4px',
                                                                background: `${DIFFICULTY_COLORS[topic.difficulty]}18`,
                                                                color: DIFFICULTY_COLORS[topic.difficulty],
                                                                flexShrink: 0,
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.4px',
                                                            }}
                                                        >
                                                            {topic.difficulty}
                                                        </span>
                                                    </button>

                                                    {/* Post-lesson action row — shown for the topic just taught */}
                                                    {isActive && topic.status !== 'completed' && (onMarkComplete || onTopicQuiz) && (
                                                        <div style={{ display: 'flex', gap: '4px', paddingLeft: '4px', paddingTop: '3px', paddingBottom: '2px' }}>
                                                            {onMarkComplete && (
                                                                <button
                                                                    onClick={() => onMarkComplete(topic)}
                                                                    title="Mark as completed"
                                                                    style={{
                                                                        flex: 1,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        gap: '4px',
                                                                        fontSize: '10px',
                                                                        padding: '4px 6px',
                                                                        borderRadius: '5px',
                                                                        border: '1px solid rgba(74,222,128,0.3)',
                                                                        background: 'rgba(74,222,128,0.1)',
                                                                        color: '#4ade80',
                                                                        cursor: 'pointer',
                                                                        fontWeight: '600',
                                                                        whiteSpace: 'nowrap',
                                                                    }}
                                                                >
                                                                    <CheckCircle size={9} /> Done
                                                                </button>
                                                            )}
                                                            {onTopicQuiz && (
                                                                <button
                                                                    onClick={() => onTopicQuiz(topic)}
                                                                    title="Take topic quiz"
                                                                    style={{
                                                                        flex: 1,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        gap: '4px',
                                                                        fontSize: '10px',
                                                                        padding: '4px 6px',
                                                                        borderRadius: '5px',
                                                                        border: '1px solid rgba(96,165,250,0.3)',
                                                                        background: 'rgba(96,165,250,0.1)',
                                                                        color: '#60a5fa',
                                                                        cursor: 'pointer',
                                                                        fontWeight: '600',
                                                                        whiteSpace: 'nowrap',
                                                                    }}
                                                                >
                                                                    <ClipboardList size={9} /> Quiz
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {/* Module Quiz button — shown when all topics are studied */}
                                        {allStudied && onModuleQuiz && (
                                            <button
                                                onClick={() => onModuleQuiz(mod)}
                                                style={{
                                                    marginTop: '4px',
                                                    width: '100%',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '5px',
                                                    fontSize: '10px',
                                                    padding: '5px 8px',
                                                    borderRadius: '6px',
                                                    border: '1px solid rgba(168,85,247,0.35)',
                                                    background: 'rgba(168,85,247,0.1)',
                                                    color: '#c084fc',
                                                    cursor: 'pointer',
                                                    fontWeight: '700',
                                                }}
                                            >
                                                <ClipboardList size={10} /> Module Quiz
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Final Test button — shown when all modules are fully completed */}
            {allModulesComplete && onFinalTest && (
                <button
                    onClick={onFinalTest}
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(251,191,36,0.4)',
                        background: 'rgba(251,191,36,0.12)',
                        color: '#fbbf24',
                        cursor: 'pointer',
                        fontWeight: '700',
                        letterSpacing: '0.3px',
                    }}
                >
                    <Trophy size={12} /> Take Final Test
                </button>
            )}
        </div>
    );
};

export default RoadmapPanel;

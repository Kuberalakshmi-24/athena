import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from '../sidebar/Sidebar';
import MessageList from './MessageList';
import QuizCard from './QuizCard';
import ChatInput from './ChatInput';
import { parseQuiz, stripQuizFromDisplay } from '../../utils/quizParser';
import { ChatMessage, QuizState } from './types';
import {
    clearChatHistory,
    fetchChatHistory,
    fetchSubjects,
    generateCurriculum,
    fetchCurriculum,
    teachTopicStream,
    topicQuizStream,
    moduleQuizStream,
    finalTestStream,
    updateTopicProgressCurriculum,
    loadSubject,
    queryAIStream,
    updateLevel,
    uploadMaterial,
    saveUserSubject
} from '../../services/api';
import { CurriculumData, CurriculumModule, CurriculumTopic } from '../sidebar/RoadmapPanel';
import '../../index.css';

class MessagesErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean }
> {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
                    <p style={{ fontWeight: 600 }}>Something went wrong displaying messages.</p>
                    <button
                        onClick={() => this.setState({ hasError: false })}
                        style={{ marginTop: '12px', padding: '8px 20px', borderRadius: '8px', border: '1px solid #dc2626', background: 'white', color: '#dc2626', cursor: 'pointer' }}
                    >Retry</button>
                </div>
            );
        }
        return this.props.children;
    }
}

const THINKING_PLACEHOLDER = 'Athena is thinking...';

const createMessage = (sender: 'user' | 'ai', text: string, isTyping = false): ChatMessage => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sender,
    text,
    isTyping
});

const getSubjectStorageKey = (username?: string) =>
    username ? `athena_sel_subject_${username}` : 'athena_sel_subject';

const getStoredSubjectForUser = (username?: string): string => {
    const key = getSubjectStorageKey(username);
    return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
};

const Chat: React.FC = () => {
    const { user, logout, authFetch, updateUser } = useAuth();
    const navigate = useNavigate();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [subjects, setSubjects] = useState<string[]>([]);
    const [selectedSubject, setSelectedSubject] = useState<string>(
        () => ''
    );
    const [level, setLevel] = useState<string>(user?.level || 'Beginner');
    const [currentTopic, setCurrentTopic] = useState<string>(
        () => sessionStorage.getItem('athena_current_topic') || user?.topic || 'General'
    );
    const [quiz, setQuiz] = useState<QuizState | null>(null);
    const [curriculum, setCurriculum] = useState<CurriculumData | null>(null);
    const [isGeneratingCurriculum, setIsGeneratingCurriculum] = useState(false);
    // Track the last topic that was taught so we can offer mark-complete / quiz
    const [lastTaughtTopic, setLastTaughtTopic] = useState<CurriculumTopic | null>(null);
    // Subject picker overlay — shown when no subject selected yet
    const [showSubjectPicker, setShowSubjectPicker] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isMountedRef = useRef(true);
    const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const watcherTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Auto-quiz trigger: set pending=true after a lesson finishes; useEffect fires the quiz
    const autoQuizRef = useRef<{ pending: boolean; topic: CurriculumTopic | null; isRetry: boolean }>({ pending: false, topic: null, isRetry: false });
    // Module quiz trigger: set to a module when all its topics are completed
    const pendingModuleQuizRef = useRef<CurriculumModule | null>(null);

    useEffect(() => {
        // Reset the mount flag every time the effect runs so React StrictMode's
        // double-invoke doesn't leave isMountedRef permanently false.
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (revealTimerRef.current) {
                clearInterval(revealTimerRef.current);
                revealTimerRef.current = null;
            }
            if (watcherTimerRef.current) {
                clearInterval(watcherTimerRef.current);
                watcherTimerRef.current = null;
            }
            if (activeReaderRef.current) {
                activeReaderRef.current.cancel().catch(() => undefined);
                activeReaderRef.current = null;
            }
        };
    }, []);

    const scrollToBottom = useCallback(() => {
        // Directly set scrollTop instead of scrollIntoView — scrollIntoView propagates
        // up the ancestor chain and can scroll the overflow:hidden parent (.chat-area),
        // which pushes the header off the top of the visible area (the blank-screen bug).
        const el = messagesContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const hydrateSubjects = useCallback(async () => {
        try {
            const response = await fetchSubjects(authFetch);
            const data = await response.json();
            if (response.ok) {
                setSubjects(data.subjects);
                // Subject must be scoped per-user; do not reuse another user's selection.
                const persistedSubject = user?.selected_subject || getStoredSubjectForUser(user?.username);
                if (persistedSubject) {
                    setSelectedSubject(persistedSubject);
                } else if (data.subjects.length > 0) {
                    setShowSubjectPicker(true);
                }
            }
        } catch (error) {
            console.error('Error fetching subjects:', error);
        }
    }, [authFetch, user?.selected_subject, user?.username]);

    const hydrateChatHistory = useCallback(async () => {
        try {
            const response = await fetchChatHistory(authFetch);
            const data = await response.json();
            if (response.ok && data.messages) {
                const formattedMessages: ChatMessage[] = data.messages.map((m: any) =>
                    createMessage(m.role, m.content, false)
                );
                if (formattedMessages.length > 0) {
                    setMessages(formattedMessages);
                }
            }
        } catch (error) {
            console.error('Error fetching chat history:', error);
        }
    }, [authFetch]);

    useEffect(() => {
        hydrateChatHistory();
        hydrateSubjects();
        const sessionTopic = sessionStorage.getItem('athena_current_topic');
        if (sessionTopic) setCurrentTopic(sessionTopic);
        else if (user?.topic) setCurrentTopic(user.topic);

        // Restore curriculum for the previously selected subject
        const savedSubj = user?.selected_subject || getStoredSubjectForUser(user?.username);
        if (savedSubj) {
            fetchCurriculum(authFetch, savedSubj)
                .then(r => r.json())
                .then(d => {
                    if (!isMountedRef.current) return;
                    if (d.curriculum) {
                        setCurriculum(d.curriculum);
                        const tid = sessionStorage.getItem('athena_last_topic_id');
                        if (tid) {
                            const id = +tid;
                            outer: for (const mod of (d.curriculum as CurriculumData).modules) {
                                for (const t of mod.topics) {
                                    if (t.id === id) { setLastTaughtTopic(t); break outer; }
                                }
                            }
                        }
                    }
                })
                .catch(() => {});
        }
    }, [hydrateChatHistory, hydrateSubjects, user?.topic, user?.selected_subject, user?.username, authFetch]);

    // Keep active topic scoped to browser session.
    useEffect(() => {
        if (currentTopic) sessionStorage.setItem('athena_current_topic', currentTopic);
        else sessionStorage.removeItem('athena_current_topic');
    }, [currentTopic]);

    // Persist selected subject to localStorage (survives browser close)
    useEffect(() => {
        if (selectedSubject) {
            const key = getSubjectStorageKey(user?.username);
            localStorage.setItem(key, selectedSubject);
            sessionStorage.setItem(key, selectedSubject);
        }
    }, [selectedSubject, user?.username]);

    // Persist last taught topic id so it survives navigation
    useEffect(() => {
        if (lastTaughtTopic) sessionStorage.setItem('athena_last_topic_id', String(lastTaughtTopic.id));
        else sessionStorage.removeItem('athena_last_topic_id');
    }, [lastTaughtTopic]);

    const handleClearChat = useCallback(async () => {
        if (!window.confirm('Are you sure you want to clear your chat history? Dashboard data will be preserved.')) return;
        try {
            const response = await clearChatHistory(authFetch);
            if (response.ok) {
                setMessages([createMessage('ai', 'Chat history cleared. How can I help you today?')]);
            }
        } catch (error) {
            console.error('Error clearing chat:', error);
        }
    }, [authFetch]);

    const handleSubjectSelect = useCallback(async (subject: string) => {
        if (!subject) return;
        try {
            const response = await loadSubject(authFetch, subject);
            const data = await response.json();
            if (response.ok) {
                setSelectedSubject(subject);
                setShowSubjectPicker(false);
                const key = getSubjectStorageKey(user?.username);
                localStorage.setItem(key, subject);
                sessionStorage.setItem(key, subject);
                try { await saveUserSubject(authFetch, subject); } catch { /* non-blocking */ }
                updateUser({ selected_subject: subject });
                setMessages(prev => [...prev, createMessage('ai', `Subject **${subject}** loaded! I'm ready to teach you. What would you like to start with?`)]);
                // Load curriculum for this subject automatically
                try {
                    const curRes = await fetchCurriculum(authFetch, subject);
                    const curData = await curRes.json();
                    if (curRes.ok && curData.curriculum) {
                        setCurriculum(curData.curriculum);
                    } else {
                        setCurriculum(null);
                    }
                } catch {
                    setCurriculum(null);
                }
            } else {
                alert(data.error);
            }
        } catch (error) {
            console.error('Error loading subject:', error);
        }
    }, [authFetch, updateUser]);

    const handleGenerateCurriculum = useCallback(async () => {
        if (!selectedSubject || isGeneratingCurriculum) return;
        setIsGeneratingCurriculum(true);
        try {
            const res = await generateCurriculum(authFetch, selectedSubject);
            const data = await res.json();
            if (res.ok && data.curriculum) {
                setCurriculum(data.curriculum);
                setMessages(prev => [
                    ...prev,
                    createMessage('ai', `📚 Curriculum for **${selectedSubject}** has been generated! Click any topic in the Roadmap panel to start studying.`)
                ]);
            } else {
                alert(`Failed to generate curriculum: ${data.error || 'Unknown error'}`);
            }
        } catch (e) {
            console.error('Curriculum generation error:', e);
        } finally {
            setIsGeneratingCurriculum(false);
        }
    }, [authFetch, selectedSubject, isGeneratingCurriculum]);

    const handleTeachTopic = useCallback(async (topic: CurriculumTopic, simplify = false) => {
        if (isLoading) return;
        setIsLoading(true);
        setLastTaughtTopic(topic);
        setCurrentTopic(topic.name);
        setMessages(prev => [
            ...prev,
            createMessage('ai', THINKING_PLACEHOLDER, true),
        ]);

        try {
            const response = await teachTopicStream(authFetch, {
                topic_id: topic.id,
                topic_name: topic.name,
                difficulty: topic.difficulty,
                subject: selectedSubject || 'General',
                simplify,
            });

            if (!response.ok) {
                const errData = await response.json();
                setMessages(prev => {
                    const copy = [...prev];
                    copy[copy.length - 1] = createMessage('ai', `Error: ${errData.error}`);
                    return copy;
                });
                return;
            }

            if (!response.body) return;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';
            let fullText = '';
            let revealBuf = '';
            let revealedText = '';
            let finalPayload: any = null;

            const updateMsg = (text: string, typing: boolean) => {
                if (!isMountedRef.current) return;
                setMessages(prev => {
                    const copy = [...prev];
                    copy[copy.length - 1] = { ...copy[copy.length - 1], text, isTyping: typing };
                    return copy;
                });
            };

            const stopReveal = () => {
                if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
            };

            const startReveal = () => {
                if (revealTimerRef.current) return;
                revealTimerRef.current = setInterval(() => {
                    if (!isMountedRef.current) { stopReveal(); return; }
                    if (!revealBuf && finalPayload) {
                        const fp = finalPayload; finalPayload = null; stopReveal();
                        const finalText = fp.final_response || fullText;
                        updateMsg(finalText, false);
                        setCurrentTopic(topic.name);
                        setCurriculum(prev => {
                            if (!prev) return prev;
                            return {
                                ...prev,
                                modules: prev.modules.map(mod => ({
                                    ...mod,
                                    topics: mod.topics.map(t =>
                                        t.id === topic.id && t.status === 'not_started'
                                            ? { ...t, status: 'in_progress' as const }
                                            : t
                                    ),
                                })),
                            };
                        });
                        autoQuizRef.current = { pending: true, topic, isRetry: simplify };
                        return;
                    }
                    if (!revealBuf) { stopReveal(); return; }
                    const batchSize = revealedText.length < 80 ? 2 : revealBuf.length > 200 ? 8 : 4;
                    const chunk = revealBuf.slice(0, batchSize);
                    revealBuf = revealBuf.slice(batchSize);
                    revealedText += chunk;
                    updateMsg(revealedText, true);
                }, 30);
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line.startsWith('data:')) continue;
                    const payload = JSON.parse(line.slice(5).trim());
                    if (payload.type === 'chunk') {
                        fullText += payload.content || '';
                        revealBuf += payload.content || '';
                        startReveal();
                    } else if (payload.type === 'done') {
                        finalPayload = payload;
                        startReveal();
                    } else if (payload.type === 'error') {
                        throw new Error(payload.error || 'Teaching failed');
                    }
                }
            }

            // Wait for reveal timer to drain
            await new Promise<void>(resolve => {
                const check = setInterval(() => {
                    if (!revealTimerRef.current && !finalPayload && !revealBuf) {
                        clearInterval(check); resolve();
                    }
                }, 50);
            });
        } catch (err) {
            if (!isMountedRef.current) return;
            setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...copy[copy.length - 1], text: 'Failed to load lesson. Please try again.', isTyping: false };
                return copy;
            });
        } finally {
            setIsLoading(false);
        }
    }, [authFetch, isLoading, selectedSubject]);

    const handleMarkComplete = useCallback(async (topic: CurriculumTopic) => {
        try {
            await updateTopicProgressCurriculum(authFetch, { topic_id: topic.id, status: 'completed', score: 1.0 });
        } catch { /* silent */ }

        setCurriculum(prev => {
            if (!prev) return prev;
            const updated = {
                ...prev,
                modules: prev.modules.map(mod => ({
                    ...mod,
                    topics: mod.topics.map(t =>
                        t.id === topic.id ? { ...t, status: 'completed' as const, score: 1.0 } : t
                    ),
                })),
            };

            // Check if all topics in the module are done → auto-trigger module quiz
            const parentMod = updated.modules.find(m => m.topics.some(t => t.id === topic.id));
            if (parentMod && parentMod.topics.every(t => t.status === 'completed')) {
                pendingModuleQuizRef.current = parentMod;
            }

            return updated;
        });

        setMessages(prev => [
            ...prev,
            createMessage('ai', `✔ **${topic.name}** marked as completed! Great work — keep going.`),
        ]);
        setLastTaughtTopic(null);
    }, [authFetch]);

    const streamQuizOrTest = useCallback(async (
        fetchFn: () => Promise<Response>,
        userLabel: string,
        quizType: 'topic_quiz' | 'module_quiz' | 'final_test'
    ) => {
        if (isLoading) return;
        setIsLoading(true);
        setMessages(prev => [
            ...prev,
            createMessage('ai', THINKING_PLACEHOLDER, true),
        ]);
        try {
            const response = await fetchFn();
            if (!response.ok || !response.body) {
                setMessages(prev => {
                    const copy = [...prev];
                    copy[copy.length - 1] = createMessage('ai', 'Failed to generate quiz. Please try again.');
                    return copy;
                });
                return;
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line.startsWith('data:')) continue;
                    const payload = JSON.parse(line.slice(5).trim());
                    if (payload.type === 'chunk') {
                        fullText += payload.content || '';
                        if (!isMountedRef.current) break;
                        const chunkSnapshot = fullText;
                        setMessages(prev => {
                            const copy = [...prev];
                            copy[copy.length - 1] = { ...copy[copy.length - 1], text: chunkSnapshot, isTyping: true };
                            return copy;
                        });
                    } else if (payload.type === 'done') {
                        const finalText = payload.final_response || fullText;
                        const detectedQuiz = parseQuiz(finalText);
                        const cleanText = stripQuizFromDisplay(finalText, detectedQuiz?.fullText);
                        setMessages(prev => {
                            if (prev.length === 0) return prev;
                            const copy = [...prev];
                            if (!cleanText) {
                                // Quiz-only response: if prior messages exist, remove the placeholder;
                                // otherwise replace it with a brief intro so the messages area isn't empty.
                                if (copy.length > 1) return copy.slice(0, -1);
                                copy[copy.length - 1] = { ...copy[copy.length - 1], text: '📝 Here\'s your quiz!', isTyping: false };
                            } else {
                                copy[copy.length - 1] = { ...copy[copy.length - 1], text: cleanText, isTyping: false };
                            }
                            return copy;
                        });
                        if (detectedQuiz) setQuiz({ ...detectedQuiz, quizType });
                    } else if (payload.type === 'error') {
                        throw new Error(payload.error || 'Quiz generation failed');
                    }
                }
            }
        } catch {
            if (!isMountedRef.current) return;
            setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...copy[copy.length - 1], text: 'Failed to generate quiz.', isTyping: false };
                return copy;
            });
        } finally {
            setIsLoading(false);
        }
    }, [isLoading]);

    const handleTopicQuiz = useCallback((topic: CurriculumTopic, isRetry = false) => {
        streamQuizOrTest(
            () => topicQuizStream(authFetch, { topic_id: topic.id, topic_name: topic.name, difficulty: topic.difficulty, subject: selectedSubject || 'General', is_retry: isRetry }),
            `📝 Topic Quiz: ${topic.name}`,
            'topic_quiz'
        );
    }, [authFetch, selectedSubject, streamQuizOrTest]);

    // Fire auto-quiz once the lesson finishes loading
    useEffect(() => {
        if (!isLoading && autoQuizRef.current.pending && autoQuizRef.current.topic) {
            const ar = { ...autoQuizRef.current };
            autoQuizRef.current = { pending: false, topic: null, isRetry: false };
            const timer = window.setTimeout(() => {
                if (isMountedRef.current) {
                    setMessages(prev => [...prev, createMessage('ai', `📝 Quick check! Let's test your understanding of **${ar.topic!.name}**...`)]);
                    handleTopicQuiz(ar.topic!, ar.isRetry);
                }
            }, 800);
            return () => window.clearTimeout(timer);
        }
    }, [isLoading, handleTopicQuiz]);

    const handleModuleQuiz = useCallback((mod: CurriculumModule) => {
        streamQuizOrTest(
            () => moduleQuizStream(authFetch, { module_id: mod.id, module_name: mod.name, subject: selectedSubject || 'General' }),
            `📋 Module Quiz: ${mod.name}`,
            'module_quiz'
        );
    }, [authFetch, selectedSubject, streamQuizOrTest]);

    // Fire module quiz when pendingModuleQuizRef is set and we are not currently loading
    useEffect(() => {
        if (!isLoading && pendingModuleQuizRef.current) {
            const mod = pendingModuleQuizRef.current;
            pendingModuleQuizRef.current = null;
            const timer = window.setTimeout(() => {
                if (!isMountedRef.current) return;
                setMessages(prev => [...prev, createMessage('ai', `🎯 You've completed all topics in **${mod.name}**! Let's do the module quiz.`)]);
                handleModuleQuiz(mod);
            }, 900);
            return () => window.clearTimeout(timer);
        }
    }, [isLoading, handleModuleQuiz]);

    const handleFinalTest = useCallback(() => {
        if (!curriculum) return;
        streamQuizOrTest(
            () => finalTestStream(authFetch, { subject: selectedSubject || 'General', curriculum_id: curriculum.id }),
            `🏆 Final Test: ${selectedSubject || 'General'}`,
            'final_test'
        );
    }, [authFetch, curriculum, selectedSubject, streamQuizOrTest]);

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;

        try {
            const response = await uploadMaterial(authFetch, e.target.files[0], selectedSubject || 'General');
            const data = await response.json();
            if (response.ok) {
                setMessages(prev => [...prev, createMessage('ai', 'Document loaded! How can I help you today?')]);
            } else {
                alert(data.error);
            }
        } catch (error) {
            console.error('Error uploading file:', error);
        }
    }, [authFetch, selectedSubject]);

    const handleQuizAnswer = useCallback(async (answer: string) => {
        if (!quiz) return;

        const currentQ = quiz.questions[quiz.currentIndex];

        let isCorrect: boolean;
        if (currentQ.isOpenEnded) {
            isCorrect = true;
        } else {
            const selectedLetter = (answer.match(/^([A-C])\)/i)?.[1] || '').toUpperCase();
            isCorrect = selectedLetter !== '' && selectedLetter === currentQ.correct;
        }

        const newResults = [...quiz.results, isCorrect];
        const nextIndex = quiz.currentIndex + 1;

        if (nextIndex < quiz.questions.length) {
            setQuiz({ ...quiz, currentIndex: nextIndex, results: newResults });
            if (currentQ.isOpenEnded) {
                setMessages(prev => [...prev, createMessage('user', answer)]);
            }
            return;
        }

        // Quiz finished — compute score
        const mcQuestions = quiz.questions.filter(q => !q.isOpenEnded);
        const mcResults = newResults.filter((_, i) => !quiz.questions[i]?.isOpenEnded);
        const correctCount = mcResults.filter(r => r).length;
        const mcTotal = mcQuestions.length;
        const openCount = quiz.questions.filter(q => q.isOpenEnded).length;
        const scorePercent = mcTotal > 0 ? Math.round((correctCount / mcTotal) * 100) : 100;

        const scoreLine = mcTotal > 0 ? `You got **${correctCount}/${mcTotal}** correct (${scorePercent}%).` : '';
        const openLine = openCount > 0 ? `You answered **${openCount}** open-ended question${openCount > 1 ? 's' : ''}.` : '';
        const typeLabel = quiz.quizType === 'final_test' ? '🏆 Final Test Complete!' : quiz.quizType === 'module_quiz' ? '📋 Module Quiz Complete!' : '📝 Topic Quiz Complete!';
        const feedback = scorePercent >= 80 ? '🌟 Excellent work!' : scorePercent >= 60 ? '👍 Good effort — almost there!' : '💪 Let\'s review this again!';

        const resultMsg = currentQ.isOpenEnded
            ? [createMessage('user', answer), createMessage('ai', `${typeLabel}\n\n${scoreLine}${scoreLine && openLine ? '\n' : ''}${openLine}\n\n${feedback}`)]
            : [createMessage('ai', `${typeLabel}\n\n${scoreLine}${scoreLine && openLine ? '\n' : ''}${openLine}\n\n${feedback}`)];
        setMessages(prev => [...prev, ...resultMsg]);
        setQuiz(null);

        // Update user level
        const total = mcTotal > 0 ? mcTotal : quiz.questions.length;
        const correct = mcTotal > 0 ? correctCount : quiz.questions.length;
        try {
            await updateLevel(authFetch, { correct, total, subject: selectedSubject, topic: currentTopic });
        } catch (error) {
            console.error('Error updating level:', error);
        }

        // Adaptive flow for topic quizzes
        if (quiz.quizType === 'topic_quiz' && lastTaughtTopic) {
            const completedTopic = lastTaughtTopic;
            if (scorePercent >= 80) {
                // Auto-mark topic complete
                try {
                    await updateTopicProgressCurriculum(authFetch, { topic_id: completedTopic.id, status: 'completed', score: scorePercent / 100 });
                } catch { /* silent */ }
                setCurriculum(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        modules: prev.modules.map(mod => ({
                            ...mod,
                            topics: mod.topics.map(t =>
                                t.id === completedTopic.id ? { ...t, status: 'completed' as const, score: scorePercent / 100 } : t
                            ),
                        })),
                    };
                });
                setLastTaughtTopic(null);
                // Check if parent module is now fully complete → auto-trigger module quiz
                if (curriculum) {
                    const parentMod = curriculum.modules.find(m => m.topics.some(t => t.id === completedTopic.id));
                    const allDoneAfter = parentMod && parentMod.topics.every(
                        t => t.id === completedTopic.id || t.status === 'completed'
                    );
                    if (allDoneAfter && parentMod) {
                        pendingModuleQuizRef.current = parentMod;
                        // Don't auto-advance to the next topic; module quiz handles the transition
                    } else if (curriculum) {
                        // Auto-advance to next topic
                        let found = false;
                        let nextTopic: CurriculumTopic | null = null;
                        outer: for (const mod of curriculum.modules) {
                            for (const t of mod.topics) {
                                if (found) { nextTopic = t; break outer; }
                                if (t.id === completedTopic.id) found = true;
                            }
                        }
                        if (nextTopic) {
                            const nt = nextTopic;
                            setTimeout(() => {
                                if (isMountedRef.current) {
                                    setMessages(prev => [...prev, createMessage('ai', `🚀 Nice job! Moving on to **${nt.name}**...`)]);
                                    setTimeout(() => { if (isMountedRef.current) handleTeachTopic(nt); }, 1200);
                                }
                            }, 600);
                        }
                    }
                }
            } else {
                // Re-teach the same topic more simply, then re-quiz
                const retryTopic = completedTopic;
                setTimeout(() => {
                    if (isMountedRef.current) {
                        setMessages(prev => [...prev, createMessage('ai', `No worries! Let me explain **${retryTopic.name}** with a simpler approach. 💪`)]);
                        setTimeout(() => { if (isMountedRef.current) handleTeachTopic(retryTopic, true); }, 1200);
                    }
                }, 600);
            }
        }
    }, [authFetch, currentTopic, curriculum, handleTeachTopic, lastTaughtTopic, quiz, selectedSubject]);

    const handleSend = useCallback(async () => {
        if (!input.trim() || isLoading) return;

        const query = input;
        if (!isMountedRef.current) return;
        setInput('');
        setIsLoading(true);
        setMessages(prev => [...prev, createMessage('user', query), createMessage('ai', THINKING_PLACEHOLDER, true)]);

        try {
            const activeTopicForGate = (lastTaughtTopic?.name || currentTopic || 'General');
            const response = await queryAIStream(authFetch, query, selectedSubject || null, activeTopicForGate);
            if (!response.ok) {
                const data = await response.json();
                setMessages(prev => [...prev, createMessage('ai', `Error: ${data.error}`)]);
                setIsLoading(false);
                return;
            }

            if (!response.body) {
                throw new Error('Streaming not supported by browser response.');
            }

            const reader = response.body.getReader();
            activeReaderRef.current = reader;
            const decoder = new TextDecoder();
            let buffer = '';
            let streamedText = '';
            let finalTopic = currentTopic;
            let finalLevel = level;
            let revealBuffer = '';
            let revealedText = '';
            let pendingDonePayload: any = null;

            const updateLastAiMessage = (nextText: string, typing: boolean) => {
                if (!isMountedRef.current) return;
                setMessages(prev => {
                    if (prev.length === 0) return prev;
                    const copy = [...prev];
                    const lastIdx = copy.length - 1;
                    copy[lastIdx] = { ...copy[lastIdx], text: nextText, isTyping: typing };
                    return copy;
                });
            };

            const finalizeDone = (payload: any) => {
                const finalResponse = payload?.final_response || streamedText;
                finalTopic = payload?.topic || finalTopic;
                finalLevel = payload?.level || finalLevel;

                const detectedQuiz = parseQuiz(finalResponse);
                const cleanText = stripQuizFromDisplay(finalResponse, detectedQuiz?.fullText);

                updateLastAiMessage(cleanText, false);

                if (!isMountedRef.current) return;
                if (detectedQuiz) setQuiz(detectedQuiz);
                setCurrentTopic(finalTopic);
                setLevel(finalLevel);
            };

            const stopRevealTimer = () => {
                if (revealTimerRef.current) {
                    clearInterval(revealTimerRef.current);
                    revealTimerRef.current = null;
                }
            };

            const startRevealTimer = () => {
    if (revealTimerRef.current) return;

    revealTimerRef.current = setInterval(() => {

        if (!isMountedRef.current) {
            stopRevealTimer();
            return;
        }

        if (!revealBuffer && pendingDonePayload) {
            const payload = pendingDonePayload;
            pendingDonePayload = null;
            stopRevealTimer();
            finalizeDone(payload);
            return;
        }

        if (!revealBuffer) {
            stopRevealTimer();
            return;
        }

        // Dynamic typing speed
        const batchSize =
            revealedText.length < 80 ? 2 :
            revealBuffer.length > 200 ? 8 :
            4;

        const nextChunk = revealBuffer.slice(0, batchSize);
        revealBuffer = revealBuffer.slice(batchSize);
        revealedText += nextChunk;

        const updatedText = stripQuizFromDisplay(revealedText);
        updateLastAiMessage(updatedText, true);

    }, 60);   // slower typing speed
};

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line.startsWith('data:')) continue;

                    const payload = JSON.parse(line.slice(5).trim());

                    if (payload.type === 'chunk') {
                        streamedText += payload.content || '';
                        revealBuffer += payload.content || '';
                        startRevealTimer();
                    } else if (payload.type === 'done') {
                        pendingDonePayload = payload;
                        startRevealTimer();
                    } else if (payload.type === 'error') {
                        stopRevealTimer();
                        throw new Error(payload.error || 'Streaming failed');
                    }
                }
            }

            // Wait briefly so remaining buffered characters can render smoothly before closing typing state.
            if (revealTimerRef.current || pendingDonePayload || revealBuffer) {
                await new Promise(resolve => {
                    const startedAt = Date.now();
                    watcherTimerRef.current = setInterval(() => {
                        if (!isMountedRef.current) {
                            if (watcherTimerRef.current) {
                                clearInterval(watcherTimerRef.current);
                                watcherTimerRef.current = null;
                            }
                            stopRevealTimer();
                            resolve(null);
                            return;
                        }

                        const timedOut = Date.now() - startedAt > 3000;
                        if ((!revealTimerRef.current && !pendingDonePayload && !revealBuffer) || timedOut) {
                            if (watcherTimerRef.current) {
                                clearInterval(watcherTimerRef.current);
                                watcherTimerRef.current = null;
                            }
                            stopRevealTimer();
                            if (pendingDonePayload) {
                                finalizeDone(pendingDonePayload);
                                pendingDonePayload = null;
                            }
                            resolve(null);
                        }
                    }, 30);
                });
            }

            if (!isMountedRef.current) return;
            setMessages(prev => {
                if (prev.length === 0) return prev;
                const copy = [...prev];
                const lastIdx = copy.length - 1;
                copy[lastIdx] = { ...copy[lastIdx], isTyping: false };
                return copy;
            });
            setIsLoading(false);
        } catch (error) {
            if (!isMountedRef.current) return;
            setMessages(prev => {
                if (prev.length === 0) return [createMessage('ai', 'Failed to connect to backend.')];
                const copy = [...prev];
                const lastIdx = copy.length - 1;
                if (copy[lastIdx].sender === 'ai' && copy[lastIdx].isTyping) {
                    copy[lastIdx] = { ...copy[lastIdx], text: 'Failed to connect to backend.', isTyping: false };
                    return copy;
                }
                return [...prev, createMessage('ai', 'Failed to connect to backend.')];
            });
            setIsLoading(false);
        } finally {
            activeReaderRef.current = null;
            if (watcherTimerRef.current) {
                clearInterval(watcherTimerRef.current);
                watcherTimerRef.current = null;
            }
            if (revealTimerRef.current) {
                clearInterval(revealTimerRef.current);
                revealTimerRef.current = null;
            }
        }
    }, [authFetch, currentTopic, input, isLoading, lastTaughtTopic, level, selectedSubject]);

    return (
        <div className="app-container">
            <input ref={fileInputRef} type="file" id="file-upload" hidden onChange={handleFileUpload} accept=".pdf,.txt" />

            {/* Subject picker overlay — shown when no subject is active yet */}
            {showSubjectPicker && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(15, 23, 42, 0.75)',
                    backdropFilter: 'blur(6px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #1e3a8a 0%, #1e293b 100%)',
                        border: '1px solid rgba(96,165,250,0.25)',
                        borderRadius: '20px',
                        padding: '36px 40px',
                        width: '100%', maxWidth: '480px',
                        boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
                    }}>
                        <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'white', marginBottom: '6px' }}>Choose Your Subject</h2>
                        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)', marginBottom: '24px' }}>
                            Pick the subject you want to study. You can change it anytime from your Dashboard.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {subjects.map(s => (
                                <button
                                    key={s}
                                    onClick={() => handleSubjectSelect(s)}
                                    style={{
                                        padding: '14px 18px',
                                        borderRadius: '12px',
                                        border: '1px solid rgba(96,165,250,0.3)',
                                        background: 'rgba(37,99,235,0.2)',
                                        color: 'white',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.45)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.2)')}
                                >
                                    📚 {s}
                                </button>
                            ))}
                            {subjects.length === 0 && (
                                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                                    No subjects yet. Upload a document to get started.
                                </div>
                            )}
                        </div>
                        {subjects.length === 0 && (
                            <button
                                onClick={() => { setShowSubjectPicker(false); fileInputRef.current?.click(); }}
                                className="send-btn"
                                style={{ width: '100%', marginTop: '16px', fontSize: '13px' }}
                            >
                                Upload Document
                            </button>
                        )}
                    </div>
                </div>
            )}

            <MessagesErrorBoundary>
            <Sidebar
                username={user?.username}
                level={level}
                currentTopic={currentTopic}
                selectedSubject={selectedSubject}
                curriculum={curriculum}
                isGeneratingCurriculum={isGeneratingCurriculum}
                lastTaughtTopic={lastTaughtTopic}
                onLogout={logout}
                onGoDashboard={() => navigate('/dashboard')}
                onClearChat={handleClearChat}
                onUploadClick={() => fileInputRef.current?.click()}
                onGenerateCurriculum={handleGenerateCurriculum}
                onStudyTopic={handleTeachTopic}
                onMarkComplete={handleMarkComplete}
                onTopicQuiz={handleTopicQuiz}
                onModuleQuiz={handleModuleQuiz}
                onFinalTest={handleFinalTest}
            />
            </MessagesErrorBoundary>

            <main
                className="chat-area"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    overflow: 'hidden',
                }}
            >
                <header className="chat-header" style={{ flexShrink: 0 }}>
                    <div>
                        <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1e3a8a' }}>Learning Assistant</h2>
                        <span style={{ fontSize: '14px', color: '#64748b' }}>Adaptive Tutoring Mode</span>
                    </div>
                    <div className="status-indicator">
                        <div className="status-dot"></div>
                        Online
                    </div>
                </header>

                <div
                    ref={messagesContainerRef}
                    className="messages-container"
                    style={{
                        flex: '1 1 0',
                        minHeight: 0,
                        overflowY: 'auto',
                        padding: '32px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px',
                    }}
                >
                    <MessagesErrorBoundary>
                        <MessageList messages={messages} messagesEndRef={messagesEndRef} />
                        {quiz && <QuizCard quiz={quiz} onAnswer={handleQuizAnswer} />}
                    </MessagesErrorBoundary>
                </div>

                <ChatInput
                    input={input}
                    isLoading={isLoading}
                    isQuizActive={!!quiz}
                    onChange={setInput}
                    onSend={handleSend}
                    onUploadClick={() => fileInputRef.current?.click()}
                />
            </main>
        </div>
    );
};

export default Chat;

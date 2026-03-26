import { getApiBaseUrl } from '../utils/apiConfig';

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const API_BASE_URL = getApiBaseUrl();

export const fetchSubjects = (authFetch: AuthFetch) =>
    authFetch(`${API_BASE_URL}/api/subjects`);

export const fetchChatHistory = (authFetch: AuthFetch) =>
    authFetch(`${API_BASE_URL}/api/chat_history`);

export const loadSubject = (authFetch: AuthFetch, subject: string) =>
    authFetch(`${API_BASE_URL}/api/load_subject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject })
    });

export const uploadMaterial = (authFetch: AuthFetch, file: File, subject?: string | null) => {
    const formData = new FormData();
    formData.append('file', file);
    if (subject) {
        formData.append('subject', subject);
    }
    return authFetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData
    });
};

export const clearChatHistory = (authFetch: AuthFetch) =>
    authFetch(`${API_BASE_URL}/api/clear_chat`, { method: 'DELETE' });

export const queryAI = (
    authFetch: AuthFetch,
    query: string,
    subject?: string | null,
    currentTopic?: string | null
) =>
    authFetch(`${API_BASE_URL}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, subject: subject || null, current_topic: currentTopic || null })
    });

export const queryAIStream = (
    authFetch: AuthFetch,
    query: string,
    subject?: string | null,
    currentTopic?: string | null
) =>
    authFetch(`${API_BASE_URL}/api/query_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, subject: subject || null, current_topic: currentTopic || null })
    });

export const updateLevel = (
    authFetch: AuthFetch,
    payload: {
        correct: number;
        total: number;
        subject: string;
        topic: string;
    }
) =>
    authFetch(`${API_BASE_URL}/api/update_level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_results: payload })
    });

export const fetchLearningPath = (authFetch: AuthFetch, subject: string) =>
    authFetch(`${API_BASE_URL}/api/learning_path?subject=${encodeURIComponent(subject)}`);

export const updateLearningProgress = (
    authFetch: AuthFetch,
    payload: { subject: string; concept: string; status?: 'not_started' | 'learning' | 'mastered'; mastery_score?: number }
) =>
    authFetch(`${API_BASE_URL}/api/learning_progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

// ── Tutor / Curriculum Engine ────────────────────────────────────────────────

export const generateCurriculum = (authFetch: AuthFetch, subject: string) =>
    authFetch(`${API_BASE_URL}/api/curriculum/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject })
    });

export const fetchCurriculum = (authFetch: AuthFetch, subject: string) =>
    authFetch(`${API_BASE_URL}/api/curriculum/${encodeURIComponent(subject)}`);

export const teachTopicStream = (
    authFetch: AuthFetch,
    payload: { topic_id?: number; topic_name: string; difficulty: string; subject: string; simplify?: boolean }
) =>
    authFetch(`${API_BASE_URL}/api/curriculum/teach_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const updateTopicProgressCurriculum = (
    authFetch: AuthFetch,
    payload: { topic_id: number; status?: 'not_started' | 'in_progress' | 'completed'; score?: number }
) =>
    authFetch(`${API_BASE_URL}/api/curriculum/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const topicQuizStream = (
    authFetch: AuthFetch,
    payload: { topic_id?: number; topic_name: string; difficulty: string; subject: string; is_retry?: boolean }
) =>
    authFetch(`${API_BASE_URL}/api/curriculum/topic_quiz_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const moduleQuizStream = (
    authFetch: AuthFetch,
    payload: { module_id: number; module_name: string; subject: string }
) =>
    authFetch(`${API_BASE_URL}/api/curriculum/module_quiz_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const finalTestStream = (
    authFetch: AuthFetch,
    payload: { subject: string; curriculum_id: number }
) =>
    authFetch(`${API_BASE_URL}/api/curriculum/final_test_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const saveUserSubject = (authFetch: AuthFetch, subject: string) =>
    authFetch(`${API_BASE_URL}/api/user/subject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject })
    });


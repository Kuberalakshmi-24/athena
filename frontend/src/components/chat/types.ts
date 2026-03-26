export interface ChatMessage {
    id: string;
    sender: 'user' | 'ai';
    text: string;
    isTyping?: boolean;
}

export interface QuizQuestion {
    question: string;
    options: string[];
    correct: string;
    // open-ended support
    isOpenEnded?: boolean;
    sampleAnswer?: string;
}

export interface QuizState {
    questions: QuizQuestion[];
    currentIndex: number;
    results: boolean[];
    fullText: string;
    /** 'topic_quiz' | 'module_quiz' | 'final_test' — used to show correct header labels */
    quizType?: 'topic_quiz' | 'module_quiz' | 'final_test';
}

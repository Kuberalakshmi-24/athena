import { QuizState } from '../components/chat/types';

const extractQuizBlock = (text: string): { fullText: string; content: string } | null => {
    const explicitMatch = text.match(/---QUIZ---([\s\S]*?)(?:---ENDQUIZ---|$)/i);
    if (explicitMatch) {
        return { fullText: explicitMatch[0], content: explicitMatch[1].trim() };
    }

    const fallbackMatch = text.match(/(?:^|\n)\s*Q1[:.)][\s\S]*$/i);
    if (fallbackMatch) {
        return { fullText: fallbackMatch[0], content: fallbackMatch[0].trim() };
    }

    return null;
};

export const parseQuiz = (text: string): QuizState | null => {
    const quizBlock = extractQuizBlock(text);
    if (!quizBlock) return null;

    const content = quizBlock.content;
    const questions: QuizState['questions'] = [];
    const questionRegex = /Q(\d+)[:.)]\s*([\s\S]*?)(?=(?:\n\s*Q\d+[:.)])|$)/gi;

    let match: RegExpExecArray | null;
    while ((match = questionRegex.exec(content)) !== null) {
        const number = match[1];
        const block = match[2].trim();
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        const questionText = lines[0] || '';

        // Check if open-ended marker present
        const isOpenEnded = lines.some(l => /^OPEN_ENDED\d*/i.test(l));

        if (isOpenEnded) {
            // Extract sample answer
            const sampleMatch = block.match(new RegExp(`SampleAnswer${number}\\s*:\\s*(.+)`, 'i'));
            const sampleAnswer = sampleMatch ? sampleMatch[1].trim() : '';
            questions.push({
                question: questionText,
                options: [],
                correct: '',
                isOpenEnded: true,
                sampleAnswer,
            });
        } else {
            const options = lines
                .filter(l => /^[A-C]\)/i.test(l))
                .map(l => l.replace(/^([A-C])\)/i, (_, letter) => `${letter.toUpperCase()})`));

            const answerMatch = block.match(new RegExp(`Answer\\s*${number}\\s*:\\s*([A-C])`, 'i'))
                || block.match(/Answer\d*\s*:\s*([A-C])/i);
            const correct = answerMatch ? answerMatch[1].toUpperCase() : '';

            if (questionText && options.length > 0 && correct) {
                questions.push({ question: questionText, options, correct, isOpenEnded: false });
            }
        }
    }

    if (questions.length === 0) return null;

    return {
        questions,
        currentIndex: 0,
        results: [],
        fullText: quizBlock.fullText
    };
};

export const stripQuizFromDisplay = (text: string, extractedFullText?: string): string => {
    let cleaned = text;

    if (extractedFullText) {
        cleaned = cleaned.replace(extractedFullText, '');
    }

    cleaned = cleaned
        .replace(/---QUIZ---[\s\S]*?(?:---ENDQUIZ---|$)/gi, '')
        .replace(/Answer\d*\s*:\s*[A-C](?:\)|\.|\b)?[^\n]*/gi, '')
        .replace(/(?:^|\n)\s*Q\d+[:.)][\s\S]*$/i, '')
        .trim();

    return cleaned;
};


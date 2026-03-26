import React, { useState } from 'react';
import { QuizState } from './types';

interface QuizCardProps {
    quiz: QuizState;
    onAnswer: (answer: string) => void;
}

const QUIZ_TYPE_LABEL: Record<string, string> = {
    topic_quiz: 'Topic Quiz',
    module_quiz: 'Module Quiz',
    final_test: 'Final Test',
};

const QuizCard: React.FC<QuizCardProps> = ({ quiz, onAnswer }) => {
    const [openAnswer, setOpenAnswer] = useState('');
    const [showSample, setShowSample] = useState(false);

    const current = quiz.questions[quiz.currentIndex];
    const isOpenEnded = current?.isOpenEnded === true;
    const total = quiz.questions.length;
    const typeLabel = quiz.quizType ? QUIZ_TYPE_LABEL[quiz.quizType] : 'Quiz';

    const handleSubmitOpen = () => {
        if (!openAnswer.trim()) return;
        const submitted = openAnswer.trim();
        setOpenAnswer('');
        setShowSample(false);
        onAnswer(submitted);
    };

    return (
        <div
            className="quiz-card"
            style={{
                background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                border: '2px solid #fbbf24',
                padding: '20px 24px',
                borderRadius: '12px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: '#92400e', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    {typeLabel}
                </span>
                <span style={{ fontSize: '11px', color: '#92400e', fontWeight: '600' }}>
                    {quiz.currentIndex + 1} / {total}
                </span>
            </div>

            {/* Question type badge */}
            <div style={{ marginBottom: '6px' }}>
                <span style={{
                    fontSize: '9px',
                    fontWeight: '700',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    background: isOpenEnded ? '#fde68a' : '#fff7ed',
                    color: isOpenEnded ? '#92400e' : '#b45309',
                    border: `1px solid ${isOpenEnded ? '#fbbf24' : '#f59e0b'}`,
                }}>
                    {isOpenEnded ? 'Written Answer' : 'Multiple Choice'}
                </span>
            </div>

            {/* Question text */}
            <h4 style={{ color: '#78350f', marginBottom: '14px', fontSize: '15px', fontWeight: '600', lineHeight: '1.5' }}>
                {current.question}
            </h4>

            {isOpenEnded ? (
                /* Open-ended answer area */
                <div>
                    <textarea
                        value={openAnswer}
                        onChange={e => setOpenAnswer(e.target.value)}
                        placeholder="Type your answer here..."
                        rows={3}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '2px solid #fbbf24',
                            background: 'white',
                            color: '#78350f',
                            fontSize: '13px',
                            resize: 'vertical',
                            outline: 'none',
                            fontFamily: 'inherit',
                            boxSizing: 'border-box',
                        }}
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                        <button
                            onClick={handleSubmitOpen}
                            disabled={!openAnswer.trim()}
                            style={{
                                padding: '8px 20px',
                                borderRadius: '8px',
                                border: 'none',
                                background: openAnswer.trim() ? '#d97706' : '#fde68a',
                                color: openAnswer.trim() ? 'white' : '#92400e',
                                fontWeight: '700',
                                fontSize: '13px',
                                cursor: openAnswer.trim() ? 'pointer' : 'not-allowed',
                                transition: 'background 0.15s',
                            }}
                        >
                            Submit Answer
                        </button>
                        {current.sampleAnswer && (
                            <button
                                onClick={() => setShowSample(s => !s)}
                                style={{
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    border: '1.5px solid #fbbf24',
                                    background: 'transparent',
                                    color: '#92400e',
                                    fontWeight: '600',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                }}
                            >
                                {showSample ? 'Hide Hint' : 'Show Hint'}
                            </button>
                        )}
                    </div>
                    {showSample && current.sampleAnswer && (
                        <div style={{
                            marginTop: '10px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            background: 'rgba(255,255,255,0.6)',
                            border: '1.5px solid #fbbf24',
                            fontSize: '12px',
                            color: '#78350f',
                            lineHeight: '1.6',
                        }}>
                            <strong>Sample Answer:</strong> {current.sampleAnswer}
                        </div>
                    )}
                </div>
            ) : (
                /* Multiple choice options */
                <div>
                    {current.options.map((opt: string, i: number) => (
                        <button
                            key={i}
                            className="quiz-option"
                            style={{
                                marginBottom: '8px',
                                width: '100%',
                                textAlign: 'left',
                                padding: '11px 16px',
                                borderRadius: '8px',
                                background: 'white',
                                border: '2px solid #fbbf24',
                                color: '#78350f',
                                fontWeight: '500',
                                fontSize: '13px',
                                cursor: 'pointer',
                            }}
                            onClick={() => onAnswer(opt)}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default React.memo(QuizCard);


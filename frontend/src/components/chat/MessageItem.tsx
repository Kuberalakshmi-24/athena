import React from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MermaidDiagram from './MermaidDiagram';
import ChartBlock from './ChartBlock';
import { preprocessMessageText } from '../../utils/preprocessMessage';
import { ChatMessage } from './types';
import { useAuth } from '../../context/AuthContext';
import { queryAI } from '../../services/api';
import 'katex/dist/katex.min.css';

interface MessageItemProps {
    msg: ChatMessage;
}

const THINKING_PLACEHOLDER = 'Athena is thinking...';

const inferCodeLanguage = (code: string): string => {
    const t = code.trim();
    if (!t) return 'text';
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) return 'json';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(t)) return 'sql';
    if (/^\s*</.test(t)) return 'markup';
    return 'javascript';
};

/** Styled code block with language badge + copy button */
const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
    const [copied, setCopied] = React.useState(false);
    const normalizedCode = code.replace(/^\n+/, '').replace(/\n+$/, '');
    const handleCopy = () => {
        navigator.clipboard.writeText(normalizedCode).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return (
        <div style={{ margin: '6px 0', borderRadius: '12px', overflow: 'hidden', border: '1px solid #2d3250', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 14px', background: '#1a1b2e' }}>
                <span style={{ color: '#7c85c8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'monospace' }}>
                    {language || 'code'}
                </span>
                <button
                    onClick={handleCopy}
                    style={{
                        background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.07)',
                        border: `1px solid ${copied ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.15)'}`,
                        color: copied ? '#4ade80' : '#94a3b8',
                        fontSize: '11px', padding: '3px 10px', borderRadius: '5px',
                        cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
                    }}
                >
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>
            <SyntaxHighlighter
                language={language}
                style={vscDarkPlus as any}
                customStyle={{ margin: 0, borderRadius: '0 0 12px 12px', fontSize: '13px', lineHeight: '1.65', padding: '10px 14px' }}
                PreTag="div"
            >
                {normalizedCode}
            </SyntaxHighlighter>
        </div>
    );
};

/** Extract practice questions from message text.
 * Supports two formats:
 * 1. ---PRACTICE---...---ENDPRACTICE--- delimiters (structured)
 * 2. **Practice Questions** heading followed by numbered list (fallback)
 */
function extractPractice(text: string): { mainText: string; practiceText: string | null } {
    if (!text) return { mainText: text, practiceText: null };

    // Format 1: explicit delimiters (preferred)
    const delimited = text.match(/---PRACTICE---\r?\n?([\s\S]*?)---ENDPRACTICE---/);
    if (delimited) {
        const mainText = text.replace(/\r?\n?---PRACTICE---\r?\n?[\s\S]*?---ENDPRACTICE---\r?\n?/, '').trim();
        return { mainText, practiceText: delimited[1].trim() };
    }

    // Format 2: **Practice Questions** heading (LLM didn't use delimiters)
    const headingMatch = text.match(/(\*\*Practice Questions\*\*[\s\S]*)$/im);
    if (headingMatch) {
        const mainText = text.slice(0, headingMatch.index).trim();
        const raw = headingMatch[1].replace(/^\*\*Practice Questions\*\*\s*/i, '').trim();
        if (raw) return { mainText, practiceText: raw };
    }

    return { mainText: text, practiceText: null };
}

/** Split practice text into individual numbered questions, stripping embedded answer hints */
function parsePracticeQuestions(text: string): string[] {
    const cleaned = text.replace(/^\s*\*\*Practice Questions\*\*\s*\n?/i, '').trim();
    const parts = cleaned.split(/\n\s*(?=\d+\.\s)/);
    return parts.map(p =>
        p.replace(/^\d+\.\s*/, '')
         // Strip embedded answer hints like (Answer: ...) or [Answer: ...]
         .replace(/\s*[([]\s*answer\s*:[^)\]]*[)\]]/gi, '')
         // Also strip answer lines like "Answer: ..." on their own line at the end
         .replace(/\n+\s*answer\s*:.*$/gi, '')
         .trim()
    ).filter(Boolean);
}

/** Modal that shows practice questions and AI-evaluates answers */
const PracticeModal: React.FC<{ practiceText: string; onClose: () => void }> = ({ practiceText, onClose }) => {
    const { authFetch } = useAuth();
    const questions = React.useMemo(() => parsePracticeQuestions(practiceText), [practiceText]);
    const [idx, setIdx] = React.useState(0);
    const [answer, setAnswer] = React.useState('');
    const [feedback, setFeedback] = React.useState<string | null>(null);
    const [evaluating, setEvaluating] = React.useState(false);

    const question = questions[idx] || practiceText;

    const handleCheck = async () => {
        if (!answer.trim()) return;
        setEvaluating(true);
        setFeedback(null);
        try {
            const prompt = [
                'You are an expert tutor evaluating a student\'s written answer. Evaluate using your own knowledge — do NOT reference uploaded documents, context windows, or say you cannot verify.',
                '',
                `Question: ${question}`,
                '',
                `Student Answer: ${answer}`,
                '',
                'Respond in this exact format (3 short sections, no diagrams, no code blocks):',
                '✓ Correct: [what the student got right]',
                '✗ Needs work: [what is missing or wrong]',
                '📖 Model answer: [the ideal answer in 2-3 sentences]',
            ].join('\n');
            const res = await queryAI(authFetch, prompt);
            if (res.ok) {
                const data = await res.json();
                setFeedback(data.response || 'Could not evaluate.');
            } else {
                setFeedback('Evaluation failed. Please try again.');
            }
        } catch {
            setFeedback('Evaluation failed. Please try again.');
        } finally {
            setEvaluating(false);
        }
    };

    const goTo = (next: number) => { setIdx(next); setAnswer(''); setFeedback(null); };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
            }}
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div style={{
                background: 'white', borderRadius: '16px',
                width: '100%', maxWidth: '600px', maxHeight: '88vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 24px 64px rgba(0,0,0,0.2)', overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: '1px solid #e2e8f0',
                    background: 'linear-gradient(135deg, #eff6ff, #f8faff)',
                }}>
                    <div>
                        <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: '15px' }}>📝 Practice Questions</div>
                        {questions.length > 1 && (
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                Question {idx + 1} of {questions.length}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#64748b', fontSize: '20px', padding: '4px',
                            borderRadius: '6px', lineHeight: 1,
                        }}
                    >✕</button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                    <div style={{
                        background: '#f1f5f9', borderRadius: '10px',
                        padding: '14px 16px', marginBottom: '16px',
                        fontSize: '14px', lineHeight: '1.65', color: '#1e293b',
                        borderLeft: '3px solid #3b82f6',
                    }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{question}</ReactMarkdown>
                    </div>

                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                        Your Answer
                    </label>
                    <textarea
                        value={answer}
                        onChange={e => setAnswer(e.target.value)}
                        placeholder="Type your answer here..."
                        rows={5}
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            border: '1px solid #cbd5e1', borderRadius: '8px',
                            padding: '10px 12px', fontSize: '13px', lineHeight: '1.6',
                            resize: 'vertical', fontFamily: 'inherit', outline: 'none',
                            transition: 'border-color 0.15s',
                        }}
                        onFocus={e => (e.target.style.borderColor = '#3b82f6')}
                        onBlur={e => (e.target.style.borderColor = '#cbd5e1')}
                    />

                    {feedback && (
                        <div style={{
                            marginTop: '14px', padding: '14px 16px',
                            background: 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(16,185,129,0.04))',
                            border: '1px solid rgba(34,197,94,0.25)',
                            borderLeft: '3px solid #22c55e',
                            borderRadius: '8px', fontSize: '13px', lineHeight: '1.65',
                        }}>
                            <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: '6px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                ✓ Feedback
                            </div>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback}</ReactMarkdown>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 20px', borderTop: '1px solid #e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#fafbff', gap: '8px',
                }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {idx > 0 && (
                            <button onClick={() => goTo(idx - 1)} style={{
                                padding: '8px 16px', borderRadius: '8px',
                                border: '1px solid #e2e8f0', background: 'white',
                                color: '#475569', fontSize: '13px', cursor: 'pointer', fontWeight: 500,
                            }}>← Prev</button>
                        )}
                        {idx < questions.length - 1 && (
                            <button onClick={() => goTo(idx + 1)} style={{
                                padding: '8px 16px', borderRadius: '8px',
                                border: '1px solid #e2e8f0', background: 'white',
                                color: '#475569', fontSize: '13px', cursor: 'pointer', fontWeight: 500,
                            }}>Next →</button>
                        )}
                    </div>
                    <button
                        onClick={handleCheck}
                        disabled={!answer.trim() || evaluating}
                        style={{
                            padding: '8px 20px', borderRadius: '8px',
                            background: answer.trim() && !evaluating ? '#2563eb' : '#94a3b8',
                            border: 'none', color: 'white', fontSize: '13px',
                            fontWeight: 600, cursor: answer.trim() && !evaluating ? 'pointer' : 'default',
                            transition: 'background 0.15s',
                        }}
                    >
                        {evaluating ? 'Evaluating...' : '✓ Check Answer'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const MessageItem: React.FC<MessageItemProps> = ({ msg }) => {
    const rawProcessed = React.useMemo(() => preprocessMessageText(msg.text), [msg.text]);
    const { mainText, practiceText } = React.useMemo(() => extractPractice(rawProcessed), [rawProcessed]);
    const processedText = mainText;

    const hasDiagramContent = React.useMemo(
        () => /```mermaid|(^|\n)\s*(graph|flowchart)\s+(TD|LR|TB|BT|RL)?/i.test(processedText || ''),
        [processedText]
    );
    const showTypingIndicator = msg.sender === 'ai' && !!msg.isTyping && (
        !(msg.text || '').trim() || (msg.text || '').trim() === THINKING_PLACEHOLDER
    );

    const [practiceOpen, setPracticeOpen] = React.useState(false);

    const renderCodeBlock = (className: string | undefined, children: React.ReactNode) => {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const codeString = String(children).replace(/\n$/, '');
        const codeTrimmed = codeString.trim().toLowerCase();

        // Ignore malformed placeholder fences like ```\nmermaid\n```.
        if (codeTrimmed === 'mermaid') {
            return null;
        }

        if (language === 'chart') {
            return <ChartBlock raw={codeString} />;
        }

        const graphStartMatch = codeString.match(/(graph\s+(?:TD|LR|TB|BT|RL)|flowchart\s+\w+)/i);
        const recoveredGraph = graphStartMatch ? codeString.slice(graphStartMatch.index || 0) : '';
        const normalizedRecovered = recoveredGraph
            .replace(/→/g, '-->')
            .replace(/⇒/g, '-->')
            .replace(/->/g, '-->');

        const hasGraphLikeContent = /graph\s+(?:TD|LR|TB|BT|RL)|flowchart\s+\w+/i.test(codeString);

        if (language === 'mermaid' || codeString.trim().startsWith('graph ') || hasGraphLikeContent) {
            // If language says mermaid but there is no graph definition, skip rendering.
            if (language === 'mermaid' && !hasGraphLikeContent) return null;
            const chart = normalizedRecovered || codeString;
            return <MermaidDiagram chart={chart} isTyping={msg.isTyping} />;
        }

        return null;
    };

    if (showTypingIndicator) {
        return (
            <div className="message ai typing-indicator" aria-label="Athena is typing">
                <span style={{ fontSize: '12px', color: '#64748b', marginRight: '8px' }}>Athena is thinking</span>
                <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        );
    }

    return (
        <div className={`message ${msg.sender}${hasDiagramContent ? ' has-diagram' : ''}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
                components={{
                    pre({ children }: any) {
                        const child = React.Children.toArray(children)[0] as any;
                        if (React.isValidElement(child)) {
                            const childElement = child as React.ReactElement<any>;
                            const rendered = renderCodeBlock(childElement.props?.className, childElement.props?.children);
                            if (rendered) {
                                return rendered;
                            }
                        }
                        // Let the custom `code` renderer handle regular fenced code blocks
                        // so all code gets the same styled card (same as JSON blocks).
                        return <>{children}</>;
                    },
                    code({ inline, className, children, ...props }: any) {
                        const codeText = String(children).replace(/^\n+/, '').replace(/\n+$/, '');
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';

                        if (!inline) {
                            // Ignore accidental empty fenced blocks from malformed streaming chunks.
                            if (!codeText.trim()) return null;
                            // Ignore placeholder fenced block that only contains the word "mermaid".
                            if (codeText.trim().toLowerCase() === 'mermaid') return null;
                            const rendered = renderCodeBlock(className, children);
                            if (rendered) return rendered;
                            const fallbackLanguage = language || inferCodeLanguage(codeText);
                            return <CodeBlock language={fallbackLanguage} code={codeText} />;
                        }
                        return <code className={className} {...props}>{children}</code>;
                    }
                }}
            >
                {processedText}
            </ReactMarkdown>

            {/* Practice Questions — button opens portal modal */}
            {practiceText && msg.sender === 'ai' && (
                <>
                    <button
                        onClick={() => setPracticeOpen(true)}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            marginTop: '10px',
                            color: '#2563eb', fontSize: '13px', fontWeight: 600,
                            background: 'none', border: 'none', padding: 0,
                            borderBottom: '1px dashed rgba(37,99,235,0.45)',
                            paddingBottom: '2px', cursor: 'pointer',
                            fontFamily: 'inherit',
                        }}
                    >
                        📝 Practice Questions →
                    </button>
                    {practiceOpen && ReactDOM.createPortal(
                        <PracticeModal practiceText={practiceText} onClose={() => setPracticeOpen(false)} />,
                        document.body
                    )}
                </>
            )}
        </div>
    );
};

export default React.memo(MessageItem);


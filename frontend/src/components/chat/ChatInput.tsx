import React from 'react';
import { Paperclip } from 'lucide-react';

interface ChatInputProps {
    input: string;
    isLoading: boolean;
    isQuizActive: boolean;
    onChange: (value: string) => void;
    onSend: () => void;
    onUploadClick?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ input, isLoading, isQuizActive, onChange, onSend, onUploadClick }) => {
    return (
        <div className="input-area" style={{ padding: '16px 24px', borderTop: '1px solid rgba(30, 58, 138, 0.1)', background: 'white' }}>
            {onUploadClick && (
                <button
                    onClick={onUploadClick}
                    title="Upload material"
                    style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: '1px solid rgba(30,58,138,0.15)',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#2563eb'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; }}
                >
                    <Paperclip size={16} />
                </button>
            )}
            <input
                type="text"
                className="chat-input"
                value={input}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
                onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && onSend()}
                placeholder="Ask anything about the subject..."
                style={{ flex: 1, fontSize: '14px' }}
            />

            <button className="send-btn" onClick={onSend} disabled={isLoading || isQuizActive} style={{ padding: '12px 28px', fontSize: '14px', fontWeight: '600' }}>
                Send
            </button>
        </div>
    );
};

export default React.memo(ChatInput);

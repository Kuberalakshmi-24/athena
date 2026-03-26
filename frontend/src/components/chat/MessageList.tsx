import React from 'react';
import MessageItem from './MessageItem';
import { ChatMessage } from './types';

interface MessageListProps {
    messages: ChatMessage[];
    messagesEndRef: React.RefObject<HTMLDivElement>;
}

const MessageList: React.FC<MessageListProps> = ({ messages, messagesEndRef }) => {
    return (
        <>
            {messages.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: '120px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
                    <h3 style={{ color: '#1e3a8a', fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>Welcome to Athena</h3>
                    <p style={{ color: '#64748b', fontSize: '14px' }}>Select a subject from the sidebar and start your learning journey.</p>
                </div>
            )}

            {messages.map((msg, index) => (
                <MessageItem key={msg.id || index} msg={msg} />
            ))}

            <div ref={messagesEndRef} />
        </>
    );
};

export default React.memo(MessageList);

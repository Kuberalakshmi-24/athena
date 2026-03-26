export interface Message {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

export interface ChatProps {
    messages: Message[];
    onSendMessage: (message: string) => void;
}

export interface User {
    id: string;
    name: string;
}
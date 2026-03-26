import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import './index.css';

// Fix for "process is not defined" error in some libraries
if (typeof window !== 'undefined' && !window.process) {
    (window as any).process = { env: {} };
}


ReactDOM.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
    document.getElementById('root')
);

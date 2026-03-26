import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../utils/apiConfig';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError('');

        const usernameClean = username.trim();
        const passwordClean = password;
        if (!usernameClean || !passwordClean) {
            setError('Username and password are required');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username: usernameClean, password: passwordClean }),
            });
            const data = await response.json();
            if (response.ok) {
                login(data.access_token, data.user, rememberMe);
                navigate('/');
            } else {
                setError(data.error || 'Invalid credentials');
            }
        } catch {
            setError('Failed to connect to server');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)' }}>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="stat-card"
                style={{ width: '100%', maxWidth: '400px', padding: '40px', background: 'white', border: '1px solid rgba(30, 58, 138, 0.1)' }}
            >
                <h1 className="logo" style={{ textAlign: 'center', marginBottom: '30px', color: '#1e3a8a' }}>Welcome Back</h1>

                {error && <div style={{ color: '#ef4444', marginBottom: '20px', textAlign: 'center', fontSize: '14px' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <div className="stat-label">Username</div>
                        <input
                            className="chat-input"
                            style={{ width: '100%', marginTop: '8px' }}
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            disabled={isSubmitting}
                            required
                        />
                    </div>
                    <div>
                        <div className="stat-label">Password</div>
                        <input
                            className="chat-input"
                            style={{ width: '100%', marginTop: '8px' }}
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            disabled={isSubmitting}
                            required
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="checkbox"
                            id="remember"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            disabled={isSubmitting}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <label htmlFor="remember" style={{ fontSize: '14px', color: '#64748b', cursor: 'pointer' }}>
                            Remember me
                        </label>
                    </div>
                    <button className="send-btn" style={{ marginTop: '10px' }} disabled={isSubmitting}>
                        {isSubmitting ? 'Signing In...' : 'Sign In'}
                    </button>
                </form>

                <div style={{ marginTop: '30px', textAlign: 'center', fontSize: '14px', color: '#64748b' }}>
                    Don't have an account? <Link to="/register" style={{ color: '#2563eb', textDecoration: 'none' }}>Register</Link>
                </div>
            </motion.div>
        </div>
    );
};

export default Login;

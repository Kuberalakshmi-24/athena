import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getApiBaseUrl } from '../utils/apiConfig';

const Register: React.FC = () => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError('');

        const usernameClean = username.trim();
        const emailClean = email.trim().toLowerCase();
        const passwordClean = password;

        if (!usernameClean || !emailClean || !passwordClean) {
            setError('All fields are required');
            return;
        }
        if (passwordClean.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: usernameClean, email: emailClean, password: passwordClean }),
            });
            const data = await response.json();
            if (response.ok) {
                navigate('/login');
            } else {
                setError(data.error || 'Registration failed');
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
                <h1 className="logo" style={{ textAlign: 'center', marginBottom: '30px', color: '#1e3a8a' }}>Join Athena</h1>

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
                        <div className="stat-label">Email</div>
                        <input
                            className="chat-input"
                            style={{ width: '100%', marginTop: '8px' }}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
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
                            autoComplete="new-password"
                            disabled={isSubmitting}
                            required
                        />
                    </div>
                    <button className="send-btn" style={{ marginTop: '10px' }} disabled={isSubmitting}>
                        {isSubmitting ? 'Creating Account...' : 'Sign Up'}
                    </button>
                </form>

                <div style={{ marginTop: '30px', textAlign: 'center', fontSize: '14px', color: '#64748b' }}>
                    Already have an account? <Link to="/login" style={{ color: '#2563eb', textDecoration: 'none' }}>Login</Link>
                </div>
            </motion.div>
        </div>
    );
};

export default Register;

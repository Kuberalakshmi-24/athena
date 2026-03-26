import React, { createContext, useContext, useState, useEffect } from 'react';
import { getApiBaseUrl } from '../utils/apiConfig';

const TOKEN_KEY = 'athena_token';
const USER_KEY = 'athena_user';

interface User {
    username: string;
    level: string;
    topic?: string;
    selected_subject?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (token: string, user: User, remember: boolean) => void;
    logout: () => Promise<void>;
    refreshAccessToken: () => Promise<string | null>;
    authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    updateUser: (patch: Partial<User>) => void;
    isAuthenticated: boolean;
    authLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [authLoading, setAuthLoading] = useState<boolean>(true);

    useEffect(() => {
        const bootstrapAuth = async () => {
            const localToken = localStorage.getItem(TOKEN_KEY);
            const sessionToken = sessionStorage.getItem(TOKEN_KEY);
            const savedToken = localToken || sessionToken;
            const savedUser = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);

            if (savedToken) {
                setToken(savedToken);
            }

            if (savedUser) {
                try {
                    setUser(JSON.parse(savedUser));
                } catch {
                    sessionStorage.removeItem(USER_KEY);
                    localStorage.removeItem(USER_KEY);
                }
            }

            if (savedToken && savedUser) {
                setAuthLoading(false);
                return;
            }

            try {
                const response = await fetch(`${getApiBaseUrl()}/api/refresh`, {
                    method: 'POST',
                    credentials: 'include',
                });
                const data = await response.json();
                if (response.ok && data.access_token && data.user) {
                    setToken(data.access_token);
                    setUser(data.user);
                    // Persist mode follows where token already exists.
                    if (localToken) localStorage.setItem(TOKEN_KEY, data.access_token);
                    else sessionStorage.setItem(TOKEN_KEY, data.access_token);
                    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
                }
            } catch {
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(USER_KEY);
                sessionStorage.removeItem(TOKEN_KEY);
                sessionStorage.removeItem(USER_KEY);
            } finally {
                setAuthLoading(false);
            }
        };

        bootstrapAuth();
    }, []);

    const login = (token: string, user: User, remember: boolean) => {
        setToken(token);
        setUser(user);

        if (remember) {
            // Remember-me: persist only token long-term.
            localStorage.setItem(TOKEN_KEY, token);
            localStorage.removeItem(USER_KEY);
            sessionStorage.setItem(USER_KEY, JSON.stringify(user));
            sessionStorage.removeItem(TOKEN_KEY);
        } else {
            sessionStorage.setItem(TOKEN_KEY, token);
            sessionStorage.setItem(USER_KEY, JSON.stringify(user));
            // Ensure any old long-term session is cleared
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
        }
    };

    const clearClientAuth = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
    };

    const updateUser = (patch: Partial<User>) => {
        setUser(prev => {
            if (!prev) return prev;
            const updated = { ...prev, ...patch };
            // Keep user profile in session storage; remember-me persists token only.
            sessionStorage.setItem(USER_KEY, JSON.stringify(updated));
            return updated;
        });
    };

    const refreshAccessToken = async (): Promise<string | null> => {
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/refresh`, {
                method: 'POST',
                credentials: 'include',
            });
            const data = await response.json();
            if (response.ok && data.access_token && data.user) {
                setToken(data.access_token);
                setUser(data.user);
                if (localStorage.getItem(TOKEN_KEY)) {
                    localStorage.setItem(TOKEN_KEY, data.access_token);
                } else {
                    sessionStorage.setItem(TOKEN_KEY, data.access_token);
                }
                sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
                return data.access_token as string;
            }
        } catch {
            // No-op; handled by returning null.
        }
        clearClientAuth();
        return null;
    };

    const authFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        const requestHeaders = new Headers(init.headers || {});
        if (token) {
            requestHeaders.set('Authorization', `Bearer ${token}`);
        }

        let response = await fetch(input, { ...init, headers: requestHeaders });

        if (response.status === 401) {
            const newAccessToken = await refreshAccessToken();
            if (newAccessToken) {
                const retryHeaders = new Headers(init.headers || {});
                retryHeaders.set('Authorization', `Bearer ${newAccessToken}`);
                response = await fetch(input, { ...init, headers: retryHeaders });
            }
        }

        return response;
    };

    const logout = async () => {
        try {
            await fetch(`${getApiBaseUrl()}/api/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch {
            // Best-effort server logout; client state is always cleared.
        }
        clearClientAuth();
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, refreshAccessToken, authFetch, updateUser, isAuthenticated: !!token, authLoading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

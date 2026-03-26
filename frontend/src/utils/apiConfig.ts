/**
 * Get API base URL from environment or default to localhost:5000
 * Use REACT_APP_API_BASE_URL env variable for custom backend URL
 */
export function getApiBaseUrl(): string {
    if (process.env.REACT_APP_API_BASE_URL) {
        return process.env.REACT_APP_API_BASE_URL;
    }
    // Extract host and port from window.location if running in browser
    if (typeof window !== 'undefined') {
        const port = process.env.REACT_APP_API_PORT || '10000';
        return `http://${window.location.hostname}:${port}`;
    }
    return 'http://127.0.0.1:10000';
}

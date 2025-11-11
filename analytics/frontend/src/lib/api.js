import axios from 'axios';

// Use relative URL when in browser, which will be proxied by Vite
const getApiBaseUrl = () => {
    // Check if we're in development with Vite proxy
    if (import.meta.env.DEV) {
        return '/api';  // Relative URL - Vite will proxy to backend
    }
    // For production, use environment variable
    const envUrl = import.meta.env.VITE_ANALYTICS_API_BASE_URL;
    if (envUrl) {
        return envUrl;
    }
    // Fallback
    return 'http://localhost:4001/api';
};

export const api = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
});

import axios from 'axios';
// Get API base URL from environment variable or use default
const getApiBaseUrl = () => {
    // In Vite, environment variables are accessed via import.meta.env
    const envUrl = import.meta.env.VITE_ANALYTICS_API_BASE_URL;
    if (envUrl) {
        return envUrl;
    }
    // Fallback for development
    return 'http://localhost:4000/api';
};
export const api = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
});

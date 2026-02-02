import axios from 'axios';

const getKbBaseUrl = () => {
  // Check if we have an explicit environment variable (highest priority)
  const envUrl = import.meta.env.VITE_KB_API_BASE_URL;
  if (envUrl) {
    return envUrl;
  }
  
  // In development, prefer proxy path (works in Docker)
  // The proxy '/kb-api/api/v1' will be rewritten to '/api/v1' by Vite
  // If running locally outside Docker, the proxy won't work, so use direct connection
  if (import.meta.env.DEV) {
    // Try to use proxy first - if it fails, the browser will show CORS error
    // but with CORS enabled on backend, direct connection should work
    // For local development, use direct connection to avoid proxy issues
    return 'http://localhost:8000/api/v1';
  }
  
  // Production fallback
  return 'http://localhost:8000/api/v1';
};

export const kbApi = axios.create({
  baseURL: getKbBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

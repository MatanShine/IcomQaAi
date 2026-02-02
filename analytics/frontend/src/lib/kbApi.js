import axios from 'axios';

const getKbBaseUrl = () => {
  // Check if we have an explicit environment variable (highest priority)
  const envUrl = import.meta.env.VITE_KB_API_BASE_URL;
  if (envUrl) {
    return envUrl;
  }

  // In development, use the proxy path which Vite will handle
  // The proxy '/kb-api' is configured in vite.config.ts to forward to 'http://app:8000'
  // This works both in Docker (where app:8000 is accessible) and locally (if backend runs on localhost:8080)
  if (import.meta.env.DEV) {
    return '/kb-api/api/v1';
  }

  // Production: use environment variable or fallback to localhost
  // In production, you should set VITE_KB_API_BASE_URL to the actual API URL
  return 'http://localhost:8080/api/v1';
};

export const kbApi = axios.create({
  baseURL: getKbBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

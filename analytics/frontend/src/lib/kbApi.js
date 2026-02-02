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

  // Production: use environment variable or fallback
  // If no environment variable is set, try to construct from window location
  // Use relative path to avoid mixed content issues - works if reverse proxy forwards /api/v1 to backend
  // Otherwise, use the same protocol as the page with port 8080 (requires reverse proxy SSL termination)
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    // If page is HTTPS, we need to avoid mixed content
    // Option 1: Use relative path (requires reverse proxy to forward /api/v1 to backend)
    // Option 2: Use HTTPS on port 8080 (requires reverse proxy SSL termination)
    // For now, try HTTPS on port 8080 - if this doesn't work, configure reverse proxy
    // or set VITE_KB_API_BASE_URL environment variable to use relative path: '/api/v1'
    if (protocol === 'https:') {
      // Use HTTPS to match the page protocol (requires reverse proxy SSL termination)
      return `https://${hostname}:8080/api/v1`;
    }
    // HTTP page - use HTTP
    return `http://${hostname}:8080/api/v1`;
  }

  // Final fallback (should not be reached in browser context)
  return 'http://localhost:8080/api/v1';
};

export const kbApi = axios.create({
  baseURL: getKbBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

import axios from 'axios';

const getKbBaseUrl = () => {
  if (import.meta.env.DEV) {
    return '/kb-api/api/v1';
  }
  const envUrl = import.meta.env.VITE_APP_API_BASE_URL;
  if (envUrl) {
    return envUrl;
  }
  return 'http://localhost:8000/api/v1';
};

export const kbApi = axios.create({
  baseURL: getKbBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

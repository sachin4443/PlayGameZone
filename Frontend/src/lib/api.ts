import axios, { AxiosError } from 'axios';

/** Empty in development (Vite proxy) and when the backend shares the frontend's origin. */
export const API_ORIGIN: string = import.meta.env.VITE_API_URL || '';

export const PLAYER_TOKEN_KEY = 'px.token';
export const ADMIN_TOKEN_KEY = 'px.admin.token';

function client(tokenKey: string, onUnauthorized: () => void) {
  const instance = axios.create({ baseURL: `${API_ORIGIN}/api`, timeout: 15000 });
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem(tokenKey);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  instance.interceptors.response.use(
    (r) => r,
    (error: AxiosError) => {
      if (error.response?.status === 401 && localStorage.getItem(tokenKey)) {
        localStorage.removeItem(tokenKey);
        onUnauthorized();
      }
      return Promise.reject(error);
    },
  );
  return instance;
}

export const api = client(PLAYER_TOKEN_KEY, () => window.dispatchEvent(new Event('px:logout')));
export const adminApi = client(ADMIN_TOKEN_KEY, () => window.dispatchEvent(new Event('px:admin-logout')));

/** Human readable message from an API / socket / network failure. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(e)) {
    const msg = (e.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
    if (msg) return msg;
    if (!e.response) return 'Cannot reach the server. Check your connection.';
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export function errorCode(e: unknown): string | undefined {
  if (axios.isAxiosError(e)) return (e.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
  return (e as { code?: string } | undefined)?.code;
}

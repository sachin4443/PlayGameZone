import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, PLAYER_TOKEN_KEY } from '../lib/api';
import { closeSocket, getSocket } from '../lib/socket';
import { setMuted } from '../lib/sound';
import type { Me } from '../lib/types';

interface AuthValue {
  user: Me | null;
  loading: boolean;
  signIn: (token: string, user: Me) => void;
  signOut: () => void;
  refresh: () => Promise<void>;
  setUser: (user: Me) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function applyTheme(theme: 'light' | 'dark' | 'auto') {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('px.theme', theme);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(() => !!localStorage.getItem(PLAYER_TOKEN_KEY));

  const setUser = useCallback((u: Me) => {
    setUserState(u);
    applyTheme(u.theme);
    setMuted(!u.soundEnabled);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await api.get<Me>('/auth/me');
    setUser(data);
  }, [setUser]);

  const signOut = useCallback(() => {
    localStorage.removeItem(PLAYER_TOKEN_KEY);
    closeSocket();
    setUserState(null);
  }, []);

  const signIn = useCallback((token: string, u: Me) => {
    localStorage.setItem(PLAYER_TOKEN_KEY, token);
    setUser(u);
  }, [setUser]);

  useEffect(() => {
    if (!localStorage.getItem(PLAYER_TOKEN_KEY)) return;
    refresh().catch(() => undefined).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const onLogout = () => signOut();
    window.addEventListener('px:logout', onLogout);
    return () => window.removeEventListener('px:logout', onLogout);
  }, [signOut]);

  // Keep the wallet in sync with server-side point movements.
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();
    const onWallet = () => void refresh().catch(() => undefined);
    socket.on('wallet-update', onWallet);
    return () => void socket.off('wallet-update', onWallet);
  }, [user?.id, refresh]);

  const value = useMemo(() => ({ user, loading, signIn, signOut, refresh, setUser }), [user, loading, signIn, signOut, refresh, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

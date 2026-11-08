import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api, setApiToken, setOnUnauthorized } from '@/lib/api';
import { turnOffPush } from '@/lib/push';
import { applyPulledPrefs, clearSyncedPrefs, loadToken, saveToken, setPrefPusher } from '@/lib/storage';
import { setStreamToken } from '@/lib/ws';

type AuthState = {
  ready: boolean;
  token: string | null;
  // Resolves to an mfaTicket when the account is an admin with 2-step login: finish with signInWithCode.
  signIn: (email: string, password: string) => Promise<{ mfaTicket?: string }>;
  signInWithCode: (mfaTicket: string, code: string) => Promise<void>;
  setSession: (token: string) => Promise<void>;
  register: (fullName: string, email: string, password: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// The account's settings arrive before the screens open, so a phone signed in for the first time looks the way this person left it
// elsewhere. Waits at most `wait` ms: offline, the screens open with this device's own copy, and changes are sent when back online.
async function pullSettings(wait: number) {
  try {
    const r = await Promise.race([
      api<{ prefs: Record<string, unknown> }>('/me/settings'),
      new Promise<null>((res) => setTimeout(() => res(null), wait)),
    ]);
    if (r) await applyPulledPrefs(r.prefs);
  } catch { /* offline: this device's copy is used */ }
  setPrefPusher((name, value) => api('/me/settings', { method: 'PUT', body: { name, value } }));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const apply = useCallback(async (t: string | null) => {
    setApiToken(t);
    setStreamToken(t);
    await saveToken(t);
    if (t) await pullSettings(4000);
    else { setPrefPusher(null); await clearSyncedPrefs(); }
    setToken(t);
    if (!t) queryClient.clear();
    else { void queryClient.invalidateQueries({ queryKey: ['favorites'] }); void queryClient.invalidateQueries({ queryKey: ['signals-seen'] }); }
  }, [queryClient]);

  useEffect(() => {
    setOnUnauthorized(() => { void apply(null); });
    // back from Google: the address holds a Supabase token for a moment. It is swapped for a session and wiped from the address at once.
    const back = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.hash.slice(1)) : null;
    const fromGoogle = back?.get('type') === 'recovery' ? null : back?.get('access_token');
    if (back && (fromGoogle || back.get('error')) && back.get('type') !== 'recovery') window.history.replaceState(null, '', window.location.pathname);
    (fromGoogle
      ? api<{ token?: string }>('/auth/oauth', { method: 'POST', body: { accessToken: fromGoogle } }).then((r) => r.token ?? loadToken()).catch(() => loadToken())
      : loadToken()
    ).then(async (t) => {
      if (fromGoogle && t) await saveToken(t);
      setApiToken(t);
      setStreamToken(t);
      if (t) await pullSettings(2500);
      setToken(t);
      setReady(true);
    });
  }, [apply]);

  const value = useMemo<AuthState>(() => ({
    ready,
    token,
    signIn: async (email, password) => {
      const r = await api<{ token?: string; mfaRequired?: boolean; mfaTicket?: string }>('/auth/login', { method: 'POST', body: { email, password } });
      if (r.mfaRequired) return { mfaTicket: r.mfaTicket };
      await apply(r.token!);
      return {};
    },
    signInWithCode: async (mfaTicket, code) => {
      const r = await api<{ token: string }>('/auth/login/mfa', { method: 'POST', body: { mfaTicket, code } });
      await apply(r.token);
    },
    setSession: (t) => apply(t),
    register: async (fullName, email, password, inviteCode) => {
      const r = await api<{ token: string }>('/auth/register', { method: 'POST', body: { fullName, email, password, inviteCode: inviteCode || undefined } });
      await apply(r.token);
    },
    // this device stops getting this person's alerts
    signOut: async () => { await turnOffPush().catch(() => {}); await apply(null); },
  }), [ready, token, apply]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

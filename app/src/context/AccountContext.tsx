// Profile + wallets for the signed-in user, the active wallet, and refreshes pushed by the server.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Account, type Me } from '@/lib/api';
import { subscribeEvents } from '@/lib/ws';
import { useAuth } from './AuthContext';

type AccountState = {
  me: Me | undefined;
  loading: boolean;
  activeAccount: Account | undefined;
  switchAccount: (id: string) => void;
  refresh: () => void;
};

const AccountContext = createContext<AccountState | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: !!token });

  // Balances only change on the server; refetch whenever it tells us a trade or task finished.
  useEffect(() => {
    if (!token) return;
    return subscribeEvents(() => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['trades'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    });
  }, [token, qc]);

  const switchMutation = useMutation({
    mutationFn: (id: string) => api('/me', { method: 'PATCH', body: { activeAccountId: id } }),
    onMutate: (id) => {
      qc.setQueryData<Me>(['me'], (old) => old && { ...old, profile: { ...old.profile, active_account_id: id } });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const value = useMemo<AccountState>(() => {
    const data = me.data;
    const active = data?.accounts.find((a) => a.id === data.profile.active_account_id)
      ?? data?.accounts.find((a) => a.type === 'DEMO');
    return {
      me: data,
      loading: me.isLoading,
      activeAccount: active,
      switchAccount: (id) => switchMutation.mutate(id),
      refresh: () => { void me.refetch(); },
    };
  }, [me, switchMutation]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside AccountProvider');
  return ctx;
}

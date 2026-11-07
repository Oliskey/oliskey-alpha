// Live counts for the navigation and tabs, from the same server lists the screens use, so a number never disagrees with
// the list behind it. Only this account's own open trades and waiting orders count.
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '@/context/AccountContext';
import { api, type AiTrader, type Trade } from '@/lib/api';

export function useTradeCounts() {
  const { activeAccount } = useAccount();
  const open = useQuery({
    queryKey: ['trades', 'open'], queryFn: () => api<{ trades: Trade[] }>('/trades?status=open&limit=100'),
    select: (d) => d.trades, refetchInterval: 10_000,
  });
  const orders = useQuery({
    queryKey: ['orders', 'pending'], queryFn: () => api<{ account_id: string }[]>('/orders?status=pending'), refetchInterval: 15_000,
  });
  const mine = (open.data ?? []).filter((t) => t.account_id === activeAccount?.id);
  const waiting = (orders.data ?? []).filter((o) => o.account_id === activeAccount?.id).length;
  // only trades made with this account's own money, the AI's for this person included
  const byMode = (mode: Trade['mode']) => mine.filter((t) => t.mode === mode).length;
  return { total: mine.length + waiting, open: mine.length, waiting, byMode };
}

export const useAiTrader = () => useQuery({
  queryKey: ['intel', 'ai'], queryFn: () => api<AiTrader>('/intel/ai'), refetchInterval: 20_000, retry: false,
});

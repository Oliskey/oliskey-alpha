// Profitability Boosts from the server: how many are waiting and whether one is running.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const BOOST_POINTS = 10;   // what the server adds to a Fixed Time payout (apply_boost in migration 010)

export function useBoosts() {
  const q = useQuery({
    queryKey: ['boosts'], queryFn: () => api<{ available: number; active_until: string | null }>('/boosts'), refetchInterval: 60_000, retry: false,
  });
  const until = q.data?.active_until ? new Date(q.data.active_until).getTime() : 0;
  return { available: q.data?.available ?? 0, until, isLoading: q.isLoading, refetch: q.refetch };
}

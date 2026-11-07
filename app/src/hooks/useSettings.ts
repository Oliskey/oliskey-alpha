import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Settings = { live_trading_enabled: boolean; demo_start_balance: string; min_deposit_ngn: string; min_withdrawal_ngn: string };

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 60_000 });
}

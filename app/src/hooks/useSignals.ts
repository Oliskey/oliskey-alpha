// Active trade ideas. While any is active the Signals icon stays lit; one this person has not looked at yet also blinks.
// "Seen" lives in the query cache so the icon and the panel share it.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type IntelIdea } from '@/lib/api';
import { getPref, setPref } from '@/lib/storage';

export function useSignals() {
  const qc = useQueryClient();
  const ideas = useQuery({ queryKey: ['intel', 'ideas'], queryFn: () => api<IntelIdea[]>('/intel/ideas?limit=200'), refetchInterval: 60_000, retry: false });
  const seenQ = useQuery({ queryKey: ['signals-seen'], queryFn: async () => Number(await getPref('signalsSeen')) || 0, staleTime: Infinity });
  const seen = seenQ.data ?? 0;
  const now = Date.now();
  const active = (ideas.data ?? []).filter((i) => i.kind === 'idea' && i.status === 'open' && !i.taken && new Date(i.enter_until).getTime() > now);
  const newest = active.reduce((m, i) => Math.max(m, i.id), 0);
  const markSeen = () => {
    if (seenQ.isSuccess && newest > seen) { qc.setQueryData(['signals-seen'], newest); void setPref('signalsSeen', String(newest)); }
  };
  return { active, hasActive: active.length > 0, alert: seenQ.isSuccess && newest > seen, markSeen };
}

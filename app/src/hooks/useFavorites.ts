// Favourite markets, shared through the query cache so every list on screen shows the same stars. Saved on this device and the account, so they follow the person (lib/storage SYNCED).
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPref, setPref } from '@/lib/storage';

const KEY = ['favorites'];

export function useFavorites() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY, staleTime: Infinity,
    queryFn: async () => { try { return JSON.parse((await getPref('favorites')) ?? '[]') as string[]; } catch { return [] as string[]; } },
  });
  const favorites = useMemo(() => new Set(q.data ?? []), [q.data]);
  const toggle = useCallback((id: string) => {
    const now = qc.getQueryData<string[]>(KEY) ?? [];
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    qc.setQueryData(KEY, next);
    void setPref('favorites', JSON.stringify(next));
  }, [qc]);
  return { favorites, toggle };
}

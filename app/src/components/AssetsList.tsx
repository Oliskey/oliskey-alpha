// Assets list shared by Home and Market: mode tabs, sort / favorites / category chips, live rows.
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ListFilter, Search, Star } from 'lucide-react-native';
import { api, type Asset } from '@/lib/api';
import { price as fmtPrice } from '@/lib/format';
import { useAssets } from '@/hooks/useMarket';
import { colors, font, type, createStyles } from '@/theme';
import { Chip, ChipRow } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { Txt } from '@/ui/Txt';
import { AssetIcon } from './AssetIcon';
import { UnderlineTabs } from './UnderlineTabs';

export type ListMode = 'fixed_time' | 'inzone' | 'forex' | 'stocks';
const MODE_TABS = [
  { key: 'fixed_time', label: 'Fixed Time' }, { key: 'inzone', label: 'InZone' },
  { key: 'forex', label: 'Forex' }, { key: 'stocks', label: 'Stocks' },
] as const;
const SORTS = ['Profitability', 'Name A-Z', 'Name Z-A', 'Ask price (low to high)', 'Ask price (high to low)'] as const;
const CATEGORIES = [
  { key: 'all', label: 'All markets' }, { key: 'currency', label: 'Currencies' }, { key: 'crypto', label: 'Crypto' },
  { key: 'index', label: 'Indices' }, { key: 'commodity', label: 'Commodities' },
] as const;
const GROUPS = CATEGORIES.filter((c) => c.key !== 'all') as readonly { key: Asset['category']; label: string }[];

export function AssetsList({ favorites, onToggleFavorite, showTitle = true, onPick }: {
  favorites: Set<string>; onToggleFavorite: (id: string) => void; showTitle?: boolean;
  onPick?: (id: string) => void;   // called before opening the asset (e.g. to close the Terminal's asset panel)
}) {
  const { assets } = useAssets();
  // One request every 2 s refreshes every price in the list (streaming ticks for 75 assets would flood a phone).
  const live = useQuery({ queryKey: ['asset-prices'], queryFn: () => api<Asset[]>('/assets'), refetchInterval: 2000 });
  const prices = useMemo(() => Object.fromEntries((live.data ?? []).map((a) => [a.id, a.price ?? 0])) as Record<string, number>, [live.data]);
  const [mode, setMode] = useState<ListMode>('fixed_time');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('Profitability');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['key']>('all');
  const [onlyFav, setOnlyFav] = useState(false);
  const [sheet, setSheet] = useState<'sort' | 'category' | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const payout = (a: Asset) => Number(mode === 'inzone' ? a.payout_inzone : a.payout_fixed);
  const rows = useMemo(() => {
    let list = assets.filter((a) => (category === 'all' || a.category === category) && (!onlyFav || favorites.has(a.id)));
    if (query) list = list.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));
    const p = (a: Asset) => prices[a.id] ?? a.price ?? 0;
    const by: Record<string, (x: Asset, y: Asset) => number> = {
      Profitability: (x, y) => payout(y) - payout(x),
      'Name A-Z': (x, y) => x.name.localeCompare(y.name),
      'Name Z-A': (x, y) => y.name.localeCompare(x.name),
      'Ask price (low to high)': (x, y) => p(x) - p(y),
      'Ask price (high to low)': (x, y) => p(y) - p(x),
    };
    return list.slice().sort(by[sort]);
  }, [assets, category, onlyFav, favorites, query, sort, mode, prices]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (a: Asset) => { onPick?.(a.id); router.navigate({ pathname: '/terminal', params: { asset: a.id, mode: mode === 'stocks' ? 'fixed_time' : mode } }); };

  return (
    <View style={{ gap: 12 }}>
      {showTitle ? (
        <View style={styles.titleRow}>
          <Txt style={type.sectionTitle}>Assets</Txt>
          <Press onPress={() => setSearching((s) => !s)} accessibilityLabel="Search assets"><Search size={24} color={colors.text} /></Press>
        </View>
      ) : null}
      {searching || !showTitle ? (
        <View style={styles.search}>
          <Search size={18} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search assets" placeholderTextColor={colors.muted}
            style={{ flex: 1, minHeight: 44, color: colors.text, fontFamily: font.regular, fontSize: 15, outlineStyle: 'none' } as object} />
        </View>
      ) : null}

      <UnderlineTabs tabs={MODE_TABS} value={mode} onChange={(k) => setMode(k as ListMode)} dot="inzone" />

      {mode === 'stocks' ? (
        <Txt style={{ color: colors.muted, textAlign: 'center', paddingVertical: 24 }}>
          Stocks need a live market-data provider and will be added later.
        </Txt>
      ) : (
        <>
          <ChipRow>
            <Chip label={sort.startsWith('Ask') ? 'Ask price' : sort} active={sheet === 'sort'} open={sheet === 'sort'} onPress={() => setSheet('sort')} icon={<ListFilter size={16} color={colors.text} />} />
            <Press onPress={() => setOnlyFav((f) => !f)} style={[styles.favChip, onlyFav && { backgroundColor: colors.surface2 }]}>
              <Star size={16} color={onlyFav ? colors.demo : colors.text} fill={onlyFav ? colors.demo : 'transparent'} />
              <Txt style={{ fontSize: 15 }}>Favorites</Txt>
            </Press>
            <Chip label={CATEGORIES.find((c) => c.key === category)!.label} active={sheet === 'category'} open={sheet === 'category'} onPress={() => setSheet('category')} />
          </ChipRow>

          <View style={styles.header}>
            <Txt style={styles.headerText}>Name</Txt>
            <Txt style={styles.headerText}>{mode === 'forex' ? 'Max multiplier' : 'Profitability'}</Txt>
          </View>

          {rows.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
              <Star size={48} color={colors.muted} />
              <Txt style={{ color: colors.muted, textAlign: 'center' }}>{onlyFav ? 'No favorites yet. Tap the star on an asset to add it.' : 'No assets match.'}</Txt>
            </View>
          ) : (category === 'all' ? GROUPS : GROUPS.filter((g) => g.key === category)).map((g) => {
            const list = rows.filter((a) => a.category === g.key);
            if (!list.length) return null;
            return (
              <View key={g.key} style={{ gap: 2 }}>
                {category === 'all' ? (
                  <Txt style={styles.group}>{g.label} · {list.length}</Txt>
                ) : null}
                {list.map((a) => (
                  <Press key={a.id} onPress={() => open(a)} style={styles.row} haptic={false}>
                    <AssetIcon id={a.id} size={32} />
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontSize: 15, fontFamily: font.medium }}>{a.name}</Txt>
                      <Txt style={{ fontSize: 12, color: colors.muted, fontVariant: ['tabular-nums'] }}>
                        {fmtPrice(prices[a.id] ?? a.price ?? a.base_price, a.decimals)}
                        {a.price_source === 'binance' ? <Txt style={{ fontSize: 12, color: colors.up }}>  ● Live</Txt> : null}
                      </Txt>
                    </View>
                    <Txt style={{ fontSize: 15, fontFamily: font.medium, color: mode === 'forex' ? colors.text : colors.up }}>
                      {mode === 'forex' ? `${a.max_leverage}x` : `${payout(a)}%`}
                    </Txt>
                    <Press onPress={() => onToggleFavorite(a.id)} hitSlop={8} accessibilityLabel={favorites.has(a.id) ? 'Remove from favorites' : 'Add to favorites'}>
                      <Star size={20} color={favorites.has(a.id) ? colors.demo : colors.faint} fill={favorites.has(a.id) ? colors.demo : 'transparent'} />
                    </Press>
                  </Press>
                ))}
              </View>
            );
          })}
        </>
      )}

      <Sheet open={sheet !== null} onClose={() => setSheet(null)}>
        <Txt style={styles.sheetTitle}>{sheet === 'sort' ? 'Sort by' : 'Markets'}</Txt>
        {(sheet === 'sort' ? SORTS.map((s) => ({ key: s, label: s })) : CATEGORIES).map((o) => {
          const selected = sheet === 'sort' ? sort === o.key : category === o.key;
          return (
            <Press key={o.key} style={styles.option} haptic={false}
              onPress={() => { if (sheet === 'sort') setSort(o.key as typeof sort); else setCategory(o.key as typeof category); setSheet(null); }}>
              <Txt style={{ fontSize: 16 }}>{o.label}</Txt>
              {selected ? <Check size={20} color={colors.up} /> : null}
            </Press>
          );
        })}
      </Sheet>
    </View>
  );
}

const styles = createStyles(() => ({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface2 },
  favChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  headerText: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
  group: { fontSize: 13, fontFamily: font.semibold, color: colors.muted, marginTop: 14, marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontFamily: font.semibold, textAlign: 'center', marginBottom: 8 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 52, paddingHorizontal: 20 },
}));

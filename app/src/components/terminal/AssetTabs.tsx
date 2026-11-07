// Recent-asset tabs above the chart (desktop): "+" opens a search panel with the full asset list; each tab switches
// the chart, the × closes it (shown on hover or keyboard focus, always on the selected tab and on touch screens). Tabs are
// remembered on this device.
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { getPref, setPref } from '@/lib/storage';
import { useAssets } from '@/hooks/useMarket';
import { useFavorites } from '@/hooks/useFavorites';
import { colors, font, createStyles } from '@/theme';
import { glass, glassLens } from '@/ui/glass';
import { HoverReveal, revealHost, SideScroll } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { AssetIcon } from '../AssetIcon';
import { AssetsList } from '../AssetsList';
import { BoostButton } from './BoostButton';

const MAX_TABS = 6;

export function AssetTabs({ current, payoutOf, onSelect }: { current: string; payoutOf: (id: string) => string | null; onSelect: (id: string) => void }) {
  const { byId } = useAssets();
  const { favorites, toggle } = useFavorites();
  const [tabs, setTabs] = useState<string[]>([]);
  const [panel, setPanel] = useState(false);
  // saved tabs arrive after the current asset was added: keep it, or a first-time visitor is left with no tab
  useEffect(() => { getPref('assetTabs').then((v) => { try { const t = JSON.parse(v ?? '[]'); if (Array.isArray(t)) setTabs((now) => [...now.filter((x) => !t.includes(x)), ...t].slice(0, MAX_TABS)); } catch { /* ignore */ } }); }, []);
  // the current asset always has a tab
  useEffect(() => {
    setTabs((t) => {
      if (t.includes(current)) return t;
      const next = [current, ...t].slice(0, MAX_TABS);
      void setPref('assetTabs', JSON.stringify(next));
      return next;
    });
  }, [current]);
  const close = (id: string) => setTabs((t) => {
    const next = t.filter((x) => x !== id);
    void setPref('assetTabs', JSON.stringify(next));
    if (id === current && next[0]) onSelect(next[0]);
    return next;
  });

  return (
    <View style={{ zIndex: 20 }}>
      <View style={styles.row}>
        <BoostButton />
        <Press style={[styles.plus, glass('regular', { shadow: false })]} onPress={() => setPanel((v) => !v)} accessibilityLabel={panel ? 'Close asset list' : 'Add asset'}>
          {panel ? <X size={20} color={colors.text} strokeWidth={2.25} /> : <Plus size={20} color={colors.text} strokeWidth={2.25} />}
        </Press>
        <SideScroll contentContainerStyle={{ gap: 8 }}>
          {tabs.map((id) => {
            const on = id === current;
            const pay = payoutOf(id);
            return (
              <Press key={id} {...revealHost} haptic={false} onPress={() => onSelect(id)} style={[styles.tab, on ? glassLens() : glass('regular', { shadow: false })]} accessibilityLabel={byId.get(id)?.name ?? id}>
                <AssetIcon id={id} size={22} />
                <Txt style={{ fontSize: 14, fontFamily: font.semibold }} numberOfLines={1}>{byId.get(id)?.name ?? id}</Txt>
                {pay ? <Txt style={{ fontSize: 14, fontFamily: font.semibold, color: colors.up }}>{pay}</Txt> : null}
                {tabs.length > 1 ? (
                  <HoverReveal always={on} style={{ marginLeft: 2 }}>
                    <Press hitSlop={8} haptic={false} onPress={() => close(id)} accessibilityLabel={`Close ${byId.get(id)?.name ?? id}`}>
                      <X size={14} color={colors.muted} />
                    </Press>
                  </HoverReveal>
                ) : null}
              </Press>
            );
          })}
        </SideScroll>
      </View>
      {panel ? (
        <View style={[styles.panel, glass('regular')]}>
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            <AssetsList favorites={favorites} onToggleFavorite={toggle} showTitle={false} onPick={(id) => { setPanel(false); onSelect(id); }} />
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = createStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 52 },
  plus: { width: 42, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12, borderRadius: 12, maxWidth: 260 },
  panel: { position: 'absolute', top: 54, left: 60, width: 380, maxHeight: 560, borderRadius: 18, overflow: 'hidden' },
}));

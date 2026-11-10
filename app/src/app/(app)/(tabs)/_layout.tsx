import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { X } from 'lucide-react-native';
import { TabBar, TabSpaceProvider } from '@/components/TabBar';
import { LayoutOverride, RAIL_W, useLayout } from '@/hooks/useLayout';
import { colors } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { prefersReducedMotion } from '@/ui/Press';
import { FadeIn } from '@/ui/FadeIn';
import { EASE, MOTION } from '@/ui/motion';
import { Terminal } from './terminal';

// Phone: tabs with the floating pill. Tablet: rail + one full page.
// Desktop: the chart never leaves the screen. Rail items open their page in a panel beside it; the × or the same
// item again closes the panel and the chart takes the room back.
const MAIN_TABS = ['index', 'funded', 'trades', 'terminal', 'market', 'help'];

export default function TabsLayout() {
  const { isPhone, isDesktop, width } = useLayout();
  const pathname = usePathname();
  const panelOpen = isDesktop && pathname !== '/terminal';
  const panelW = Math.max(320, Math.min(400, Math.round(width * 0.25)));
  const [dockW] = useState(() => new Animated.Value(panelOpen ? panelW : 0));
  useEffect(() => {
    Animated.timing(dockW, { toValue: panelOpen ? panelW : 0, duration: prefersReducedMotion() ? 0 : 280, easing: EASE.glide, useNativeDriver: false }).start();
  }, [panelOpen, panelW, dockW]);

  const tabs = (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      backBehavior="history"
      screenLayout={({ children, route, navigation }) => {
        // Every page arrives the same way (ui/motion.ts): main tabs switch almost at once with a short fade that hides the
        // first paint; other pages fade in while rising 10 px. Done here, not with the navigator's own fade, which showed
        // the previously visited tab for a moment and then a blank frame before the new page.
        const main = MAIN_TABS.includes(route.name);
        const page = <ScreenEnter navigation={navigation} main={main || isDesktop} warm={route.name === 'index' && !isDesktop}>{children}</ScreenEnter>;
        return isDesktop ? (
          <LayoutOverride.Provider value={{ sceneW: panelW }}>
            <View style={{ flex: 1 }}>
              {page}
              {panelOpen && pathname !== '/' ? (
                <View style={{ position: 'absolute', top: 12, right: 12 }}>
                  <IconButton label="Close panel" size={40} onPress={() => router.navigate('/terminal')}><X size={20} color={colors.text} /></IconButton>
                </View>
              ) : null}
            </View>
          </LayoutOverride.Provider>
        ) : page;
      }}
      screenOptions={({ route }) => ({
        headerShown: false, sceneStyle: { backgroundColor: isDesktop ? colors.surface : colors.bg },
        animation: 'none',   // the entrance is ScreenEnter's (above)
        tabBarPosition: isPhone ? 'bottom' : 'left',
      })}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="funded" />
      <Tabs.Screen name="trades" />
      <Tabs.Screen name="terminal" />
      <Tabs.Screen name="market" />
      <Tabs.Screen name="help" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="invite" />
      <Tabs.Screen name="rewards" />
      <Tabs.Screen name="scanner" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="skill-hub" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="withdraw" />
      <Tabs.Screen name="course/[id]" />
      <Tabs.Screen name="lesson/[id]" />
      <Tabs.Screen name="quotes/[id]" />
    </Tabs>
  );

  return (
    <TabSpaceProvider>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
        <Animated.View style={isDesktop ? { width: Animated.add(dockW, RAIL_W), overflow: 'hidden' } : { flex: 1 }}>{tabs}</Animated.View>
        {isDesktop ? (
          <LayoutOverride.Provider value={{ contentW: width - RAIL_W - (panelOpen ? panelW : 0) }}>
            <View style={{ flex: 1 }}><Terminal /></View>
          </LayoutOverride.Provider>
        ) : null}
      </View>
    </TabSpaceProvider>
  );
}

// Pages people open first, prepared quietly after Home has shown: their first visit is then as quick as the next one
// (a page building itself for the first time showed a blank screen for about a third of a second).
const WARM = ['trades', 'terminal', 'market', 'help', 'profile'];

type Nav = { addListener: (e: 'focus', fn: () => void) => () => void; preload?: (name: string) => void };

// Plays the page's entrance each time it comes into view (pages stay mounted between visits).
function ScreenEnter({ navigation, main, warm, children }: { navigation: Nav; main: boolean; warm?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!warm || !navigation.preload) return;
    // one at a time, well after Home is up, so the first screen is never slowed down
    const ids = WARM.map((name, i) => setTimeout(() => { try { navigation.preload?.(name); } catch { /* not ready: it opens normally */ } }, 1500 + i * 600));
    return () => ids.forEach(clearTimeout);
  }, [warm, navigation]);
  const [visit, setVisit] = useState(0);
  const first = useRef(true);   // the first visit already plays on mount; replaying it would flicker
  useEffect(() => navigation.addListener('focus', () => { if (first.current) { first.current = false; return; } setVisit((v) => v + 1); }), [navigation]);
  return <FadeIn replay={visit} rise={main ? 0 : MOTION.enterRise} duration={main ? MOTION.tabFadeMs : MOTION.enterMs}>{children}</FadeIn>;
}

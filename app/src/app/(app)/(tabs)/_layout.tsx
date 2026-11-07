import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { X } from 'lucide-react-native';
import { TabBar, TabSpaceProvider } from '@/components/TabBar';
import { LayoutOverride, RAIL_W, useLayout } from '@/hooks/useLayout';
import { colors } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { prefersReducedMotion } from '@/ui/Press';
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
    Animated.timing(dockW, { toValue: panelOpen ? panelW : 0, duration: prefersReducedMotion() ? 0 : 280, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: false }).start();
  }, [panelOpen, panelW, dockW]);

  const tabs = (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      backBehavior="history"
      screenLayout={({ children }) => (isDesktop ? (
        <LayoutOverride.Provider value={{ sceneW: panelW }}>
          <View style={{ flex: 1 }}>
            {children}
            {panelOpen && pathname !== '/' ? (
              <View style={{ position: 'absolute', top: 12, right: 12 }}>
                <IconButton label="Close panel" size={40} onPress={() => router.navigate('/terminal')}><X size={20} color={colors.text} /></IconButton>
              </View>
            ) : null}
          </View>
        </LayoutOverride.Provider>
      ) : children)}
      screenOptions={({ route }) => ({
        headerShown: false, sceneStyle: { backgroundColor: isDesktop ? colors.surface : colors.bg },
        // Main tabs switch at once and secondary pages fade in. Not on desktop: the panel can stay blank waiting for that fade.
        animation: isDesktop || MAIN_TABS.includes(route.name) ? 'none' : 'fade',
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

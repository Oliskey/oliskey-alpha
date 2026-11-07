// Responsive layout tokens. Breakpoints: phone < 768 <= tablet < 1024 <= desktop.
// Gutters grow with the screen; content is capped so lines and cards never stretch edge to edge.
import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

export type Device = 'phone' | 'tablet' | 'desktop';

export const SIDEBAR_W = 232;   // desktop navigation sidebar (logo + labels beside icons)
export const RAIL_W = 88;       // tablet navigation rail (labels under icons)

// Desktop: pages open in a panel beside the chart. sceneW = the panel's width (the page lays out as on a phone);
// contentW = the room left for the chart screen, which keeps its desktop arrangement.
export const LayoutOverride = createContext<{ sceneW?: number; contentW?: number } | null>(null);
export const useInDock = () => useContext(LayoutOverride)?.sceneW != null;

export function useLayout() {
  const win = useWindowDimensions();
  const over = useContext(LayoutOverride);
  const width = over?.sceneW ?? win.width;
  const { height } = win;
  const device: Device = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'phone';
  const gutter = device === 'desktop' ? 32 : device === 'tablet' ? 24 : 16;
  // Space the screen content actually gets (the sidebar or rail takes its share).
  const contentW = over?.contentW ?? width - (device === 'phone' ? 0 : RAIL_W);   // tablet and desktop: slim rail
  return {
    width, height, device, gutter, contentW,
    isPhone: device === 'phone',
    isTablet: device === 'tablet',
    isDesktop: device === 'desktop',
    // Grid columns for card lists (ideas, markets, courses): 1 on phones, 2 on tablets, 3 on wide desktops.
    columns: contentW >= 1280 ? 3 : contentW >= 720 ? 2 : 1,
  };
}

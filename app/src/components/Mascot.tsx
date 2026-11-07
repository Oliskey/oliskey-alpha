// The Oliskey Alpha mascot "Ollie": our own character, drawn in vector so it stays sharp at every size. Soft shading,
// gloss and expressive eyes give it depth; poses fit the place it appears. Its colours are fixed brand colours, the
// same in both themes. Replace with final artwork when it is commissioned: the props stay the same.
import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

export type MascotPose = 'hello' | 'book' | 'trophy' | 'face';

const BODY = 'M60 16 C84 16 98 38 98 66 C98 90 82 102 60 102 C38 102 22 90 22 66 C22 38 36 16 60 16 Z';
const INK = '#14122B';

export function Mascot({ size = 80, glow = true, pose = 'hello' }: { size?: number; glow?: boolean; pose?: MascotPose }) {
  // unique per drawing: a hidden copy elsewhere on the page must not break this one's gradients
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const u = (n: string) => `${n}${id}`;
  const face = pose === 'face';
  const arm = `url(#${u('limb')})`;
  return (
    <Svg width={size} height={size} viewBox={face ? '16 14 88 88' : '0 0 120 120'}>
      <Defs>
        <RadialGradient id={u('body')} cx="36%" cy="26%" r="82%">
          <Stop offset="0" stopColor="#C9BBFF" />
          <Stop offset="0.38" stopColor="#8466FF" />
          <Stop offset="0.76" stopColor="#4D30E6" />
          <Stop offset="1" stopColor="#2A1FA8" />
        </RadialGradient>
        <LinearGradient id={u('rim')} x1="0.2" y1="0.1" x2="1" y2="1">
          <Stop offset="0.55" stopColor="#3BA4FF" stopOpacity={0} />
          <Stop offset="1" stopColor="#3BE0FF" stopOpacity={0.6} />
        </LinearGradient>
        <LinearGradient id={u('limb')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7C5CFF" />
          <Stop offset="1" stopColor="#3A25C4" />
        </LinearGradient>
        <RadialGradient id={u('iris')} cx="40%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#4FC3FF" />
          <Stop offset="1" stopColor="#1B3FBF" />
        </RadialGradient>
        <RadialGradient id={u('glow')} cx="50%" cy="52%" r="50%">
          <Stop offset="0" stopColor="#7C5CFF" stopOpacity={0.5} />
          <Stop offset="1" stopColor="#3BA4FF" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={u('gold')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFE08A" />
          <Stop offset="1" stopColor="#E89A1C" />
        </LinearGradient>
      </Defs>

      {glow && !face ? <Circle cx={60} cy={60} r={58} fill={`url(#${u('glow')})`} /> : null}
      {!face ? <Ellipse cx={60} cy={111} rx={30} ry={4.5} fill="#000000" opacity={0.22} /> : null}

      {/* feet */}
      {!face ? (
        <G>
          <Ellipse cx={45} cy={103} rx={12} ry={7} fill="#3A25C4" />
          <Ellipse cx={75} cy={103} rx={12} ry={7} fill="#3A25C4" />
          <Ellipse cx={42} cy={100.5} rx={5} ry={2} fill="#FFFFFF" opacity={0.3} />
          <Ellipse cx={72} cy={100.5} rx={5} ry={2} fill="#FFFFFF" opacity={0.3} />
        </G>
      ) : null}

      {/* the arm behind the body */}
      {pose === 'hello' ? <Path d="M28 72 Q16 76 12 88" stroke={arm} strokeWidth={9} strokeLinecap="round" fill="none" /> : null}
      {pose === 'trophy' ? <Path d="M28 72 Q16 76 13 87" stroke={arm} strokeWidth={9} strokeLinecap="round" fill="none" /> : null}

      {/* body: shading, cool rim light, soft belly, gloss */}
      <Path d={BODY} fill={`url(#${u('body')})`} />
      <Path d={BODY} fill={`url(#${u('rim')})`} />
      <Ellipse cx={60} cy={84} rx={23} ry={15} fill="#FFFFFF" opacity={0.1} />
      <G rotation={-22} originX={44} originY={32}>
        <Ellipse cx={44} cy={32} rx={16} ry={7.5} fill="#FFFFFF" opacity={0.5} />
      </G>
      <Circle cx={31} cy={47} r={2.6} fill="#FFFFFF" opacity={0.55} />

      {/* eyes */}
      {[45, 75].map((x) => (
        <G key={x}>
          <Circle cx={x} cy={58} r={11.5} fill="#FFFFFF" />
          <Circle cx={x + 1} cy={59} r={7.6} fill={`url(#${u('iris')})`} />
          <Circle cx={x + 1} cy={59} r={4.2} fill={INK} />
          <Circle cx={x - 1.6} cy={55.8} r={2.5} fill="#FFFFFF" />
          <Circle cx={x + 3.4} cy={62} r={1.2} fill="#FFFFFF" opacity={0.85} />
        </G>
      ))}
      {/* brows, cheeks, smile */}
      <Path d="M36 42 Q44 37 52 41" stroke={INK} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.75} />
      <Path d="M68 41 Q76 37 84 42" stroke={INK} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.75} />
      <Ellipse cx={33} cy={73} rx={6} ry={3.8} fill="#FF7AC8" opacity={0.6} />
      <Ellipse cx={87} cy={73} rx={6} ry={3.8} fill="#FF7AC8" opacity={0.6} />
      <Path d="M49 74 Q60 79 71 74 Q69 88 60 88 Q51 88 49 74 Z" fill={INK} />
      <Ellipse cx={60} cy={84.5} rx={5.4} ry={3.2} fill="#FF6FA8" />
      <Path d="M51 75 Q60 79 69 75 L68 77.4 Q60 81 52 77.4 Z" fill="#FFFFFF" />

      {/* poses */}
      {pose === 'hello' ? (
        <G>
          <Path d="M92 66 Q106 58 108 40" stroke={arm} strokeWidth={9} strokeLinecap="round" fill="none" />
          <Circle cx={108} cy={36} r={7} fill="#8466FF" />
          <Circle cx={106} cy={34} r={2} fill="#FFFFFF" opacity={0.6} />
        </G>
      ) : null}

      {pose === 'book' ? (
        <G>
          <Path d="M36 96 L60 100 L84 96 L84 76 L60 80 L36 76 Z" fill={`url(#${u('gold')})`} />
          <Path d="M39 92.5 L60 96 L60 80.4 L39 77 Z" fill="#FFFFFF" />
          <Path d="M81 92.5 L60 96 L60 80.4 L81 77 Z" fill="#F1EEFF" />
          <Path d="M43 81.5 L56 83.6 M43 85.5 L56 87.6 M64 83.6 L77 81.5 M64 87.6 L77 85.5" stroke="#8A86A6" strokeWidth={1.3} strokeLinecap="round" />
          <Circle cx={36} cy={86} r={6.5} fill="#8466FF" />
          <Circle cx={84} cy={86} r={6.5} fill="#8466FF" />
        </G>
      ) : null}

      {pose === 'trophy' ? (
        <G>
          <Path d="M92 68 Q104 62 106 48" stroke={arm} strokeWidth={9} strokeLinecap="round" fill="none" />
          <Path d="M94 18 H118 V26 Q118 40 106 41 Q94 40 94 26 Z" fill={`url(#${u('gold')})`} />
          <Path d="M94 22 H89 Q89 32 95 33 M118 22 H119.5" stroke="#E89A1C" strokeWidth={2.4} fill="none" strokeLinecap="round" />
          <Rect x={103} y={40} width={6} height={6} fill="#E89A1C" />
          <Rect x={97} y={45} width={18} height={4.5} rx={2} fill={`url(#${u('gold')})`} />
          <Ellipse cx={100} cy={25} rx={2.2} ry={5} fill="#FFFFFF" opacity={0.65} />
          <Circle cx={106} cy={50} r={6.5} fill="#8466FF" />
        </G>
      ) : null}
    </Svg>
  );
}

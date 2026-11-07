// Asset icon: currency pairs = two overlapping coloured circles with currency codes;
// everything else = rounded tile with a short glyph (own simple artwork, no third-party logos).
import { View } from 'react-native';
import { colors, font } from '@/theme';
import { Txt } from '@/ui/Txt';

const CURRENCY_COLORS: Record<string, string> = {
  EUR: '#2F5BD3', USD: '#1E7F5C', GBP: '#7A3FD1', AUD: '#D9822B', CHF: '#D23B4F', JPY: '#C2185B',
  NZD: '#00897B', CAD: '#E0453A', NGN: '#0E8A4F', ZAR: '#B8860B', TRY: '#C62828', MXN: '#2E7D32',
  SGD: '#AD1457', HKD: '#6A1B9A',
};

const CRYPTO = '#F7931A';
const INDEX = '#2B3A55';
const METAL = '#8A8F98';
const ENERGY = '#3D3D45';
const AGRI = '#5B7F2B';

const TILE: Record<string, { bg: string; glyph: string }> = {
  // crypto
  BTCUSD: { bg: CRYPTO, glyph: '₿' }, ETHUSD: { bg: '#5E6BD8', glyph: 'Ξ' }, SOLUSD: { bg: '#7B3FE4', glyph: 'SOL' },
  BNBUSD: { bg: '#D4A20A', glyph: 'BNB' }, XRPUSD: { bg: '#2A2F36', glyph: 'XRP' }, ADAUSD: { bg: '#1F4FD8', glyph: 'ADA' },
  DOGEUSD: { bg: '#B8952E', glyph: 'Ð' }, DOTUSD: { bg: '#D6337A', glyph: 'DOT' }, LTCUSD: { bg: '#4A6FA5', glyph: 'Ł' },
  AVAXUSD: { bg: '#D9363E', glyph: 'AV' }, LINKUSD: { bg: '#2A5ADA', glyph: 'LNK' }, TRXUSD: { bg: '#C4262E', glyph: 'TRX' },
  TONUSD: { bg: '#0F88D1', glyph: 'TON' }, BCHUSD: { bg: '#3C9A4A', glyph: 'BCH' }, XLMUSD: { bg: '#3A3F47', glyph: 'XLM' },
  UNIUSD: { bg: '#D6337A', glyph: 'UNI' }, ATOMUSD: { bg: '#3B3F6B', glyph: 'ATM' }, NEARUSD: { bg: '#2A2F36', glyph: 'NR' },
  // indices
  ALPHAMET: { bg: '#4B3FA8', glyph: 'αM' }, US500: { bg: INDEX, glyph: '500' }, US100: { bg: INDEX, glyph: '100' },
  US30: { bg: INDEX, glyph: '30' }, UK100: { bg: '#34405E', glyph: 'UK' }, DE40: { bg: '#34405E', glyph: 'DE' },
  FR40: { bg: '#34405E', glyph: 'FR' }, EU50: { bg: '#34405E', glyph: 'EU' }, JP225: { bg: '#34405E', glyph: 'JP' },
  HK50: { bg: '#34405E', glyph: 'HK' }, AU200: { bg: '#34405E', glyph: 'AU' },
  // commodities
  XAUUSD: { bg: '#B8892B', glyph: 'Au' }, XAGUSD: { bg: METAL, glyph: 'Ag' }, XPTUSD: { bg: '#6F7D8C', glyph: 'Pt' },
  XPDUSD: { bg: '#7D7466', glyph: 'Pd' }, COPPER: { bg: '#B06A3B', glyph: 'Cu' }, USOIL: { bg: ENERGY, glyph: 'WTI' },
  UKOIL: { bg: ENERGY, glyph: 'BRN' }, NATGAS: { bg: '#2F6F9F', glyph: 'GAS' }, CORN: { bg: '#B8952E', glyph: 'CRN' },
  WHEAT: { bg: '#A07A2C', glyph: 'WHT' }, SOYBEAN: { bg: AGRI, glyph: 'SOY' }, COFFEE: { bg: '#6B4226', glyph: 'COF' },
  SUGAR: { bg: '#8C8C99', glyph: 'SGR' }, COCOA: { bg: '#5A3A22', glyph: 'COC' },
};

const isPair = (id: string) => id.length === 6 && !!CURRENCY_COLORS[id.slice(0, 3)] && !!CURRENCY_COLORS[id.slice(3)];

// Black or white, whichever reads better on the tile's colour.
const inkOn = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.179 ? '#000000' : '#FFFFFF';
};

export function AssetIcon({ id, size = 32 }: { id: string; size?: number }) {
  if (!isPair(id)) {
    const tile = TILE[id] ?? { bg: colors.surface2, glyph: id.slice(0, 3) };
    const long = tile.glyph.length >= 3;
    return (
      <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: tile.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ fontFamily: font.bold, fontSize: size * (long ? 0.28 : 0.4), letterSpacing: long ? -0.4 : 0, color: inkOn(tile.bg) }}
          numberOfLines={1} allowFontScaling={false}>{tile.glyph}</Txt>
      </View>
    );
  }
  // Base currency large with its code; quote currency as a small badge at the bottom-right.
  const base = id.slice(0, 3);
  const quote = id.slice(3, 6);
  const d = size * 0.86;
  const b = size * 0.46;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: d, height: d, borderRadius: d / 2,
        backgroundColor: CURRENCY_COLORS[base], alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ fontFamily: font.bold, fontSize: Math.max(8, d * 0.3), letterSpacing: -0.4, color: inkOn(CURRENCY_COLORS[base]) }} numberOfLines={1} allowFontScaling={false}>{base}</Txt>
      </View>
      <View style={{ position: 'absolute', right: 0, bottom: 0, width: b, height: b, borderRadius: b / 2, borderWidth: 2, borderColor: colors.bg,
        backgroundColor: CURRENCY_COLORS[quote], alignItems: 'center', justifyContent: 'center' }}>
        {size >= 40 ? <Txt style={{ fontFamily: font.bold, fontSize: b * 0.3, color: inkOn(CURRENCY_COLORS[quote]) }} numberOfLines={1} allowFontScaling={false}>{quote}</Txt> : null}
      </View>
    </View>
  );
}

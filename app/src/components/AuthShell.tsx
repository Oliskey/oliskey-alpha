// The sign-in screens' shared design. Large screens: a dark brand panel beside the form. Phones: the form alone, with the
// panel only on the welcome screen. The panel is deep graphite in both themes with one violet accent; the form follows the
// theme. Its one image is the app's own liquid-glass navigation, and it states only true facts: no charts, prices or winners.
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { ArrowLeft, ArrowUpDown, ChartCandlestick, Check, CircleAlert, CircleHelp, Eye, EyeOff, LayoutGrid, Store, type LucideIcon } from 'lucide-react-native';
import { useLayout } from '@/hooks/useLayout';
import { colors, font, createStyles, isLight } from '@/theme';
import { glass } from '@/ui/glass';
import { IconButton } from '@/ui/IconButton';
import { Logo } from '@/ui/Logo';
import { Press, prefersReducedMotion } from '@/ui/Press';
import { Txt } from '@/ui/Txt';

const web = Platform.OS === 'web';
const FACTS = ['α10,000 in demo funds, reset any time', '75 markets, with live crypto prices', 'Five-minute lessons before you trade'];

// One soft violet light behind the glass, so the glass has something to catch. Nothing decorative beyond it.
function HeroLight() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 620 820" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <Defs>
        <RadialGradient id="auth-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#6A3DFF" stopOpacity={0.62} /><Stop offset="0.6" stopColor="#6A3DFF" stopOpacity={0.14} /><Stop offset="1" stopColor="#6A3DFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={190} cy={430} r={300} fill="url(#auth-glow)" />
    </Svg>
  );
}

// The app's own navigation, parted, as the brand's signature. Decoration only.
function GlassMotif() {
  const glassy = (web ? {
    backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 1px rgba(255,255,255,0.06), 0 14px 40px rgba(0,0,0,0.5)',
    backdropFilter: 'blur(6px) saturate(170%)', WebkitBackdropFilter: 'blur(6px) saturate(170%)',
  } : { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }) as object;
  const icons: LucideIcon[] = [ArrowUpDown, ChartCandlestick, Store, CircleHelp];
  return (
    <View style={styles.motif} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...(web ? ({ 'aria-hidden': true } as object) : null)}>
      <View style={[styles.motifDrop, glassy]}><LayoutGrid size={22} color="#C9BCFF" strokeWidth={2.25} /></View>
      <View style={[styles.motifCapsule, glassy]}>
        {icons.map((Icon, i) => <Icon key={i} size={21} color="rgba(255,255,255,0.88)" strokeWidth={1.9} />)}
      </View>
    </View>
  );
}

export function HeroPanel({ compact }: { compact?: boolean }) {
  return (
    <LinearGradient colors={['#0A0A0B', '#000000']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[styles.hero, compact && styles.heroCompact]}>
      <HeroLight />
      <View style={styles.brandRow}>
        <Logo size={compact ? 36 : 40} />
        <Txt style={styles.brandName}>Oliskey Alpha</Txt>
      </View>
      <View style={{ gap: compact ? 14 : 22 }}>
        <GlassMotif />
        <Txt style={[styles.headline, compact && { fontSize: 32, lineHeight: 38 }]}>Learn the markets.{'\n'}Practise without the risk.</Txt>
        <View style={{ gap: 10 }}>
          {FACTS.map((text) => (
            <View key={text} style={styles.fact}>
              <View style={styles.factTick}><Check size={13} color="#FFFFFF" strokeWidth={3} /></View>
              <Txt style={styles.factText}>{text}</Txt>
            </View>
          ))}
        </View>
      </View>
    </LinearGradient>
  );
}

function useEnter() {
  const [v] = useState(() => new Animated.Value(prefersReducedMotion() ? 1 : 0));
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 360, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' }).start(); }, [v]);
  return { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] };
}

export function AuthShell({ title, subtitle, onBack, children }: { title: string; subtitle?: string; onBack?: () => void; children: ReactNode }) {
  const { width } = useLayout();
  const wide = width >= 920;
  const enter = useEnter();
  const goBack = onBack ?? (() => { if (router.canGoBack()) router.back(); else router.replace('/welcome'); });
  return (
    <View style={[styles.page, wide && { flexDirection: 'row' }]}>
      {wide ? <View style={styles.heroSide}><HeroPanel /></View> : null}
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[styles.scroll, wide && { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
            <Animated.View style={[styles.column, enter]}>
              <IconButton label="Back" size={42} onPress={goBack}><ArrowLeft size={20} color={colors.text} strokeWidth={2.25} /></IconButton>
              <View style={{ gap: 8, marginTop: 6 }}>
                <Txt style={styles.title} accessibilityRole="header">{title}</Txt>
                {subtitle ? <Txt style={styles.subtitle}>{subtitle}</Txt> : null}
              </View>
              {children}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export function AuthField({ label, error, hint, secureTextEntry, right, ...props }: TextInputProps & { label: string; error?: string; hint?: string; right?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const web2 = web ? ({ boxShadow: error ? `0 0 0 3px ${isLight() ? 'rgba(224,16,58,0.12)' : 'rgba(255,90,110,0.18)'}` : focused ? `0 0 0 3px ${isLight() ? 'rgba(91,46,255,0.14)' : 'rgba(155,123,255,0.24)'}` : 'none', transition: 'box-shadow 160ms ease-out, border-color 160ms ease-out' } as object) : null;
  return (
    <View style={{ gap: 7 }}>
      <View style={styles.labelRow}>
        <Txt style={styles.label}>{label}</Txt>
        {right}
      </View>
      <View style={[styles.box, focused && { borderColor: colors.accent }, error ? { borderColor: colors.down } : null, web2]}>
        <TextInput
          // this field draws its own rounded focus ring, so the square page outline stays off it
          {...({ dataSet: { ownFocus: 'true' } } as object)}
          placeholderTextColor={colors.muted}
          accessibilityLabel={label}
          {...props}
          secureTextEntry={secureTextEntry && !visible}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
          style={[styles.input, { outlineStyle: 'none' } as object, props.style]}
        />
        {secureTextEntry ? (
          <Press onPress={() => setVisible((v) => !v)} haptic={false} accessibilityLabel={visible ? 'Hide password' : 'Show password'} style={styles.eye}>
            {visible ? <EyeOff size={19} color={colors.muted} /> : <Eye size={19} color={colors.muted} />}
          </Press>
        ) : null}
      </View>
      {error ? <Txt style={styles.fieldError} accessibilityRole="alert">{error}</Txt> : hint ? <Txt style={styles.hint}>{hint}</Txt> : null}
    </View>
  );
}

export function AuthError({ children }: { children: string }) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <CircleAlert size={18} color={colors.down} />
      <Txt style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colors.text }}>{children}</Txt>
    </View>
  );
}

// A small, honest strength guide: it only reports length and variety, and never blocks beyond the server's own 8-character rule.
export function PasswordStrength({ value }: { value: string }) {
  if (!value) return null;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  const score = value.length < 8 ? 1 : value.length >= 12 && variety >= 3 ? 3 : variety >= 2 ? 2 : 1;
  const tone = score === 1 ? colors.down : score === 2 ? colors.demo : colors.up;
  const text = value.length < 8 ? `${8 - value.length} more character${8 - value.length === 1 ? '' : 's'} needed` : score === 1 ? 'Add numbers or capitals to make it stronger' : score === 2 ? 'Good. Longer is even stronger' : 'Strong password';
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`Password strength: ${text}`}>
      <View style={styles.bars}>
        {[1, 2, 3].map((n) => <View key={n} style={[styles.bar, { backgroundColor: n <= score ? tone : colors.border }]} />)}
      </View>
      <Txt style={styles.hint}>{text}</Txt>
    </View>
  );
}

export function QuietButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press haptic={false} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.quiet, glass('regular', { shadow: false })]}>
      <Txt style={styles.quietText}>{label}</Txt>
    </Press>
  );
}

export function SwitchLine({ text, action, onPress }: { text: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.switchLine}>
      <Txt style={{ fontSize: 15, color: colors.muted }}>{text}</Txt>
      <Press haptic={false} onPress={onPress} accessibilityRole="link" accessibilityLabel={action}><Txt style={styles.link}>{action}</Txt></Press>
    </View>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  heroSide: { flex: 1, maxWidth: '50%' },
  hero: { flex: 1, overflow: 'hidden', justifyContent: 'space-between', padding: 44 },
  heroCompact: { padding: 22, paddingTop: 26 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandName: { color: '#FFFFFF', fontSize: 19, fontFamily: font.bold, letterSpacing: -0.3 },
  motif: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 },
  motifDrop: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  motifCapsule: { height: 60, borderRadius: 30, flexDirection: 'row', alignItems: 'center', gap: 26, paddingHorizontal: 24 },
  headline: { color: '#FFFFFF', fontSize: 44, lineHeight: 52, fontFamily: font.bold, letterSpacing: -1 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  factTick: { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  factText: { color: 'rgba(255,255,255,0.86)', fontSize: 15, fontFamily: font.medium, flexShrink: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingVertical: 20 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 20 },
  title: { fontSize: 32, lineHeight: 38, fontFamily: font.bold, letterSpacing: -0.7 },
  subtitle: { fontSize: 16, lineHeight: 23, color: colors.muted },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 34 },
  label: { fontSize: 14, fontFamily: font.semibold },
  box: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 54, paddingLeft: 15, paddingRight: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, fontFamily: font.regular, minHeight: 50 },
  eye: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  fieldError: { color: colors.down, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  banner: { flexDirection: 'row', gap: 10, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.down, backgroundColor: colors.surface },
  bars: { flexDirection: 'row', gap: 5 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  switchLine: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  link: { fontSize: 15, fontFamily: font.semibold, color: colors.accent },
  quiet: { height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  quietText: { fontSize: 13, fontFamily: font.semibold, color: colors.accent },
}));

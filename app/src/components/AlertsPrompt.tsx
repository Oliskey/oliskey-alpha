// Home card shown while browser alerts are off on this device. Chrome only shows its "Allow notifications" question
// after a tap, so alerts could never start by themselves; this puts the switch where people see it. Hidden once on,
// when this browser cannot do alerts, or after "Not now".
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { BellRing, X } from 'lucide-react-native';
import { pushState, turnOnPush, type PushState } from '@/lib/push';
import { getPref, setPref } from '@/lib/storage';
import { colors, font, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

export function AlertsPrompt() {
  const toast = useToast();
  const [state, setState] = useState<PushState>('unsupported');
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void Promise.all([pushState(), getPref('alerts-prompt')]).then(([s, p]) => { setState(s); setHidden(p === 'no'); }).catch(() => {});
  }, []);
  if (hidden || (state !== 'off' && state !== 'blocked')) return null;

  const blocked = state === 'blocked';
  const turnOn = () => {
    void turnOnPush().then((s) => {
      setState(s);
      if (s === 'on') toast({ title: 'Alerts are on', message: 'You will hear about signals, AI trades and every result.', tone: 'up' });
      if (s === 'blocked') toast({ title: 'Alerts are blocked', message: 'Tap the icon left of the web address, set Notifications to Allow, then reload.' });
    }).catch((e: Error) => toast({ title: 'Could not turn on alerts', message: e.message, tone: 'down' }));
  };
  return (
    <View style={styles.card}>
      <View style={styles.icon}><BellRing size={22} color={colors.accent} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontFamily: font.semibold, fontSize: 15 }}>{blocked ? 'Alerts are blocked' : 'Turn on alerts'}</Txt>
        <Txt style={{ color: colors.muted, fontSize: 13 }}>
          {blocked ? 'Tap the icon left of the web address → Notifications → Allow. Then reload.' : 'Signals, AI trades, wins and losses.'}
        </Txt>
      </View>
      {blocked ? null : <Button height={38} label="Turn on" onPress={turnOn} />}
      <IconButton label="Not now" onPress={() => { setHidden(true); void setPref('alerts-prompt', 'no'); }}>
        <X size={18} color={colors.muted} />
      </IconButton>
    </View>
  );
}

const styles = createStyles(() => ({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
}));

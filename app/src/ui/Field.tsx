import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { colors, font, radius, createStyles } from '@/theme';
import { Press } from './Press';
import { Txt } from './Txt';

// Labelled input: 1 dp border, radius 12, label 13 muted above the value.
// Password fields (secureTextEntry) get an eye button to show or hide what was typed.
export function Field({ label, error, secureTextEntry, ...props }: TextInputProps & { label: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.box, focused && { borderColor: colors.accent }, error ? { borderColor: colors.down } : null]}>
        <View style={{ flex: 1 }}>
          <Txt style={styles.label}>{label}</Txt>
          <TextInput
            placeholderTextColor={colors.muted}
            {...props}
            secureTextEntry={secureTextEntry && !visible}
            onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
            onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
            style={[styles.input, { outlineStyle: 'none' } as object]}
          />
        </View>
        {secureTextEntry ? (
          <Press onPress={() => setVisible((v) => !v)} haptic={false} hitSlop={10}
            accessibilityLabel={visible ? 'Hide password' : 'Show password'} style={styles.eye}>
            {visible ? <EyeOff size={22} color={colors.muted} /> : <Eye size={22} color={colors.muted} />}
          </Press>
        ) : null}
      </View>
      {error ? <Txt style={{ color: colors.down, fontSize: 13 }}>{error}</Txt> : null}
    </View>
  );
}

const styles = createStyles(() => ({
  box: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingLeft: 14, paddingRight: 8, paddingTop: 8, paddingBottom: 6,
  },
  label: { fontSize: 13, color: colors.muted },
  input: { color: colors.text, fontSize: 18, fontFamily: font.regular, paddingVertical: 4, minHeight: 44 },
  eye: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
}));

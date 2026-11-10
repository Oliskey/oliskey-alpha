// A short sound for a new alert while the app is open (web). Made with the browser's own synthesiser, so there is no
// sound file to load. Chrome only allows sound after the person has tapped the page once; before that it stays silent.
import { Platform } from 'react-native';

let ctx: AudioContext | null = null;
const NOTES = { up: [660, 880], down: [440, 330], neutral: [740, 740] } as const;

export function chime(tone: 'up' | 'down' | 'neutral' = 'neutral') {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    NOTES[tone].forEach((f, i) => {
      const at = ctx!.currentTime + i * 0.16;
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  } catch { /* no sound is fine */ }
}

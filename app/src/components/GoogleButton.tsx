// "Continue with Google", which also covers Gmail. Web only for now, and shown only when the server says Google sign-in is switched on.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { api } from '@/lib/api';
import { Button } from '@/ui/Button';

export function GoogleButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    api<{ googleUrl: string | null }>(`/auth/config?from=${encodeURIComponent(window.location.origin)}`).then((c) => setAddress(c.googleUrl)).catch(() => setAddress(null));
  }, []);
  if (!address) return null;
  return <Button label="Continue with Google" variant="secondary" height={54} loading={leaving} onPress={() => { setLeaving(true); window.location.href = address; }} />;
}

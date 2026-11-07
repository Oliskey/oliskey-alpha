// Session token storage: SecureStore on Android/iOS, localStorage on web (SecureStore has no web support).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'oliskey-alpha.session';

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  return SecureStore.getItemAsync(KEY);
}

export async function saveToken(token: string | null) {
  if (Platform.OS === 'web') {
    try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch {}
    return;
  }
  if (token) await SecureStore.setItemAsync(KEY, token);
  else await SecureStore.deleteItemAsync(KEY);
}

// Small per-device preferences (tooltip seen, favourite assets). Never used for anything that must persist reliably.
export async function getPref(name: string): Promise<string | null> {
  const key = `oliskey-alpha.${name}`;
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

export async function setPref(name: string, value: string) {
  const key = `oliskey-alpha.${name}`;
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, value); } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

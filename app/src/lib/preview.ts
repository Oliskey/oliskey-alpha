// Screens-only build (the Vercel site until a hosted backend exists): no server, so no sign-in, data or trading.
// Screens stay honest: they show empty states and locked trading, never made-up data. EXPO_PUBLIC_PREVIEW=1 at build time.
export const PREVIEW = process.env.EXPO_PUBLIC_PREVIEW === '1';
export const PREVIEW_MESSAGE = 'The server is not connected on this preview yet, so sign-in and trading are off.';

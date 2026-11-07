// Accounts on hosted Supabase (owner decision: Supabase Auth). Supabase holds the passwords and Google sign-in; the backend checks with it, then issues its
// own session as before, so nothing else in the app changes. Local development keeps its own password table: this is only on when AUTH_PROVIDER=supabase.
// Uses the service-role key from the server's settings. It never reaches the app.
export const usingSupabase = () => process.env.AUTH_PROVIDER === 'supabase';

const url = (path) => `${String(process.env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1${path}`;
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = (bearer = key()) => ({ apikey: key(), authorization: `Bearer ${bearer}`, 'content-type': 'application/json' });

/** The new account's id. `null` if the email is already taken. */
export async function createUser({ email, password, fullName }) {
  const res = await fetch(url('/admin/users'), {
    method: 'POST', headers: headers(),
    // emails are not confirmed by a link yet, the same as local sign-up: admins are never made from an email, and demo credits have no value
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
  });
  if (res.status === 422 || res.status === 409) return null;
  if (!res.ok) throw new Error(`Supabase sign-up failed: ${res.status}`);
  return (await res.json()).id;
}

/** True only if Supabase accepts this email and password. */
export async function passwordIsRight(email, password) {
  const res = await fetch(url('/token?grant_type=password'), { method: 'POST', headers: { apikey: key(), 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (res.ok) return true;
  if (res.status === 400 || res.status === 401 || res.status === 422) return false;
  throw new Error(`Supabase sign-in failed: ${res.status}`);
}

export async function setPassword(userId, password) {
  const res = await fetch(url(`/admin/users/${userId}`), { method: 'PUT', headers: headers(), body: JSON.stringify({ password }) });
  if (!res.ok) throw new Error(`Supabase password change failed: ${res.status}`);
}

/** Who a Supabase token belongs to, as Supabase itself says, after Google sign-in. `null` if it is not valid. */
export async function userFromToken(token) {
  const res = await fetch(url('/user'), { headers: headers(String(token)) });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id && u?.email ? { id: u.id, email: u.email } : null;
}

export const googleSignInUrl = (redirectTo) => `${url('/authorize')}?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;

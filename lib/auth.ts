import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { RegistryError } from './registries';
export const sessionCookie = 'firmy_session';
const lifetime = 12 * 60 * 60;
function secret() {
  const value = process.env.CRM_SESSION_SECRET;
  if (!value || value.length < 32 || !process.env.CRM_PASSWORD || process.env.CRM_PASSWORD.length < 12) throw new RegistryError('Skonfiguruj hasło dostępu do CRM w ustawieniach Vercel.', 503);
  return value;
}
function equal(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function validPassword(value: unknown) { secret(); return typeof value === 'string' && value.length <= 200 && equal(value, process.env.CRM_PASSWORD!); }
export function issueSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + lifetime })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function validSession(token?: string, now = Date.now()) {
  if (!token || token.length > 500) return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !equal(signature, createHmac('sha256', secret()).update(payload).digest('base64url'))) return false;
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    return Number.isSafeInteger(exp) && exp > seconds && exp <= seconds + lifetime;
  } catch { return false; }
}
export async function authenticated() { return validSession((await cookies()).get(sessionCookie)?.value); }
export async function requireUser() { if (!await authenticated()) throw new RegistryError('Zaloguj się, aby korzystać z CRM.', 401); }

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { RegistryError } from './registries';
import { accountById } from './accounts';
import type { CurrentUser } from './team';
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
export function issueSession(now = Date.now(), user?: Pick<CurrentUser, 'id' | 'revision'>) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + lifetime, sub: user?.id || 'owner', rev: user?.revision || '1' })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function readSession(token?: string, now = Date.now()): { sub: string; rev: string } | null {
  if (!token || token.length > 500) return null;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !equal(signature, createHmac('sha256', secret()).update(payload).digest('base64url'))) return null;
    const { exp, sub = 'owner', rev = '1' } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    return Number.isSafeInteger(exp) && exp > seconds && exp <= seconds + lifetime && typeof sub === 'string' && typeof rev === 'string' ? { sub, rev } : null;
  } catch { return null; }
}
export function validSession(token?: string, now = Date.now()) { return Boolean(readSession(token, now)); }
export async function sessionUser(token?: string) {
  const session = readSession(token);
  if (!session) return null;
  const user = await accountById(session.sub);
  return user?.active && user.revision === session.rev ? user : null;
}
export async function currentUser() { return sessionUser((await cookies()).get(sessionCookie)?.value); }
export async function authenticated() { return Boolean(await currentUser()); }
export async function requireUser() { const user = await currentUser(); if (!user) throw new RegistryError('Zaloguj się, aby korzystać z CRM.', 401); return user; }

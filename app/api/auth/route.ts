import { cookies } from 'next/headers';
import { issueSession, sessionCookie, validPassword, requireUser } from '@/lib/auth';
import { query, transaction } from '@/lib/database';
import { setup } from '@/lib/store';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { RegistryError } from '@/lib/registries';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkLocalMutation(request);
    const body = await request.json();
    // Global durable throttle also works across separate function instances.
    await setup();
    await transaction(async () => {
      const now = Date.now();
      const row = (await query("SELECT * FROM auth_attempts WHERE key='login'")).rows[0];
      if (row && Number(row.expiresAt) > now && Number(row.count) >= 15) throw new RegistryError('Zbyt wiele prób logowania. Spróbuj ponownie za 5 minut.', 429);
      await query("INSERT INTO auth_attempts VALUES ('login',1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expiresAt < ? THEN 1 ELSE auth_attempts.count+1 END,expiresAt=CASE WHEN auth_attempts.expiresAt < ? THEN excluded.expiresAt ELSE auth_attempts.expiresAt END", [now + 300000, now, now]);
    });
    if (!validPassword(body?.password)) throw new RegistryError('Nieprawidłowe hasło.', 401);
    await query("DELETE FROM auth_attempts WHERE key='login'");
    (await cookies()).set(sessionCookie, issueSession(), { httpOnly: true, secure: Boolean(process.env.VERCEL) || new URL(request.url).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 43200 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { await requireUser(); checkLocalMutation(request); (await cookies()).delete(sessionCookie); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}

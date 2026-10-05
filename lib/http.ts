import { DatabaseError } from './database';
import { RegistryError } from './registries';
export function checkLocalMutation(request: Request) {
  const origin = request.headers.get('origin');
  // Next.js can internally use localhost even when Chrome connects to 127.0.0.1.
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  const protocol = process.env.VERCEL ? 'https:' : url.protocol;
  const expectedOrigin = `${protocol}//${host}`;
  if (origin && origin !== expectedOrigin) throw new RegistryError('Niedozwolone źródło żądania.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RegistryError('Wymagany JSON.', 415);
}
export function errorResponse(error: unknown) {
  if (error instanceof DatabaseError) return Response.json({ error: error.message }, { status: 503 });
  if (error instanceof RegistryError) return Response.json({ error: error.message }, { status: error.status, headers: error.retryAfter ? { 'Retry-After': error.retryAfter } : {} });
  return Response.json({ error: 'Nie udało się zapisać lub odczytać danych. Sprawdź połączenie z bazą danych w chmurze.' }, { status: 500 });
}

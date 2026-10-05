import { ceidgByNip, krsByNumber, RegistryError } from '@/lib/registries';
import { upsertRegistry } from '@/lib/store';
import { checkLocalMutation, errorResponse } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkLocalMutation(request);
    let body;
    try { body = await request.json(); } catch { throw new RegistryError('Nieprawidłowy JSON.', 400); }
    if (!body || typeof body.identifier !== 'string' || !['CEIDG', 'KRS'].includes(body.source)) throw new RegistryError('Wybierz rejestr i podaj identyfikator.', 400);
    const identifier = body.identifier.trim();
    const firms = body.source === 'CEIDG' ? await ceidgByNip(identifier) : await krsByNumber(identifier);
    if (!firms.length) throw new RegistryError('Nie znaleziono firmy dla podanego NIP.', 404);
    return Response.json({ companies: upsertRegistry(firms, body.source), count: firms.length });
  } catch (error) { return errorResponse(error); }
}

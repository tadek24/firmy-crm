import { requireUser } from '@/lib/auth';
import { requireAdminAccount, saveTeamPerson, saveTeamUser, teamDirectory, teamUsers } from '@/lib/accounts';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { RegistryError } from '@/lib/registries';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const actor = await requireUser(); requireAdminAccount(actor); return Response.json({ people: await teamDirectory(), users: await teamUsers() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireUser(); requireAdminAccount(actor); checkLocalMutation(request);
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RegistryError('Nieprawidłowe dane zespołu.', 400);
    if (input.kind === 'person') await saveTeamPerson(actor, input);
    else if (input.kind === 'user') await saveTeamUser(actor, input);
    else throw new RegistryError('Wybierz konto lub osobę odpowiedzialną.', 400);
    return Response.json({ people: await teamDirectory(), users: await teamUsers() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

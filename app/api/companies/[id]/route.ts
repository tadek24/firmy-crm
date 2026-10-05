import { requireUser } from '@/lib/auth';
import { updateCrm } from '@/lib/store';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { RegistryError } from '@/lib/registries';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    checkLocalMutation(request);
    const { id } = await context.params;
    let patch: unknown;
    try { patch = await request.json(); } catch { throw new RegistryError('Nieprawidłowy JSON.', 400); }
    try { return Response.json({ company: await updateCrm(id, patch) }); }
    catch (error) { throw new RegistryError((error as Error).message, 400); }
  } catch (error) { return errorResponse(error); }
}

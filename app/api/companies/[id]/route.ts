import { updateCrm } from '@/lib/store';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { RegistryError } from '@/lib/registries';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkLocalMutation(request);
    const { id } = await context.params;
    let patch: unknown;
    try { patch = await request.json(); } catch { throw new RegistryError('Nieprawidłowy JSON.', 400); }
    try { return Response.json({ company: updateCrm(id, patch) }); }
    catch (error) { throw new RegistryError((error as Error).message, 400); }
  } catch (error) { return errorResponse(error); }
}

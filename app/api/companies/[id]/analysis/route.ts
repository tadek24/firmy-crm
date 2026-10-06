import { start } from 'workflow/api';
import { requireUser } from '@/lib/auth';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { RegistryError } from '@/lib/registries';
import { aiProvider, aiConfigured, aiDailyLimit, aiStatus, analysisDispatchFailed, requestAnalysis, aiUsage } from '@/lib/ai-analysis';
import { analyzeCompanyInCloud } from '@/workflows/company-analysis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await requireUser();
    return Response.json({ task: await aiStatus((await context.params).id), configured: aiConfigured(), provider: aiProvider(), dailyLimit: aiDailyLimit(), used: await aiUsage() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    await requireUser(); checkLocalMutation(request);
    let body; try { body = await request.json(); } catch { throw new RegistryError('Nieprawidłowy JSON.', 400); }
    if (!body || typeof body.force !== 'boolean') throw new RegistryError('Nieprawidłowe żądanie analizy.', 400);
    // Preview deployments share the database but must never spend production credits.
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') throw new RegistryError('Analiza AI jest dostępna wyłącznie w wersji produkcyjnej.', 403);
    const id = (await context.params).id;
    const result = await requestAnalysis(id, body.force);
    if (result.created) {
      try { await start(analyzeCompanyInCloud, [id, result.task.taskId]); }
      catch { await analysisDispatchFailed(id, result.task.taskId); throw new RegistryError('Nie udało się uruchomić analizy w chmurze. Sprawdź Workflow w Vercel.', 503); }
    }
    return Response.json(result, { status: result.created ? 202 : 200 });
  } catch (error) { return errorResponse(error); }
}

import { bulkStatus, controlBulk, workerIsAlive, attachWorkflow, dispatchFailed } from '@/lib/bulk';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { RegistryError } from '@/lib/registries';
import { importInCloud } from '@/workflows/ceidg-import';
import { start } from 'workflow/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { await requireUser(); return Response.json({ job: await bulkStatus(), workerAlive: await workerIsAlive(), ceidgConfigured: Boolean(process.env.CEIDG_API_TOKEN?.trim()) }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    await requireUser(); checkLocalMutation(request);
    const data = await request.json();
    if (!data || !['start','pause','resume'].includes(data.action)) throw new RegistryError('Nieprawidłowe polecenie importu.', 400);
    if (data.action !== 'pause' && !process.env.CEIDG_API_TOKEN?.trim()) throw new RegistryError('Dodaj CEIDG_API_TOKEN w ustawieniach Vercel i wykonaj ponowne wdrożenie.', 503);
    const job = await controlBulk(data.action);
    if (job.state === 'running') {
      try { const run = await start(importInCloud, [job.id, job.generation]); await attachWorkflow(job.id, job.generation, run.runId); }
      catch { await dispatchFailed(job.id, job.generation); throw new RegistryError('Nie udało się uruchomić importu w chmurze. Spróbuj użyć Wznów.', 503); }
    }
    return Response.json({ job: await bulkStatus() });
  } catch (error) { return errorResponse(error); }
}

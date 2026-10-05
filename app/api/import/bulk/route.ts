import { bulkStatus, controlBulk, workerIsAlive } from '@/lib/bulk';
import { ensureBulkWorker } from '@/lib/worker-launcher';
import { checkLocalMutation, errorResponse } from '@/lib/http';
import { RegistryError } from '@/lib/registries';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { ensureBulkWorker(); return Response.json({ job: bulkStatus(), workerAlive: workerIsAlive(), ceidgConfigured: Boolean(process.env.CEIDG_API_TOKEN?.trim()) }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    checkLocalMutation(request);
    const data = await request.json();
    if (!data || !['start', 'pause', 'resume'].includes(data.action)) throw new RegistryError('Nieprawidłowe polecenie importu.', 400);
    if (data.action !== 'pause' && !process.env.CEIDG_API_TOKEN?.trim()) throw new RegistryError('Wpisz CEIDG_API_TOKEN w .env i uruchom ponownie serwer.', 503);
    const job = controlBulk(data.action); ensureBulkWorker();
    return Response.json({ job });
  } catch (error) { return errorResponse(error); }
}

import { requireUser } from '@/lib/auth';
import { companyPage, recentImports } from '@/lib/store';
import { errorResponse } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await requireUser();
    const params = new URL(request.url).searchParams;
    const value = Number(params.get('page') || 0); const page = Number.isSafeInteger(value) ? Math.max(0, value) : 0;
    return Response.json({ ...await companyPage((params.get('q') || '').slice(0, 200), params.get('status') || 'Wszystkie', params.get('category') || 'Wszystkie', page), imports: await recentImports(), ceidgConfigured: Boolean(process.env.CEIDG_API_TOKEN?.trim()) });
  }
  catch (error) { return errorResponse(error); }
}

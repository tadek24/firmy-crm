import { aiConfigured } from '@/lib/ai-analysis';
import { requireUser } from '@/lib/auth';
import { companyPage, recentImports } from '@/lib/store';
import { errorResponse } from '@/lib/http';
import { parseContactFilter } from '@/lib/contact-filters';
import { teamDirectory } from '@/lib/accounts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const value = Number(params.get('page') || 0); const page = Number.isSafeInteger(value) ? Math.max(0, value) : 0;
    const sort = ['fit', 'startedAsc', 'startedDesc', 'yearAsc'].includes(params.get('sort') || '') ? params.get('sort') || 'fit' : 'fit';
    return Response.json({ ...await companyPage((params.get('q') || '').slice(0, 200), params.get('status') || 'Wszystkie', params.get('category') || 'Wszystkie', page, parseContactFilter(params.get('contact')), params.get('scope') === 'prospects' ? 'prospects' : 'all', (params.get('owner') || '').slice(0, 87), (params.get('tag') || '').slice(0, 80), sort, (params.get('year') || '').slice(0, 7)), user, people: await teamDirectory(), imports: await recentImports(), aiConfigured: aiConfigured(), ceidgConfigured: Boolean(process.env.CEIDG_API_TOKEN?.trim()) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  catch (error) { return errorResponse(error); }
}

import { requireUser } from '@/lib/auth';
import { requireAdminAccount } from '@/lib/accounts';
import { aiConfigured, aiProvider, GEMINI_MODEL } from '@/lib/ai-analysis';
import { errorResponse } from '@/lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  try {
    requireAdminAccount(await requireUser());
    if(aiProvider()!=='gemini' || !aiConfigured()) return Response.json({configured:false},{headers:{'Cache-Control':'no-store'}});
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY!.trim()},signal:AbortSignal.timeout(20000),redirect:'error',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    const models=Array.isArray(data.models) ? data.models.filter((item: {name?:unknown;supportedGenerationMethods?:string[]})=>typeof item.name==='string' && /^models\/gemini-[a-z0-9.-]+$/.test(item.name) && item.supportedGenerationMethods?.includes('generateContent')).map((item: {name:string})=>item.name.slice(7)) : [];
    // Never return the key, request headers or raw provider error text.
    return Response.json({configured:true,provider:'gemini',model:GEMINI_MODEL,listStatus:response.status,available:models.includes(GEMINI_MODEL),models},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return errorResponse(error); }
}

import { performAnalysis } from '@/lib/ai-analysis';

export async function analyzeCompanyInCloud(companyId: string, taskId: string) {
  'use workflow';
  await analyze(companyId, taskId);
}
async function analyze(companyId: string, taskId: string) {
  'use step';
  await performAnalysis(companyId, taskId);
}

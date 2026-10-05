import { sleep } from 'workflow';
import { start } from 'workflow/api';
import { randomUUID } from 'node:crypto';
import { acquireWorker, attachWorkflow, bulkStatus, bulkStep, releaseWorker } from '@/lib/bulk';

// Each run stays far below the event/replay limits. The database is the checkpoint.
export async function importInCloud(id: string, generation: number) {
  'use workflow';
  for (let round = 0; round < 100; round++) {
    const outcome = await processBatch(id, generation);
    if (outcome.done) return;
    await sleep(new Date(outcome.nextRunAt));
  }
  await continueImport(id, generation);
}
async function processBatch(id: string, generation: number) {
  'use step';
  const owner = randomUUID();
  const deadline = Date.now() + 180000;
  if (!await acquireWorker(owner)) return { done: false, nextRunAt: Date.now() + 15000 };
  try {
    while (Date.now() < deadline) {
      if (!await acquireWorker(owner)) return { done: false, nextRunAt: Date.now() + 15000 };
      const job = await bulkStatus();
      if (!job || job.id !== id || job.generation !== generation || job.state !== 'running') return { done: true, nextRunAt: 0 };
      if (job.nextRunAt > Date.now()) return { done: false, nextRunAt: job.nextRunAt };
      await bulkStep(id, generation);
      // Short waits within a batch reduce Workflow events for a national import.
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    return { done: false, nextRunAt: Date.now() + 4000 };
  } finally { await releaseWorker(owner); }
}
async function continueImport(id: string, generation: number) {
  'use step';
  const job = await bulkStatus();
  if (!job || job.id !== id || job.generation !== generation || job.state !== 'running') return;
  const run = await start(importInCloud, [id, generation]);
  await attachWorkflow(id, generation, run.runId);
}

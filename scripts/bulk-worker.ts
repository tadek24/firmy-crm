import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { acquireWorker, bulkStatus, bulkStep, releaseWorker } from '../lib/bulk';
async function main() {
  const owner = randomUUID();
  if (!acquireWorker(owner)) return;
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  try {
    while (!stopping) {
      if (!acquireWorker(owner)) break;
      if (bulkStatus()?.state !== 'running') break;
      await bulkStep();
      await setTimeout(4000);
    }
  } finally { releaseWorker(owner); }
}
main().catch(() => { process.exitCode = 1; });

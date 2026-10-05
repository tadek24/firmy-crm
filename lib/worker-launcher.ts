import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { bulkStatus, workerIsAlive } from './bulk';
export function ensureBulkWorker() {
  if (bulkStatus()?.state !== 'running' || workerIsAlive()) return;
  const args = ['--import', 'tsx'];
  if (existsSync(path.join(process.cwd(), '.env'))) args.push('--env-file=.env');
  args.push(path.join(process.cwd(), 'scripts', 'bulk-worker.ts'));
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, windowsHide: true, detached: false, stdio: 'ignore' });
  child.on('error', () => { /* Status endpoint reports a missing lease and allows retry. */ });
  child.unref();
}

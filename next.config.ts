import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';
const config: NextConfig = { reactStrictMode: true, serverExternalPackages: ['postgres', '@electric-sql/pglite'] };
export default withWorkflow(config);

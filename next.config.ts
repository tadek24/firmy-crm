import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';
const config: NextConfig = { reactStrictMode: true };
export default withWorkflow(config);

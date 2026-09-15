import type { NextConfig } from 'next';
import { loadRootEnvFile } from '@cgp/config';

loadRootEnvFile();

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not built output.
  transpilePackages: ['@cgp/config', '@cgp/contracts'],
};

export default nextConfig;

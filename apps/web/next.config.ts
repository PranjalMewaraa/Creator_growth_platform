import type { NextConfig } from 'next';
import { loadRootEnvFile } from '@cgp/config';

loadRootEnvFile();

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not built output.
  transpilePackages: ['@cgp/config', '@cgp/contracts', '@cgp/core', '@cgp/db', '@cgp/ui'],
  // Required by Node at runtime rather than bundled; bullmq has optional native dependencies.
  serverExternalPackages: ['bullmq', 'ioredis'],
};

export default nextConfig;

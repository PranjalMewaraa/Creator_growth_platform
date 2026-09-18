import type { NextConfig } from 'next';
import { loadRootEnvFile } from '@cgp/config';

loadRootEnvFile();

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not built output.
  transpilePackages: [
    '@cgp/adapters',
    '@cgp/config',
    '@cgp/contracts',
    '@cgp/core',
    '@cgp/db',
    '@cgp/orchestration',
    '@cgp/ui',
  ],
  // Required by Node at runtime rather than bundled: bullmq has optional native dependencies,
  // and the provider SDKs load their own auth and transport modules.
  serverExternalPackages: [
    'bullmq',
    'ioredis',
    '@google/genai',
    'google-auth-library',
    '@anthropic-ai/vertex-sdk',
  ],
};

export default nextConfig;

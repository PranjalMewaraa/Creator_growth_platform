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
  // the provider SDKs load their own auth and transport modules, and the text layer renderer
  // loads a platform specific binary and reads font files from its own package.
  serverExternalPackages: [
    'bullmq',
    'ioredis',
    '@google/genai',
    'google-auth-library',
    '@anthropic-ai/vertex-sdk',
    // A platform specific binary, which a bundle cannot carry. Listed as a dependency of this
    // app as well, so Node can resolve it from here at runtime.
    '@resvg/resvg-js',
  ],
};

export default nextConfig;

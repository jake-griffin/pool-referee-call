import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server-side env vars passed to the runtime
  // (never expose ADMIN_SECRET or token hashes client-side)
  serverExternalPackages: [],
};

export default nextConfig;

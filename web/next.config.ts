import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.EVENT_REC_RUNTIME === 'node' ? 'standalone' : undefined,
};

export default nextConfig;

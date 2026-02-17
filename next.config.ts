import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Prevent dev/build chunk collisions: dev uses .next-dev, build/start use .next.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // Avoid incorrect workspace root inference from parent lockfiles.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
      {
        protocol: 'https',
        hostname: '*.cloudflare.com',
      },
    ],
  },
  env: {
    NEXT_PUBLIC_WORKER_URL: process.env.NEXT_PUBLIC_WORKER_URL || 'https://proposals-api.nuvho.com',
    NEXT_PUBLIC_AZURE_CLIENT_ID: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || 'f5f35997-177f-4f24-9069-cc1f31113ae7',
    NEXT_PUBLIC_AZURE_TENANT_ID: process.env.NEXT_PUBLIC_AZURE_TENANT_ID || '15723413-cb5d-453c-bb72-3f481241aeff',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://proposals.nuvho.com',
  },
  // The repo lives inside a OneDrive-synced folder on Ody's machine — OneDrive's
  // sync driver can swallow/delay native fsevents, so `next dev`'s webpack
  // watcher can silently miss file saves (stale compiled output, edits that
  // never hot-reload). Polling sidesteps that; only affects local dev, never
  // the production/standalone build.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = { poll: 800, aggregateTimeout: 300 }
    }
    return config
  },
}

module.exports = nextConfig

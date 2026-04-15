/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@tanstack/react-query', 'wagmi', '@wagmi/core', '@wagmi/connectors', 'viem'],
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath,
}

module.exports = nextConfig

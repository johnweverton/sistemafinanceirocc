/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/shared é TS puro consumido direto da fonte — transpilado pelo Next.
  transpilePackages: ['@cobranca/shared'],
};

export default nextConfig;

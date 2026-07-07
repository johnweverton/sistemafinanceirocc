/** @type {import('next').NextConfig} */

// Achado A-4: CSP e headers de segurança MOVIDOS para middleware.ts (dinâmicos com nonce por request).
// Mantido aqui apenas o que NÃO depende de nonce (poweredByHeader, transpilePackages).

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // remove header X-Powered-By (evita fingerprinting do stack)
  // packages/shared é TS puro consumido direto da fonte — transpilado pelo Next.
  transpilePackages: ['@cobranca/shared'],
};

export default nextConfig;


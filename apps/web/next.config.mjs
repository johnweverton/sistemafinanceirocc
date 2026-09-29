/** @type {import('next').NextConfig} */

// Achado A-4: CSP e headers de segurança MOVIDOS para middleware.ts (dinâmicos com nonce por request).
// Mantido aqui apenas o que NÃO depende de nonce (poweredByHeader, transpilePackages).

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // remove header X-Powered-By (evita fingerprinting do stack)
  // packages/shared é TS puro consumido direto da fonte — transpilado pelo Next.
  // agente-iss: o spike iss-teste-nuvem reaproveita o driver do portal (TS puro, da fonte).
  transpilePackages: ['@cobranca/shared', '@cobranca/agente-iss'],
  experimental: {
    // Chromium serverless (spike iss-teste-nuvem): binário .br lido do disco em runtime — não
    // pode ser empacotado pelo webpack, e o rastreio de arquivos precisa levar a pasta bin/.
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
    outputFileTracingIncludes: {
      '/api/clientes-contabilidade/faturamentos/iss-teste-nuvem': [
        './node_modules/@sparticuz/chromium/bin/**',
        '../../node_modules/@sparticuz/chromium/bin/**',
      ],
    },
  },
};

export default nextConfig;


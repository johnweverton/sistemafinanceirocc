/** @type {import('next').NextConfig} */

// Achado A-4: CSP e headers de segurança MOVIDOS para middleware.ts (dinâmicos com nonce por request).
// Mantido aqui apenas o que NÃO depende de nonce (poweredByHeader, transpilePackages).

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // remove header X-Powered-By (evita fingerprinting do stack)
  // packages/shared é TS puro consumido direto da fonte — transpilado pelo Next.
  // agente-iss: a busca no ISS pela nuvem (server/iss-nuvem) reaproveita o driver do portal (TS puro).
  transpilePackages: ['@cobranca/shared', '@cobranca/agente-iss'],
  experimental: {
    // Chromium serverless da busca no ISS: binário .br lido do disco em runtime — não pode ser
    // empacotado pelo webpack, e o rastreio de arquivos precisa levar a pasta bin/ para as rotas
    // que rodam lotes (server/iss-nuvem).
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
    outputFileTracingIncludes: Object.fromEntries(
      [
        '/api/clientes-contabilidade/faturamentos/iss-solicitacoes',
        '/api/integracoes/iss/nuvem/lote',
      ].map((rota) => [
        rota,
        ['./node_modules/@sparticuz/chromium/bin/**', '../../node_modules/@sparticuz/chromium/bin/**'],
      ]),
    ),
  },
};

export default nextConfig;


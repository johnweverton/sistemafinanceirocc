// Empacota o CLI num único .mjs (esbuild já está no monorepo — sem tsx/ts-node).
// playwright fica de fora do bundle: é resolvido do node_modules em tempo de execução.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/cli.mjs',
  external: ['playwright'],
  logLevel: 'warning',
});

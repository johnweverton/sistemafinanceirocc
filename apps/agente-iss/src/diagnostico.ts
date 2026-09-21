// Log e snapshots locais. Tudo fica em <pastaBase>\execucoes\<carimbo>\ — na máquina do
// escritório, fora do OneDrive e fora do sistema. O CPF do login é removido de todo HTML salvo
// (o próprio portal o imprime nas páginas logadas — visto na gravação de 2026-09-21).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { Diagnostico } from './portal/portal';

export function redigirCpf(texto: string, cpf: string): string {
  if (cpf.length !== 11) return texto;
  const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  return texto.split(cpf).join('[CPF]').split(formatado).join('[CPF]');
}

export function criarDiagnostico(pastaExecucao: string, cpf: string, reconhecer: boolean): Diagnostico {
  mkdirSync(join(pastaExecucao, 'snapshots'), { recursive: true });
  const arquivoLog = join(pastaExecucao, 'agente.log');
  let seq = 0;

  const log = (msg: string) => {
    const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${redigirCpf(msg, cpf)}`;
    console.log(linha);
    appendFileSync(arquivoLog, linha + '\n');
  };

  return {
    reconhecer,
    log,
    async snapshot(page: Page, nome: string) {
      try {
        seq += 1;
        const base = join(pastaExecucao, 'snapshots', `${String(seq).padStart(3, '0')}-${nome.replace(/[^\w.-]/g, '_')}`);
        const html = await page.content();
        writeFileSync(`${base}.html`, `<!-- ${page.url()} -->\n${redigirCpf(html, cpf)}`);
        // Print só fora da tela de login (nela aparecem CPF/senha digitados).
        if (!page.url().includes('idp2.sefin')) await page.screenshot({ path: `${base}.png`, fullPage: true });
        return base;
      } catch (e) {
        log(`  (não consegui salvar snapshot "${nome}": ${(e as Error).message})`);
        return null;
      }
    },
  };
}

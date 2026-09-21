// Gravador de telas do ISS Fortaleza (Story 13.0 — reconhecimento do portal). Uso:
//   node apps/agente-iss/scripts/gravador.cjs
// Foi com ele que os seletores de src/portal/seletores.ts foram levantados (2026-09-21). Próximo uso
// previsto: gravar o fluxo "Dar Ciência" de um comunicado oficial (decisão G2, ainda não automatizado).
// Abre o Chrome instalado numa janela ISOLADA (perfil temporário, sem senhas salvas). O usuário
// faz o login e percorre o fluxo manual; a cada tela que "assenta" (DOM parado ~1,2s) o script
// salva HTML + print + metadados em %USERPROFILE%\agente-iss\reconhecimento\<data-hora>\.
//
// Privacidade: NADA do domínio de login (idp2.sefin...) é gravado — na 1ª gravação, a tela de
// "senha inválida" devolveu o CPF preenchido no HTML. E o portal logado imprime o CPF do usuário
// nas páginas: se houver ISS_CPF em %USERPROFILE%/agente-iss/.env, ele é removido de todo
// HTML/JSON salvo. Prints (PNG) não mostram o CPF.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const { chromium } = require('playwright');

// CPF a remover dos arquivos (opcional — lido do .env do agente, nunca impresso).
let CPF = '';
try {
  const env = fs.readFileSync(path.join(os.homedir(), 'agente-iss', '.env'), 'utf8');
  CPF = (/^ISS_CPF=(.*)$/m.exec(env)?.[1] ?? '').replace(/\D/g, '');
} catch { /* sem .env: sem redação por CPF (a tela de login já não é gravada) */ }
function redigir(texto) {
  if (CPF.length !== 11) return texto;
  const fmt = `${CPF.slice(0, 3)}.${CPF.slice(3, 6)}.${CPF.slice(6, 9)}-${CPF.slice(9)}`;
  return texto.split(CPF).join('[CPF]').split(fmt).join('[CPF]');
}

const URL_INICIAL = 'https://iss.fortaleza.ce.gov.br/grpfor/login.seam';
const HOST_LOGIN = 'idp2.sefin.fortaleza.ce.gov.br';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DIR = path.join(os.homedir(), 'agente-iss', 'reconhecimento', stamp);
fs.mkdirSync(DIR, { recursive: true });

let seq = 0;
const ultimoHashPorPagina = new WeakMap();
const indice = [];

function log(msg) {
  const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  console.log(linha);
  fs.appendFileSync(path.join(DIR, 'gravador.log'), linha + '\n');
}

async function gravar(page, motivo) {
  try {
    if (page.isClosed()) return;
    const url = page.url();
    if (!url.startsWith('http')) return;
    const host = new URL(url).host;
    if (host === HOST_LOGIN) return; // tela de login nunca é gravada

    const info = await page.evaluate(() => {
      // limpa qualquer valor de senha antes de serializar (defesa extra)
      document.querySelectorAll('input[type=password]').forEach((i) => i.setAttribute('value', ''));
      const visivel = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      // títulos de modais visíveis (RichFaces/Bootstrap/jQuery UI — pega o que houver)
      const candidatos = [...document.querySelectorAll(
        '.modal-title, .modal-header, .rf-pp-hdr, .rich-mpnl-header, .ui-dialog-title, [role=dialog] h1, [role=dialog] h2, [role=dialog] h3, [role=dialog] h4',
      )];
      const modais = candidatos.filter(visivel).map((e) => e.innerText.trim()).filter(Boolean);
      return {
        title: document.title,
        modais: [...new Set(modais)],
        texto: document.body ? document.body.innerText.slice(0, 20000) : '',
        html: '<!-- gravado de ' + location.href + ' -->\n' + document.documentElement.outerHTML,
        frames: [...document.querySelectorAll('iframe, embed, object')].map((f) => ({
          tag: f.tagName, src: f.src || f.data || null, id: f.id || null,
        })),
      };
    });

    const hash = crypto.createHash('sha1').update(info.texto + '|' + info.modais.join('|') + '|' + url).digest('hex');
    if (ultimoHashPorPagina.get(page) === hash) return;
    ultimoHashPorPagina.set(page, hash);

    seq += 1;
    const nomeTela = (url.split('?')[0].split('/').pop() || 'pagina').replace(/[^\w.-]/g, '_');
    const base = `${String(seq).padStart(3, '0')}-${nomeTela}`;
    fs.writeFileSync(path.join(DIR, `${base}.html`), redigir(info.html));
    await page.screenshot({ path: path.join(DIR, `${base}.png`), fullPage: true }).catch(() => {});
    const meta = {
      seq, arquivo: base, motivo, url, title: info.title, modais: info.modais, frames: info.frames,
      gravadoEm: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(DIR, `${base}.json`), redigir(JSON.stringify(meta, null, 2)));
    indice.push(meta);
    fs.writeFileSync(path.join(DIR, 'indice.json'), JSON.stringify(indice, null, 2));
    log(`#${seq} ${nomeTela}${info.modais.length ? ' | modal: ' + info.modais.join(' / ') : ''} (${motivo})`);
  } catch (e) {
    if (!String(e).includes('closed') && !String(e).includes('navigat')) log(`falha ao gravar: ${e.message}`);
  }
}

function acompanhar(page) {
  let timer = null;
  const agendar = (motivo) => {
    clearTimeout(timer);
    timer = setTimeout(() => gravar(page, motivo), 1200);
  };
  page.on('load', () => agendar('load'));
  page.on('domcontentloaded', () => agendar('domcontentloaded'));
  page.exposeBinding('__issMudou', () => agendar('dom')).catch(() => {});
  page.addInitScript(() => {
    const iniciar = () => {
      if (!document.body || window.__issObs) return;
      window.__issObs = new MutationObserver(() => window.__issMudou && window.__issMudou());
      window.__issObs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    };
    document.addEventListener('DOMContentLoaded', iniciar);
    iniciar();
  }).catch(() => {});
  page.on('download', async (d) => {
    const destino = path.join(DIR, `download-${String(seq).padStart(3, '0')}-${d.suggestedFilename()}`);
    await d.saveAs(destino).catch(() => {});
    log(`download: ${d.suggestedFilename()} (url: ${d.url().slice(0, 120)})`);
    fs.appendFileSync(path.join(DIR, 'downloads.json'), JSON.stringify({ seq, arquivo: d.suggestedFilename(), url: d.url() }) + '\n');
  });
  page.on('dialog', (d) => log(`dialog nativo (${d.type()}): ${d.message()}`));
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) log(`iframe navegou: ${f.url().slice(0, 150)}`);
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'pt-BR' });
  context.on('page', (p) => {
    log(`nova aba/janela aberta: ${p.url()}`);
    acompanhar(p);
  });
  const page = await context.newPage();
  await page.goto(URL_INICIAL);
  log(`Gravando em ${DIR}`);
  log('Faça o login e percorra o fluxo. Feche a janela do navegador para encerrar.');
  // Grava a cada 5s também, para pegar mudanças que não disparem mutação (ex.: iframe de PDF).
  const intervalo = setInterval(() => context.pages().forEach((p) => gravar(p, 'periodico')), 5000);
  await new Promise((resolve) => browser.on('disconnected', resolve));
  clearInterval(intervalo);
  log(`Encerrado. ${seq} telas gravadas em ${DIR}`);
})().catch((e) => {
  log(`ERRO: ${e.stack || e}`);
  process.exit(1);
});

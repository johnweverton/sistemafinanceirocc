'use client';
// Casca única de diálogo acessível (Épico 12, story 12.1 — gaps G-37/G-38/G-39).
// Antes desta story cada modal do caminho de emissão era uma `<div className="fixed inset-0 z-50">`
// solta: sem `role="dialog"`, sem `aria-modal`, sem foco inicial, sem focus trap, sem Escape e sem
// backdrop clicável. O padrão semântico correto já existia no repo (ExtratoManager, DreManager,
// LinkPublicoBI) — este componente consolida esse padrão e adiciona o comportamento de teclado.
//
// ESCOPO: é só a casca visual/a11y. Nenhuma regra de fluxo de lote mora aqui (decisão D1 do épico).
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

const SELETOR_FOCAVEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Pilha de modais abertos. Só o modal do topo reage a Escape e a Tab — necessário porque há
 * modal-dentro-de-modal real no sistema (`SyncModal` abre `ConfirmDialog` por cima). A ordem é
 * confiável porque, em todos os casos do repo, o modal interno monta num commit posterior ao
 * externo (é aberto por clique/estado), então empilha depois.
 */
const pilhaDeModais: string[] = [];

function estaNoTopo(id: string): boolean {
  return pilhaDeModais[pilhaDeModais.length - 1] === id;
}

function elementosFocaveis(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

const LARGURA_CLASSE = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
} as const;

export interface ModalProps {
  /** Título do diálogo — vira o `<h2>` apontado por `aria-labelledby`. */
  titulo: ReactNode;
  /** Linha de apoio sob o título (vira `aria-describedby`). */
  descricao?: ReactNode;
  /** Fechamento pedido pelo operador (Escape, backdrop ou botão do rodapé). */
  onClose: () => void;
  /**
   * Operação em voo (ex.: confirmação de lote em andamento): Escape e clique no backdrop param de
   * fechar e a tentativa é respondida com `mensagemEmVoo`, em vez de sumir com a tela por acidente.
   */
  emVoo?: boolean;
  mensagemEmVoo?: string;
  largura?: keyof typeof LARGURA_CLASSE;
  /** Classes extras do painel (ex.: altura fixa com corpo rolável). */
  painelClassName?: string;
  /** Classes do corpo — sobrescreve o padrão quando o modal precisa de rolagem/altura própria. */
  corpoClassName?: string;
  /** Ações no cabeçalho, à direita do título (ex.: botão "Fechar" do SyncModal). */
  acoesCabecalho?: ReactNode;
  /** Rodapé — normalmente os botões de ação, alinhados à direita. */
  rodape?: ReactNode;
  children: ReactNode;
}

export function Modal({
  titulo,
  descricao,
  onClose,
  emVoo = false,
  mensagemEmVoo = 'Aguarde o processamento terminar.',
  largura = 'lg',
  painelClassName = '',
  corpoClassName = 'space-y-3 px-6 py-4',
  acoesCabecalho,
  rodape,
  children,
}: ModalProps) {
  const idBase = useId();
  const tituloId = `${idBase}-titulo`;
  const descricaoId = `${idBase}-descricao`;
  const painelRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<Element | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // `emVoo` num ref: os listeners de teclado são registrados uma vez só e precisam ler o valor
  // atual, não o da montagem.
  const emVooRef = useRef(emVoo);
  emVooRef.current = emVoo;
  const mensagemEmVooRef = useRef(mensagemEmVoo);
  mensagemEmVooRef.current = mensagemEmVoo;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const tentarFechar = useCallback(() => {
    if (emVooRef.current) {
      setAviso(mensagemEmVooRef.current);
      return;
    }
    onCloseRef.current();
  }, []);

  // Some com o aviso assim que a operação termina — senão fica um alerta mentindo na tela.
  useEffect(() => {
    if (!emVoo) setAviso(null);
  }, [emVoo]);

  // Pilha + foco inicial + retorno de foco ao gatilho.
  useEffect(() => {
    pilhaDeModais.push(idBase);
    gatilhoRef.current = document.activeElement;

    const painel = painelRef.current;
    const primeiro = painel ? elementosFocaveis(painel)[0] : undefined;
    // Sem nenhum elemento interativo (modal só de leitura), o foco vai para o próprio painel —
    // o leitor de tela anuncia o diálogo e o Escape continua funcionando.
    (primeiro ?? painel)?.focus();

    return () => {
      const i = pilhaDeModais.lastIndexOf(idBase);
      if (i >= 0) pilhaDeModais.splice(i, 1);
      const gatilho = gatilhoRef.current;
      if (gatilho instanceof HTMLElement && document.contains(gatilho)) gatilho.focus();
    };
  }, [idBase]);

  // Escape fecha; Tab/Shift+Tab não escapam do painel.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (!estaNoTopo(idBase)) return;
      const painel = painelRef.current;
      if (!painel) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        tentarFechar();
        return;
      }
      if (e.key !== 'Tab') return;

      const focaveis = elementosFocaveis(painel);
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (!primeiro || !ultimo) {
        // Modal só de leitura: Tab não tem para onde ir, fica no próprio painel.
        e.preventDefault();
        painel.focus();
        return;
      }
      const ativo = document.activeElement;
      if (!(ativo instanceof HTMLElement) || !painel.contains(ativo)) {
        e.preventDefault();
        primeiro.focus();
        return;
      }
      if (e.shiftKey && ativo === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [idBase, tentarFechar]);

  // `mousedown` (não `click`): evita fechar quando o operador começa a arrastar uma seleção de
  // texto dentro do painel e solta o botão sobre o backdrop.
  function aoClicarNoBackdrop(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    tentarFechar();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={aoClicarNoBackdrop}
      data-testid="modal-backdrop"
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descricao ? descricaoId : undefined}
        tabIndex={-1}
        className={`bg-cc-surface card w-full ${LARGURA_CLASSE[largura]} shadow-2xl ${painelClassName}`.trim()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-cc-hairline px-6 py-4">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-lg font-bold text-cc-ink">
              {titulo}
            </h2>
            {descricao != null && (
              <p id={descricaoId} className="mt-1 text-sm text-cc-muted">
                {descricao}
              </p>
            )}
          </div>
          {acoesCabecalho && <div className="flex shrink-0 items-center gap-2">{acoesCabecalho}</div>}
        </div>

        {aviso && (
          <p
            role="status"
            className="border-b border-cc-hairline bg-cc-warning-soft px-6 py-2 text-xs text-cc-ink"
          >
            {aviso}
          </p>
        )}

        <div className={corpoClassName}>{children}</div>

        {rodape && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}

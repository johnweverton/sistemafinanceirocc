// Story 12.1 (AC 1, 2) — casca única de diálogo acessível.
// Antes desta story os 6 modais do caminho de emissão eram `<div className="fixed inset-0">`
// soltas: sem role/aria, sem foco inicial, sem trap, sem Escape, sem backdrop (gaps G-37/G-38).
// Estes testes travam esse comportamento no componente, para as 5 stories seguintes da Fase 1
// herdarem a a11y sem retrabalho.
//
// Nota sobre o jsdom: ele NÃO move o foco sozinho no Tab. Isso é a favor do teste — o que se
// observa aqui é exatamente o `preventDefault()` + `.focus()` explícito do focus trap; se o trap
// sumir, o foco simplesmente não se move e as asserções quebram.
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../../src/components/ui/Modal';

/** Gatilho + modal, como no uso real (o modal monta a partir de um clique). */
function Harness({ emVoo = false, semInterativos = false }: { emVoo?: boolean; semInterativos?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button onClick={() => setAberto(true)}>Abrir</button>
      {aberto && (
        <Modal
          titulo="Confirmar emissão"
          descricao="Revise antes de confirmar."
          emVoo={emVoo}
          mensagemEmVoo="Aguarde o processamento terminar."
          onClose={() => setAberto(false)}
          rodape={
            semInterativos ? undefined : (
              <button onClick={() => setAberto(false)}>Cancelar</button>
            )
          }
        >
          {semInterativos ? (
            <p>Somente leitura.</p>
          ) : (
            <>
              <input aria-label="Motivo" />
              <button>Ação do corpo</button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** Abre pelo gatilho FOCADO — é assim que um clique real de teclado/mouse chega. */
function abrir() {
  const gatilho = screen.getByRole('button', { name: 'Abrir' });
  gatilho.focus();
  fireEvent.click(gatilho);
  return gatilho;
}

describe('Modal — semântica de diálogo (AC 1)', () => {
  it('expõe role="dialog", aria-modal e aria-labelledby apontando para o título', () => {
    render(<Harness />);
    abrir();

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');

    const titulo = screen.getByRole('heading', { name: 'Confirmar emissão' });
    expect(dialogo.getAttribute('aria-labelledby')).toBe(titulo.id);
    // A descrição também é anunciada, não fica como texto solto.
    expect(dialogo.getAttribute('aria-describedby')).toBe(
      screen.getByText('Revise antes de confirmar.').id,
    );
  });

  it('sem descrição não inventa um aria-describedby apontando para o vazio', () => {
    render(
      <Modal titulo="Simples" onClose={vi.fn()}>
        <p>corpo</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });
});

describe('Modal — foco (AC 1)', () => {
  it('ao abrir, o foco entra no primeiro elemento interativo', () => {
    render(<Harness />);
    abrir();

    expect(screen.getByLabelText('Motivo')).toHaveFocus();
  });

  it('modal só de leitura foca o próprio painel (o leitor de tela anuncia o diálogo)', () => {
    render(<Harness semInterativos />);
    abrir();

    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('ao fechar, o foco volta para o gatilho que abriu', () => {
    render(<Harness />);
    const gatilho = abrir();
    expect(gatilho).not.toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(gatilho).toHaveFocus();
  });
});

describe('Modal — focus trap (AC 1)', () => {
  it('Tab no último elemento volta para o primeiro', () => {
    render(<Harness />);
    abrir();

    const cancelar = screen.getByRole('button', { name: 'Cancelar' });
    cancelar.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByLabelText('Motivo')).toHaveFocus();
  });

  it('Shift+Tab no primeiro elemento volta para o último', () => {
    render(<Harness />);
    abrir();

    screen.getByLabelText('Motivo').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('Tab a partir de fora do painel é puxado de volta para dentro', () => {
    render(<Harness />);
    abrir();

    // Simula o foco tendo escapado (ex.: chrome do navegador devolvendo o foco ao body).
    screen.getByRole('button', { name: 'Abrir' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByLabelText('Motivo')).toHaveFocus();
  });

  it('Tab no meio do painel não é interceptado (navegação normal segue para o navegador)', () => {
    render(<Harness />);
    abrir();

    screen.getByLabelText('Motivo').focus();
    const evento = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(false);
  });
});

describe('Modal — Escape e backdrop (AC 1)', () => {
  it('Escape fecha', () => {
    render(<Harness />);
    abrir();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clique no backdrop fecha', () => {
    render(<Harness />);
    abrir();

    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clique DENTRO do painel não fecha (arrastar seleção de texto não some com a tela)', () => {
    render(<Harness />);
    abrir();

    fireEvent.mouseDown(screen.getByRole('dialog'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Modal — operação em voo (AC 2)', () => {
  it('Escape não fecha e a tentativa é respondida com o motivo', () => {
    render(<Harness emVoo />);
    abrir();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Aguarde o processamento terminar.');
  });

  it('clique no backdrop não fecha durante a operação', () => {
    render(<Harness emVoo />);
    abrir();

    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('quando a operação termina, o aviso some e o Escape volta a fechar', () => {
    function HarnessControlado() {
      const [emVoo, setEmVoo] = useState(true);
      return (
        <>
          <button onClick={() => setEmVoo(false)}>Terminar</button>
          <Modal titulo="Lote" emVoo={emVoo} onClose={vi.fn()}>
            <p>processando</p>
          </Modal>
        </>
      );
    }
    render(<HarnessControlado />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Terminar' }));

    // O aviso não pode ficar mentindo na tela depois que a operação acabou.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('não bloqueia o fechamento pelo botão do rodapé (só Escape/backdrop)', () => {
    const onClose = vi.fn();
    render(
      <Modal titulo="Lote" emVoo onClose={onClose} rodape={<button onClick={onClose}>Fechar</button>}>
        <p>processando</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Modal — modal dentro de modal', () => {
  it('Escape fecha só o de cima; o de baixo continua aberto', () => {
    function Aninhado() {
      const [interno, setInterno] = useState(false);
      const externoOnClose = vi.fn();
      return (
        <Modal titulo="Sincronização" onClose={externoOnClose}>
          <button onClick={() => setInterno(true)}>Confirmar vínculo</button>
          {interno && (
            <Modal titulo="Confirmar" onClose={() => setInterno(false)}>
              <button>Sim</button>
            </Modal>
          )}
        </Modal>
      );
    }
    render(<Aninhado />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });

    const restantes = screen.getAllByRole('dialog');
    expect(restantes).toHaveLength(1);
    expect(restantes[0]).toHaveAccessibleName('Sincronização');
  });
});

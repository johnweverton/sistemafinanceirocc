// Story 12.2 (AC 3, 6) — campo único de competência.
// Antes desta story o MESMO dado tinha dois padrões: `<input>` de texto + regex em NovaExecucao
// (onde "2026-13" era digitável, e o único retorno era o botão ficar cinza sem explicação) e
// `<input type="month">` em contabilidade. Estes testes travam o padrão sobrevivente.
//
// Nota sobre o jsdom: ele NÃO implementa a máscara/validação do controle nativo `month`, então
// não dá para "provar" aqui que o navegador recusa o mês 13 — quem garante isso é o `type="month"`
// no DOM. O que se observa abaixo é justamente isso: o atributo está lá (é ele que faz o browser
// renderizar um seletor mm/aaaa em vez de um campo de texto livre) e o campo NÃO tem mais o
// `maxLength={7}` do input de texto antigo.
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampoCompetencia } from '../../src/components/ui/CampoCompetencia';

function Controlado({ inicial = '' }: { inicial?: string }) {
  const [competencia, setCompetencia] = useState(inicial);
  return (
    <>
      <CampoCompetencia value={competencia} onChange={setCompetencia} />
      <output>valor={competencia}</output>
    </>
  );
}

describe('CampoCompetencia', () => {
  it('é um seletor de mês nativo, não um campo de texto livre', () => {
    render(<CampoCompetencia value="2026-08" onChange={vi.fn()} />);
    const campo = screen.getByLabelText('Competência');
    expect(campo).toHaveAttribute('type', 'month');
    // O padrão antigo (NovaExecucao) travava o tamanho porque o campo era texto solto.
    expect(campo).not.toHaveAttribute('maxLength');
    expect(campo).not.toHaveAttribute('placeholder');
  });

  it('impossível digitar "2026-13": o controle nativo não aceita mês fora de 01–12', () => {
    render(<CampoCompetencia value="" onChange={vi.fn()} />);
    const campo = screen.getByLabelText('Competência') as HTMLInputElement;
    // Um `<input type="month">` real recusa o valor inválido e mantém a string vazia — mesmo
    // comportamento que o jsdom reproduz na atribuição de `value`.
    campo.value = '2026-13';
    expect(campo.value).toBe('');
    campo.value = '2026-12';
    expect(campo.value).toBe('2026-12');
  });

  it('rotulado por padrão como "Competência" (o que todas as telas migradas usam)', () => {
    render(<CampoCompetencia value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Competência')).toBeInTheDocument();
  });

  it('propaga o valor escolhido para o onChange e opera como campo controlado', () => {
    render(<Controlado />);
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    expect(screen.getByLabelText('Competência')).toHaveValue('2026-07');
    expect(screen.getByText('valor=2026-07')).toBeInTheDocument();
  });

  it('limpar o campo devolve string vazia (não quebra o estado do consumidor)', () => {
    render(<Controlado inicial="2026-07" />);
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '' } });
    expect(screen.getByText('valor=')).toBeInTheDocument();
  });

  it('respeita `disabled` (usado quando o lote já foi calculado / faturamento em voo)', () => {
    render(<CampoCompetencia value="2026-08" onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('Competência')).toBeDisabled();
  });

  it('aceita id explícito e cai num id gerado quando não recebe um', () => {
    const { unmount } = render(<CampoCompetencia id="competencia-empresa" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Competência')).toHaveAttribute('id', 'competencia-empresa');
    unmount();

    render(<CampoCompetencia value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Competência').id).toMatch(/^competencia-/);
  });

  it('dois campos na mesma tela não colidem de id (os 3 modos de NovaExecucao)', () => {
    render(
      <>
        <CampoCompetencia value="" onChange={vi.fn()} label="Competência A" />
        <CampoCompetencia value="" onChange={vi.fn()} label="Competência B" />
      </>,
    );
    const a = screen.getByLabelText('Competência A');
    const b = screen.getByLabelText('Competência B');
    expect(a.id).not.toBe(b.id);
  });

  it('exibe o texto de apoio quando recebe `ajuda`', () => {
    render(<CampoCompetencia value="" onChange={vi.fn()} ajuda="Mês de referência do fechamento." />);
    expect(screen.getByText('Mês de referência do fechamento.')).toBeInTheDocument();
  });
});

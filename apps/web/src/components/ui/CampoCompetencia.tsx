'use client';
// Campo único de competência (AAAA-MM) — Épico 12, story 12.2 (gaps G-27/G-28).
//
// Antes desta story o MESMO dado de negócio tinha dois padrões de entrada:
//   • `NovaExecucao.tsx` usava `<input>` de texto + `maxLength={7}` + validação por regex no
//     `disabled` do botão. Dava pra digitar "2026-13" à vontade: o campo aceitava, o botão só
//     ficava cinza e ninguém explicava por quê.
//   • Contabilidade (`LoteContabilidadeDialog`, `GerarExecucao`, `FaturamentoEEmissao`) já usava
//     `<input type="month">`, que é o certo — o seletor nativo simplesmente não tem mês 13.
//
// Este componente consolida o segundo padrão. `type="month"` já garante o formato AAAA-MM
// (`e.target.value` só chega válido ou vazio), então nenhuma tela precisa mais de regex de
// digitação — as validações de "pode disparar?" continuam onde estão, só deixaram de ser a
// ÚNICA barreira contra um mês inexistente.
//
// ESCOPO: é só o campo. Nenhuma regra de negócio de competência mora aqui (decisão D2-A).
import { useId, type ReactNode } from 'react';

export interface CampoCompetenciaProps {
  /** Competência no formato AAAA-MM. String vazia = não informada. */
  value: string;
  /** Recebe já o valor do campo (AAAA-MM ou '' quando o operador limpa). */
  onChange: (competencia: string) => void;
  /** Rótulo visível e alvo de `getByLabelText`. */
  label?: string;
  /**
   * `id` explícito do `<input>`. Só necessário quando algo externo referencia o campo; sem ele
   * o componente gera um id estável via `useId` (permite mais de um campo na mesma tela, como
   * os 3 modos de `NovaExecucao`).
   */
  id?: string;
  /** `name` do input — usado quando o campo vive dentro de um `<form>` que é submetido. */
  name?: string;
  /**
   * Texto de apoio abaixo do campo. Substitui o `<p className="text-xs text-cc-muted">` que cada
   * consumidor escrevia à mão — nenhum dos 6 pontos migrados usa (o de `NovaExecucao` dizia
   * "Formato: AAAA-MM", instrução que morreu junto com o campo de texto).
   */
  ajuda?: ReactNode;
  disabled?: boolean;
  /** Classes do wrapper — ex.: `max-w-[10rem]` para o campo estreito do diálogo de lote. */
  containerClassName?: string;
}

export function CampoCompetencia({
  value,
  onChange,
  label = 'Competência',
  id,
  name,
  ajuda,
  disabled = false,
  containerClassName,
}: CampoCompetenciaProps) {
  const idGerado = useId();
  const inputId = id ?? `competencia-${idGerado}`;

  return (
    <div className={containerClassName}>
      <label htmlFor={inputId} className="field-label mb-1.5">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        type="month"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="input"
      />
      {ajuda != null && <p className="mt-1.5 text-xs text-cc-muted">{ajuda}</p>}
    </div>
  );
}

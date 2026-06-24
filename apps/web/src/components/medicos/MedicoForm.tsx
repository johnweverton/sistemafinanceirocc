'use client';
import { useMemo, useState } from 'react';
import type { Medico } from '@cobranca/shared';
import { tipoDoMedico, combinacaoClasseValida } from '@cobranca/shared';
import type { NovoMedicoPayload } from '@/services/medicos';

type FormState = NovoMedicoPayload;

const VAZIO: FormState = {
  cpf: '',
  nome: '',
  especialidade: null,
  statusHapvida: 'credenciado',
  fazOutrosHospitais: false,
  fazImobilizacoes: false,
  modoMudancaData: 'nao',
  colaboradorResponsavel: null,
  ativo: true,
};

interface Props {
  inicial?: Medico;
  /** Em edição, o motivo é obrigatório (PRD §8.2). */
  exigeMotivo?: boolean;
  onSubmit: (dados: FormState, motivo: string) => Promise<void> | void;
  salvando?: boolean;
}

export function MedicoForm({ inicial, exigeMotivo = false, onSubmit, salvando = false }: Props) {
  const [form, setForm] = useState<FormState>(
    inicial
      ? {
          cpf: inicial.cpf,
          nome: inicial.nome,
          especialidade: inicial.especialidade,
          statusHapvida: inicial.statusHapvida,
          fazOutrosHospitais: inicial.fazOutrosHospitais,
          fazImobilizacoes: inicial.fazImobilizacoes,
          modoMudancaData: inicial.modoMudancaData,
          colaboradorResponsavel: inicial.colaboradorResponsavel,
          ativo: inicial.ativo,
        }
      : VAZIO,
  );
  const [motivo, setMotivo] = useState('');

  const combinacaoValida = useMemo(
    () => combinacaoClasseValida(form),
    [form],
  );

  // TIPO é calculado, nunca editável (PRD §5.1, §8.2).
  const tipo = useMemo(() => (combinacaoValida ? tipoDoMedico(form) : null), [combinacaoValida, form]);

  const motivoOk = !exigeMotivo || motivo.trim().length > 0;
  const podeSalvar = combinacaoValida && motivoOk && form.cpf.length === 11 && form.nome.trim().length > 0;

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (podeSalvar) void onSubmit(form, motivo);
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">CPF (11 dígitos)</span>
          <input
            name="cpf"
            value={form.cpf}
            onChange={(e) => set('cpf', e.target.value.replace(/\D/g, '').slice(0, 11))}
            className="mt-1 w-full rounded border px-3 py-2"
            disabled={!!inicial}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Nome</span>
          <input
            name="nome"
            value={form.nome}
            onChange={(e) => set('nome', e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Especialidade</span>
          <input
            name="especialidade"
            value={form.especialidade ?? ''}
            onChange={(e) => set('especialidade', e.target.value || null)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Status Hapvida</span>
          <select
            name="statusHapvida"
            value={form.statusHapvida}
            onChange={(e) => set('statusHapvida', e.target.value as FormState['statusHapvida'])}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            <option value="credenciado">Credenciado</option>
            <option value="nao_credenciado">Não credenciado</option>
            <option value="nenhum">Nenhum</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="fazOutrosHospitais"
            checked={form.fazOutrosHospitais}
            onChange={(e) => set('fazOutrosHospitais', e.target.checked)}
          />
          <span className="text-sm font-medium">Faz outros hospitais</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="fazImobilizacoes"
            checked={form.fazImobilizacoes}
            onChange={(e) => set('fazImobilizacoes', e.target.checked)}
          />
          <span className="text-sm font-medium">Faz imobilizações</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Modo de mudança de data</span>
          <select
            name="modoMudancaData"
            value={form.modoMudancaData}
            onChange={(e) => set('modoMudancaData', e.target.value as FormState['modoMudancaData'])}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            <option value="nao">NÃO (não muda data)</option>
            <option value="sim">SIM (muda data)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Colaborador responsável</span>
          <input
            name="colaboradorResponsavel"
            value={form.colaboradorResponsavel ?? ''}
            onChange={(e) => set('colaboradorResponsavel', e.target.value || null)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="ativo"
            checked={form.ativo}
            onChange={(e) => set('ativo', e.target.checked)}
          />
          <span className="text-sm font-medium">Ativo</span>
        </label>
      </div>

      {/* TIPO derivado, somente leitura (PRD §5.1). */}
      <div className="rounded bg-gray-100 px-3 py-2 text-sm" aria-live="polite">
        {combinacaoValida ? (
          <span>
            TIPO calculado: <strong>{tipo}</strong>
          </span>
        ) : (
          <span role="alert" className="text-red-600">
            Combinação inválida: sem Hapvida e sem outros hospitais. Ajuste antes de salvar.
          </span>
        )}
      </div>

      {exigeMotivo && (
        <label className="block">
          <span className="text-sm font-medium">Motivo da alteração (obrigatório)</span>
          <textarea
            name="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            rows={2}
          />
        </label>
      )}

      <button
        type="submit"
        disabled={!podeSalvar || salvando}
        className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

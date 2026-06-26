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

  const combinacaoValida = useMemo(() => combinacaoClasseValida(form), [form]);
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
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="CPF (11 digitos)">
          <input
            name="cpf"
            value={form.cpf}
            onChange={(e) => set('cpf', e.target.value.replace(/\D/g, '').slice(0, 11))}
            className="input font-mono tracking-widest"
            placeholder="00000000000"
            disabled={!!inicial}
            maxLength={11}
          />
        </Field>

        <Field label="Nome completo">
          <input
            name="nome"
            value={form.nome}
            onChange={(e) => set('nome', e.target.value)}
            className="input"
            placeholder="Dr. Nome Sobrenome"
          />
        </Field>

        <Field label="Especialidade" optional>
          <input
            name="especialidade"
            value={form.especialidade ?? ''}
            onChange={(e) => set('especialidade', e.target.value || null)}
            className="input"
            placeholder="Cardiologia, Ortopedia..."
          />
        </Field>

        <Field label="Status Hapvida">
          <select
            name="statusHapvida"
            value={form.statusHapvida}
            onChange={(e) => set('statusHapvida', e.target.value as FormState['statusHapvida'])}
            className="input"
          >
            <option value="credenciado">Credenciado</option>
            <option value="nao_credenciado">Nao credenciado</option>
            <option value="nenhum">Nenhum</option>
          </select>
        </Field>

        <Field label="Colaborador responsavel" optional>
          <input
            name="colaboradorResponsavel"
            value={form.colaboradorResponsavel ?? ''}
            onChange={(e) => set('colaboradorResponsavel', e.target.value || null)}
            className="input"
            placeholder="Nome do colaborador"
          />
        </Field>

        <Field label="Mudanca de data">
          <select
            name="modoMudancaData"
            value={form.modoMudancaData}
            onChange={(e) => set('modoMudancaData', e.target.value as FormState['modoMudancaData'])}
            className="input"
          >
            <option value="nao">Nao muda data</option>
            <option value="sim">Muda data</option>
          </select>
        </Field>
      </div>

      {/* Checkboxes */}
      <div className="flex flex-wrap gap-6">
        <CheckField
          name="fazOutrosHospitais"
          checked={form.fazOutrosHospitais}
          onChange={(v) => set('fazOutrosHospitais', v)}
          label="Faz outros hospitais"
        />
        <CheckField
          name="fazImobilizacoes"
          checked={form.fazImobilizacoes}
          onChange={(v) => set('fazImobilizacoes', v)}
          label="Faz imobilizacoes"
        />
        <CheckField
          name="ativo"
          checked={form.ativo}
          onChange={(v) => set('ativo', v)}
          label="Medico ativo"
        />
      </div>

      {/* Tipo calculado */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          combinacaoValida
            ? 'border-cc-hairline bg-cc-accent-soft text-cc-accent-hover'
            : 'border-red-200 bg-cc-danger-soft text-cc-danger'
        }`}
        aria-live="polite"
      >
        {combinacaoValida ? (
          <span>
            Tipo calculado: <strong>{tipo}</strong>
          </span>
        ) : (
          <span role="alert">
            Combinacao invalida: sem Hapvida e sem outros hospitais. Ajuste antes de salvar.
          </span>
        )}
      </div>

      {exigeMotivo && (
        <Field label="Motivo da alteracao">
          <textarea
            name="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="input resize-none"
            rows={2}
            placeholder="Descreva o motivo da alteracao..."
          />
        </Field>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={!podeSalvar || salvando} className="btn-primary">
          {salvando ? 'Salvando...' : 'Salvar medico'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label mb-1.5">
        {label}
        {optional && <span className="ml-1 font-normal normal-case text-cc-muted">(opcional)</span>}
      </span>
      {children}
    </label>
  );
}

function CheckField({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-cc-hairline accent-cc-accent"
      />
      <span className="text-sm text-cc-ink-2">{label}</span>
    </label>
  );
}

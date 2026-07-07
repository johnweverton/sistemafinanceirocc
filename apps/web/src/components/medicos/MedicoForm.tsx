'use client';
import { useMemo, useState } from 'react';
import type { Medico, DadosCobranca, PagadorTipo } from '@cobranca/shared';
import { tipoDoMedico, combinacaoClasseValida } from '@cobranca/shared';
import type { NovoMedicoPayload } from '@/services/medicos';
import { buscarEnderecoPorCep } from '@/lib/viacep';

type FormState = NovoMedicoPayload;

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const COBRANCA_VAZIA: DadosCobranca = {
  pagadorTipo: 'PF',
  pagadorDocumento: '',
  pagadorNome: '',
  email: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: null,
  bairro: '',
  cidade: '',
  uf: '',
};

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

/** True se o usuário digitou algo em qualquer campo de cobrança (define se enviamos o bloco). */
function temAlgumaCobranca(c: DadosCobranca): boolean {
  return Boolean(
    c.pagadorDocumento || c.pagadorNome || c.email || c.cep ||
    c.logradouro || c.numero || c.bairro || c.cidade || c.uf,
  );
}

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
          cpf: inicial.cpf ?? '',
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
  const [cobranca, setCobranca] = useState<DadosCobranca>(inicial?.cobranca ?? COBRANCA_VAZIA);
  const [cepBuscando, setCepBuscando] = useState(false);

  const combinacaoValida = useMemo(() => combinacaoClasseValida(form), [form]);
  const tipo = useMemo(() => (combinacaoValida ? tipoDoMedico(form) : null), [combinacaoValida, form]);
  const motivoOk = !exigeMotivo || motivo.trim().length > 0;
  // CPF opcional: se tem tamanho, tem que ser 11, se não, é válido.
  const cpfOk = form.cpf.length === 0 || form.cpf.length === 11;
  const podeSalvar = combinacaoValida && motivoOk && cpfOk && form.nome.trim().length > 0;

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function setCob<K extends keyof DadosCobranca>(campo: K, valor: DadosCobranca[K]) {
    setCobranca((c) => ({ ...c, [campo]: valor }));
  }

  const maxDoc = cobranca.pagadorTipo === 'PF' ? 11 : 14;

  async function onCepChange(valor: string) {
    const limpo = valor.replace(/\D/g, '').slice(0, 8);
    setCob('cep', limpo);
    if (limpo.length === 8) {
      setCepBuscando(true);
      const endereco = await buscarEnderecoPorCep(limpo);
      setCepBuscando(false);
      if (endereco) {
        setCobranca((c) => ({
          ...c,
          logradouro: endereco.logradouro || c.logradouro,
          bairro: endereco.bairro || c.bairro,
          cidade: endereco.cidade || c.cidade,
          uf: endereco.uf || c.uf,
        }));
      }
    }
  }

  const isPediatra = form.especialidade?.toLowerCase().includes('pediat') ?? false;

  function handleSubmit() {
    const payload: FormState = {
      ...form,
      modoMudancaData: isPediatra ? form.modoMudancaData : 'nao',
      cobranca: temAlgumaCobranca(cobranca) ? cobranca : null,
    };
    void onSubmit(payload, motivo);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (podeSalvar) handleSubmit();
      }}
      className="space-y-6"
    >
      {inicial?.externalId && (
        <div className="alert-info text-sm py-2 mb-4">
          <span className="font-semibold">Vínculo: </span> 
          Este médico está sincronizado com o sistema web (ID: {inicial.externalId}).
        </div>
      )}
      
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="CPF (11 dígitos)" optional>
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
            <option value="nao_credenciado">Não credenciado</option>
            <option value="nenhum">Nenhum</option>
          </select>
        </Field>

        <Field label="Colaborador responsável" optional>
          <input
            name="colaboradorResponsavel"
            value={form.colaboradorResponsavel ?? ''}
            onChange={(e) => set('colaboradorResponsavel', e.target.value || null)}
            className="input"
            placeholder="Nome do colaborador"
          />
        </Field>

        {isPediatra && (
          <Field label="Mudança de data (Pediatria)">
            <select
              name="modoMudancaData"
              value={form.modoMudancaData}
              onChange={(e) => set('modoMudancaData', e.target.value as FormState['modoMudancaData'])}
              className="input"
            >
              <option value="nao">Não muda data</option>
              <option value="sim">Muda data</option>
            </select>
          </Field>
        )}
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
          label="Faz imobilizações"
        />
        <CheckField
          name="ativo"
          checked={form.ativo}
          onChange={(v) => set('ativo', v)}
          label="Médico ativo"
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
            Combinação inválida: sem Hapvida e sem outros hospitais. Ajuste antes de salvar.
          </span>
        )}
      </div>

      {/* Seção de cobrança (colapsável, opcional) */}
      <details className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4" open={!!inicial?.cobranca}>
        <summary className="cursor-pointer text-sm font-semibold text-cc-ink">
          Dados de cobrança <span className="font-normal text-cc-muted">(para emissão de boleto)</span>
        </summary>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tipo de pagador">
              <select
                value={cobranca.pagadorTipo}
                onChange={(e) => {
                  const t = e.target.value as PagadorTipo;
                  setCobranca((c) => ({ ...c, pagadorTipo: t, pagadorDocumento: '' }));
                }}
                className="input"
              >
                <option value="PF">Pessoa Física (CPF)</option>
                <option value="PJ">Pessoa Jurídica (CNPJ)</option>
              </select>
            </Field>

            <Field label={cobranca.pagadorTipo === 'PF' ? 'CPF do pagador' : 'CNPJ do pagador'}>
              <input
                value={cobranca.pagadorDocumento}
                onChange={(e) => setCob('pagadorDocumento', e.target.value.replace(/\D/g, '').slice(0, maxDoc))}
                className="input font-mono tracking-widest"
                placeholder={cobranca.pagadorTipo === 'PF' ? '00000000000' : '00000000000000'}
                maxLength={maxDoc}
              />
            </Field>

            <Field label="Nome / Razão social">
              <input value={cobranca.pagadorNome} onChange={(e) => setCob('pagadorNome', e.target.value)} className="input" placeholder="Nome do pagador" />
            </Field>

            <Field label="E-mail">
              <input type="email" value={cobranca.email} onChange={(e) => setCob('email', e.target.value)} className="input" placeholder="pagador@exemplo.com" />
            </Field>

            <Field label="CEP">
              <input
                value={cobranca.cep}
                onChange={(e) => void onCepChange(e.target.value)}
                className="input font-mono"
                placeholder="00000000"
                maxLength={8}
              />
              {cepBuscando && <span className="mt-1 block text-2xs text-cc-muted">Buscando endereço…</span>}
            </Field>

            <Field label="UF">
              <select value={cobranca.uf} onChange={(e) => setCob('uf', e.target.value)} className="input">
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </Field>

            <Field label="Logradouro">
              <input value={cobranca.logradouro} onChange={(e) => setCob('logradouro', e.target.value)} className="input" placeholder="Rua, avenida…" />
            </Field>

            <Field label="Número">
              <input value={cobranca.numero} onChange={(e) => setCob('numero', e.target.value)} className="input" placeholder="123" />
            </Field>

            <Field label="Bairro">
              <input value={cobranca.bairro} onChange={(e) => setCob('bairro', e.target.value)} className="input" placeholder="Centro" />
            </Field>

            <Field label="Cidade">
              <input value={cobranca.cidade} onChange={(e) => setCob('cidade', e.target.value)} className="input" placeholder="Cidade" />
            </Field>

            <Field label="Complemento" optional>
              <input value={cobranca.complemento ?? ''} onChange={(e) => setCob('complemento', e.target.value || null)} className="input" placeholder="Sala, apto…" />
            </Field>
          </div>
          <p className="text-2xs text-cc-muted">
            Preencha todos os campos obrigatórios para habilitar a emissão de boleto deste médico.
            O endereço é preenchido automaticamente pelo CEP.
          </p>
        </div>
      </details>

      {exigeMotivo && (
        <Field label="Motivo da alteração">
          <textarea
            name="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="input resize-none"
            rows={2}
            placeholder="Descreva o motivo da alteração..."
          />
        </Field>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={!podeSalvar || salvando} className="btn-primary">
          {salvando ? 'Salvando...' : 'Salvar médico'}
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

'use client';
import { useMemo, useState } from 'react';
import type { Empresa, DadosCobranca, PagadorTipo, CondicoesCobranca, ContaEmissora, RegraPreco, RegraPrecoForma } from '@cobranca/shared';
import { CONTAS_EMISSORAS_VALIDAS, CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import type { NovaEmpresaPayload } from '@/services/empresas';
import { buscarEnderecoPorCep } from '@/lib/viacep';

// contaEmissora admite '' no ESTADO (empresa nova começa sem escolha, mesmo padrão do médico);
// o submit só habilita com empresa emissora selecionada.
type FormState = Omit<NovaEmpresaPayload, 'contaEmissora'> & { contaEmissora: ContaEmissora | '' };

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const COBRANCA_VAZIA: DadosCobranca = {
  pagadorTipo: 'PJ', // empresa é quase sempre pagador PJ (CNPJ) — default diferente do médico
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
  whatsapp: '',
};

const VAZIO: FormState = {
  nome: '',
  contaEmissora: '',
  ativo: true,
};

const REGRA_PRECO_VAZIA: RegraPreco = {
  forma: 'por_guia',
  base: null,
  limiar: null,
  taxa: null,
  valorFixo: null,
  valorAbaixoLimiar: null,
  valorAcimaLimiar: null,
};

/** True se o usuário digitou algo em qualquer campo de cobrança (define se enviamos o bloco). */
function temAlgumaCobranca(c: DadosCobranca): boolean {
  return Boolean(
    c.pagadorDocumento || c.pagadorNome || c.email || c.whatsapp || c.cep ||
    c.logradouro || c.numero || c.bairro || c.cidade || c.uf,
  );
}

const CONDICOES_VAZIAS: CondicoesCobranca = {
  diasVencimento: null,
  multaPercent: null,
  jurosMesPercent: null,
  descontoPercent: null,
  descontoDias: null,
};

/** True se algum override comercial foi preenchido (campo vazio herda o padrão global). */
function temAlgumaCondicao(c: CondicoesCobranca): boolean {
  return Object.values(c).some((v) => v != null);
}

interface Props {
  inicial?: Empresa;
  exigeMotivo?: boolean;
  onSubmit: (dados: NovaEmpresaPayload, motivo: string) => Promise<void> | void;
  salvando?: boolean;
}

export function EmpresaForm({ inicial, exigeMotivo = false, onSubmit, salvando = false }: Props) {
  const [form, setForm] = useState<FormState>(
    inicial
      ? { nome: inicial.nome, contaEmissora: inicial.contaEmissora, ativo: inicial.ativo }
      : VAZIO,
  );
  const [motivo, setMotivo] = useState('');
  const [cobranca, setCobranca] = useState<DadosCobranca>(inicial?.cobranca ?? COBRANCA_VAZIA);
  const [condicoes, setCondicoes] = useState<CondicoesCobranca>(inicial?.condicoes ?? CONDICOES_VAZIAS);
  const [regraPreco, setRegraPrecoState] = useState<RegraPreco | null>(inicial?.regraPreco ?? null);
  const [cepBuscando, setCepBuscando] = useState(false);

  const motivoOk = !exigeMotivo || motivo.trim().length > 0;
  // Regra de preço, se preenchida, precisa ser coerente com a forma (espelho da CHECK 0028) —
  // igual à validação de médico, mas aqui a regra é sempre opcional (nenhum "modo").
  const regraPrecoOk =
    regraPreco == null ||
    (regraPreco.forma === 'por_guia'
      ? regraPreco.taxa != null
      : regraPreco.forma === 'base_excedente'
        ? regraPreco.base != null && regraPreco.limiar != null && regraPreco.taxa != null
        : regraPreco.valorFixo != null);
  const contaOk = form.contaEmissora !== '';
  const podeSalvar = motivoOk && regraPrecoOk && contaOk && form.nome.trim().length > 0;

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function setRegra<K extends keyof RegraPreco>(campo: K, valor: RegraPreco[K]) {
    setRegraPrecoState((r) => ({ ...(r ?? REGRA_PRECO_VAZIA), [campo]: valor }));
  }

  /** Campo numérico da regra de preço: '' vira null. */
  function setRegraNum(campo: keyof Omit<RegraPreco, 'forma'>, valor: string) {
    setRegra(campo, valor === '' ? null : Number(valor));
  }

  function setCob<K extends keyof DadosCobranca>(campo: K, valor: DadosCobranca[K]) {
    setCobranca((c) => ({ ...c, [campo]: valor }));
  }

  /** Campos numéricos de override: '' vira null (herda o padrão global). */
  function setCond(campo: keyof CondicoesCobranca, valor: string) {
    setCondicoes((c) => ({ ...c, [campo]: valor === '' ? null : Number(valor) }));
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

  function handleSubmit() {
    const payload: NovaEmpresaPayload = {
      ...form,
      contaEmissora: form.contaEmissora as ContaEmissora, // garantido por podeSalvar (contaOk)
      cobranca: temAlgumaCobranca(cobranca) ? cobranca : null,
      condicoes: temAlgumaCondicao(condicoes) ? condicoes : null,
      regraPreco,
    };
    void onSubmit(payload, exigeMotivo ? motivo : 'Cadastro inicial da empresa');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (podeSalvar) handleSubmit();
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome da empresa">
          <input
            name="nome"
            value={form.nome}
            onChange={(e) => set('nome', e.target.value)}
            className="input"
            placeholder="Ex.: MEDISA"
          />
        </Field>

        <Field label="Empresa emissora (boletos)">
          <select
            name="contaEmissora"
            value={form.contaEmissora}
            onChange={(e) => set('contaEmissora', e.target.value as FormState['contaEmissora'])}
            className="input"
            aria-invalid={!contaOk}
            required
          >
            <option value="" disabled>
              Selecione a empresa…
            </option>
            {CONTAS_EMISSORAS_VALIDAS.map((conta) => (
              <option key={conta} value={conta}>
                {CONTA_EMISSORA_LABEL[conta]}
              </option>
            ))}
          </select>
          {!contaOk && (
            <p className="mt-1 text-xs text-cc-danger" role="alert">
              Escolha a conta que emitirá os boletos desta empresa.
            </p>
          )}
        </Field>
      </div>

      <CheckField
        name="ativo"
        checked={form.ativo}
        onChange={(v) => set('ativo', v)}
        label="Empresa ativa"
      />

      <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-cc-ink">Regra de preço da produção agregada</p>
          <CheckField
            name="temRegraPreco"
            checked={regraPreco != null}
            onChange={(v) => setRegraPrecoState(v ? REGRA_PRECO_VAZIA : null)}
            label="Configurar"
          />
        </div>

        {regraPreco && (
          <>
            <Field label="Forma da regra">
              <select
                value={regraPreco.forma}
                onChange={(e) => setRegra('forma', e.target.value as RegraPrecoForma)}
                className="input"
              >
                <option value="por_guia">Por guia linear (ex.: MEDISA R$6,41/guia)</option>
                <option value="base_excedente">Base + excedente com limiar</option>
                <option value="fixo">Valor fixo mensal</option>
              </select>
              <p className="mt-1.5 text-2xs text-cc-muted">
                A execução agregada (Story 10.4b) hoje só suporta a forma &ldquo;por guia
                linear&rdquo; — as demais geram alerta em vez de um rateio entre médicos.
              </p>
            </Field>

            {regraPreco.forma === 'por_guia' ? (
              <Field label="Taxa por guia (R$)">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={regraPreco.taxa ?? ''}
                  onChange={(e) => setRegraNum('taxa', e.target.value)}
                  className="input tabular"
                  placeholder="6.41"
                />
              </Field>
            ) : regraPreco.forma === 'base_excedente' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Base (R$)">
                  <input type="number" min={0} step={0.01} value={regraPreco.base ?? ''}
                    onChange={(e) => setRegraNum('base', e.target.value)} className="input tabular" placeholder="0.00" />
                </Field>
                <Field label="Limiar (guias)">
                  <input type="number" min={0} step={1} value={regraPreco.limiar ?? ''}
                    onChange={(e) => setRegraNum('limiar', e.target.value)} className="input tabular" placeholder="0" />
                </Field>
                <Field label="Taxa por guia excedente (R$)">
                  <input type="number" min={0} step={0.01} value={regraPreco.taxa ?? ''}
                    onChange={(e) => setRegraNum('taxa', e.target.value)} className="input tabular" placeholder="0.00" />
                </Field>
              </div>
            ) : (
              <Field label="Valor fixo mensal (R$)">
                <input type="number" min={0} step={0.01} value={regraPreco.valorFixo ?? ''}
                  onChange={(e) => setRegraNum('valorFixo', e.target.value)} className="input tabular" placeholder="0.00" />
              </Field>
            )}

            {!regraPrecoOk && (
              <p className="text-xs text-cc-danger" role="alert">
                Preencha todos os campos da regra de preço.
              </p>
            )}
          </>
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
                <option value="PJ">Pessoa Jurídica (CNPJ)</option>
                <option value="PF">Pessoa Física (CPF)</option>
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

            <Field label="Razão social">
              <input value={cobranca.pagadorNome} onChange={(e) => setCob('pagadorNome', e.target.value)} className="input" placeholder="Razão social" />
            </Field>

            <Field label="E-mail" optional>
              <input type="email" value={cobranca.email} onChange={(e) => setCob('email', e.target.value)} className="input" placeholder="contato@empresa.com" />
            </Field>

            <Field label="WhatsApp / ID do Grupo" optional>
              <input value={cobranca.whatsapp ?? ''} onChange={(e) => setCob('whatsapp', e.target.value || null)} className="input" placeholder="5511999999999 ou ID do grupo" />
            </Field>

            <Field label="CEP" optional>
              <input
                value={cobranca.cep}
                onChange={(e) => void onCepChange(e.target.value)}
                className="input font-mono"
                placeholder="00000000"
                maxLength={8}
              />
              {cepBuscando && <span className="mt-1 block text-2xs text-cc-muted">Buscando endereço…</span>}
            </Field>

            <Field label="UF" optional>
              <select value={cobranca.uf} onChange={(e) => setCob('uf', e.target.value)} className="input">
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </Field>

            <Field label="Logradouro" optional>
              <input value={cobranca.logradouro} onChange={(e) => setCob('logradouro', e.target.value)} className="input" placeholder="Rua, avenida…" />
            </Field>

            <Field label="Número" optional>
              <input value={cobranca.numero} onChange={(e) => setCob('numero', e.target.value)} className="input" placeholder="123" />
            </Field>

            <Field label="Bairro" optional>
              <input value={cobranca.bairro} onChange={(e) => setCob('bairro', e.target.value)} className="input" placeholder="Centro" />
            </Field>

            <Field label="Cidade" optional>
              <input value={cobranca.cidade} onChange={(e) => setCob('cidade', e.target.value)} className="input" placeholder="Cidade" />
            </Field>

            <Field label="Complemento" optional>
              <input value={cobranca.complemento ?? ''} onChange={(e) => setCob('complemento', e.target.value || null)} className="input" placeholder="Sala, apto…" />
            </Field>
          </div>
          <p className="text-2xs text-cc-muted">
            Preencha todos os campos obrigatórios para habilitar a emissão de boleto desta empresa.
            O endereço é preenchido automaticamente pelo CEP.
          </p>
        </div>
      </details>

      {/* Condições comerciais (override do padrão global de Configurações) */}
      <details
        className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4"
        open={!!inicial?.condicoes && temAlgumaCondicao(inicial.condicoes)}
      >
        <summary className="cursor-pointer text-sm font-semibold text-cc-ink">
          Condições do boleto <span className="font-normal text-cc-muted">(override — vazio herda o padrão global)</span>
        </summary>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Vencimento (dias)" optional>
              <input type="number" min={0} max={365} value={condicoes.diasVencimento ?? ''}
                onChange={(e) => setCond('diasVencimento', e.target.value)} className="input" placeholder="Padrão global" />
            </Field>
            <Field label="Multa (%)" optional>
              <input type="number" min={0} max={100} step="0.01" value={condicoes.multaPercent ?? ''}
                onChange={(e) => setCond('multaPercent', e.target.value)} className="input" placeholder="Padrão global" />
            </Field>
            <Field label="Juros ao mês (%)" optional>
              <input type="number" min={0} max={100} step="0.01" value={condicoes.jurosMesPercent ?? ''}
                onChange={(e) => setCond('jurosMesPercent', e.target.value)} className="input" placeholder="Padrão global" />
            </Field>
            <Field label="Desconto (%)" optional>
              <input type="number" min={0} max={100} step="0.01" value={condicoes.descontoPercent ?? ''}
                onChange={(e) => setCond('descontoPercent', e.target.value)} className="input" placeholder="Padrão global" />
            </Field>
            <Field label="Desconto até (dias)" optional>
              <input type="number" min={0} max={365} value={condicoes.descontoDias ?? ''}
                onChange={(e) => setCond('descontoDias', e.target.value)} className="input" placeholder="Padrão global" />
            </Field>
          </div>
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
          {salvando ? 'Salvando...' : 'Salvar empresa'}
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

'use client';
import { useState } from 'react';
import type {
  ClienteContabilidade,
  DadosCobranca,
  PagadorTipo,
  CondicoesCobranca,
  ContaEmissora,
  RegraPreco,
  RegimeTributario,
  ModoCobrancaContabilidade,
} from '@cobranca/shared';
import { CONTAS_EMISSORAS_VALIDAS, CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import type { NovoClienteContabilidadePayload } from '@/services/clientes-contabilidade';
import { buscarEnderecoPorCep } from '@/lib/viacep';

// contaEmissora admite '' no ESTADO (cliente novo começa sem escolha, mesmo padrão de
// empresa/médico); o submit só habilita com empresa emissora selecionada.
type FormState = Omit<NovoClienteContabilidadePayload, 'contaEmissora'> & { contaEmissora: ContaEmissora | '' };

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const COBRANCA_VAZIA: DadosCobranca = {
  pagadorTipo: 'PJ', // cliente contábil é quase sempre pagador PJ (CNPJ)
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

const CONDICOES_VAZIAS: CondicoesCobranca = {
  diasVencimento: null,
  multaPercent: null,
  jurosMesPercent: null,
  descontoPercent: null,
  descontoDias: null,
};

const REGRA_PRECO_VAZIA: RegraPreco = {
  forma: 'faixa_faturamento',
  base: null,
  limiar: 5000,
  taxa: null,
  valorFixo: null,
  valorAbaixoLimiar: 250,
  valorAcimaLimiar: 480.56,
};

const VAZIO: FormState = {
  nome: '',
  regimeTributario: 'simples_nacional',
  modoCobranca: 'faixa_faturamento',
  contaEmissora: '',
  adicionalAtivo: false,
  adicionalValor: null,
  adicionalIntervaloMeses: 6,
  adicionalCompetenciaBase: null,
  ativo: true,
};

/** True se o usuário digitou algo em qualquer campo de cobrança (define se enviamos o bloco). */
function temAlgumaCobranca(c: DadosCobranca): boolean {
  return Boolean(
    c.pagadorDocumento || c.pagadorNome || c.email || c.whatsapp || c.cep ||
    c.logradouro || c.numero || c.bairro || c.cidade || c.uf,
  );
}

/** True se algum override comercial foi preenchido (campo vazio herda o padrão global). */
function temAlgumaCondicao(c: CondicoesCobranca): boolean {
  return Object.values(c).some((v) => v != null);
}

/** Regra de preço coerente com o modo de cobrança selecionado (espelho da CHECK 0030). */
function regraCoerenteComModo(modo: ModoCobrancaContabilidade, r: RegraPreco): boolean {
  if (modo === 'fixo') return r.valorFixo != null;
  return r.limiar != null && r.valorAbaixoLimiar != null && r.valorAcimaLimiar != null;
}

interface Props {
  inicial?: ClienteContabilidade;
  exigeMotivo?: boolean;
  onSubmit: (dados: NovoClienteContabilidadePayload, motivo: string) => Promise<void> | void;
  salvando?: boolean;
}

export function ClienteContabilidadeForm({ inicial, exigeMotivo = false, onSubmit, salvando = false }: Props) {
  const [form, setForm] = useState<FormState>(
    inicial
      ? {
          nome: inicial.nome,
          regimeTributario: inicial.regimeTributario,
          modoCobranca: inicial.modoCobranca,
          contaEmissora: inicial.contaEmissora,
          adicionalAtivo: inicial.adicionalAtivo,
          adicionalValor: inicial.adicionalValor,
          adicionalIntervaloMeses: inicial.adicionalIntervaloMeses,
          adicionalCompetenciaBase: inicial.adicionalCompetenciaBase,
          ativo: inicial.ativo,
        }
      : VAZIO,
  );
  const [motivo, setMotivo] = useState('');
  const [cobranca, setCobranca] = useState<DadosCobranca>(inicial?.cobranca ?? COBRANCA_VAZIA);
  const [condicoes, setCondicoes] = useState<CondicoesCobranca>(inicial?.condicoes ?? CONDICOES_VAZIAS);
  const [regraPreco, setRegraPrecoState] = useState<RegraPreco>(
    inicial?.regraPreco ?? { ...REGRA_PRECO_VAZIA, forma: VAZIO.modoCobranca },
  );
  const [cepBuscando, setCepBuscando] = useState(false);

  const motivoOk = !exigeMotivo || motivo.trim().length > 0;
  const regraOk = regraCoerenteComModo(form.modoCobranca, regraPreco);
  const adicionalOk =
    !form.adicionalAtivo ||
    (form.adicionalValor != null && form.adicionalIntervaloMeses != null && !!form.adicionalCompetenciaBase);
  const contaOk = form.contaEmissora !== '';
  const podeSalvar = motivoOk && regraOk && adicionalOk && contaOk && form.nome.trim().length > 0;

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function onModoChange(modo: ModoCobrancaContabilidade) {
    set('modoCobranca', modo);
    setRegraPrecoState((r) => ({ ...REGRA_PRECO_VAZIA, forma: modo, ...(modo === 'fixo' ? { valorFixo: r.valorFixo } : {}) }));
  }

  function setRegra<K extends keyof RegraPreco>(campo: K, valor: RegraPreco[K]) {
    setRegraPrecoState((r) => ({ ...r, [campo]: valor }));
  }

  function setRegraNum(campo: keyof Omit<RegraPreco, 'forma'>, valor: string) {
    setRegra(campo, valor === '' ? null : Number(valor));
  }

  function setCob<K extends keyof DadosCobranca>(campo: K, valor: DadosCobranca[K]) {
    setCobranca((c) => ({ ...c, [campo]: valor }));
  }

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
    const payload: NovoClienteContabilidadePayload = {
      ...form,
      contaEmissora: form.contaEmissora as ContaEmissora, // garantido por podeSalvar (contaOk)
      cobranca: temAlgumaCobranca(cobranca) ? cobranca : null,
      condicoes: temAlgumaCondicao(condicoes) ? condicoes : null,
      regraPreco,
      adicionalValor: form.adicionalAtivo ? form.adicionalValor : null,
      adicionalIntervaloMeses: form.adicionalAtivo ? form.adicionalIntervaloMeses : null,
      adicionalCompetenciaBase: form.adicionalAtivo ? form.adicionalCompetenciaBase : null,
    };
    void onSubmit(payload, exigeMotivo ? motivo : 'Cadastro inicial do cliente contábil');
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
        <Field label="Nome do cliente">
          <input
            name="nome"
            value={form.nome}
            onChange={(e) => set('nome', e.target.value)}
            className="input"
            placeholder="Razão social ou nome fantasia"
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
              Escolha a conta que emitirá os boletos deste cliente.
            </p>
          )}
        </Field>

        <Field label="Regime tributário">
          <select
            value={form.regimeTributario}
            onChange={(e) => set('regimeTributario', e.target.value as RegimeTributario)}
            className="input"
          >
            <option value="simples_nacional">Simples Nacional</option>
            <option value="lucro_presumido">Lucro Presumido</option>
          </select>
        </Field>

        <Field label="Modo de cobrança">
          <select
            value={form.modoCobranca}
            onChange={(e) => onModoChange(e.target.value as ModoCobrancaContabilidade)}
            className="input"
          >
            <option value="faixa_faturamento">Por faixa de faturamento mensal</option>
            <option value="fixo">Valor fixo (contrato)</option>
          </select>
        </Field>
      </div>

      {/* Nota fora do <label> — texto dentro do <Field> entraria no accessible name do select
          (label envolve todo o conteúdo), colidindo com buscas por "Modo de cobrança". */}
      <p className="-mt-3 text-2xs text-cc-muted">
        Regime tributário é um metadado informativo. Quem decide o cálculo do boleto é o modo de
        cobrança (há exceções fixas dentro do Simples Nacional).
      </p>

      <CheckField
        name="ativo"
        checked={form.ativo}
        onChange={(v) => set('ativo', v)}
        label="Cliente ativo"
      />

      {/* Regra de preço — campos adaptam ao modo de cobrança selecionado */}
      <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4 space-y-4">
        <p className="text-sm font-semibold text-cc-ink">Regra de cálculo do boleto mensal</p>

        {form.modoCobranca === 'faixa_faturamento' ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Limite de faturamento (R$)">
                <input type="number" min={0} step={0.01} value={regraPreco.limiar ?? ''}
                  onChange={(e) => setRegraNum('limiar', e.target.value)} className="input tabular" placeholder="5000.00" />
              </Field>
              <Field label="Valor abaixo do limite (R$)">
                <input type="number" min={0} step={0.01} value={regraPreco.valorAbaixoLimiar ?? ''}
                  onChange={(e) => setRegraNum('valorAbaixoLimiar', e.target.value)} className="input tabular" placeholder="250.00" />
              </Field>
              <Field label="Valor a partir do limite (R$)">
                <input type="number" min={0} step={0.01} value={regraPreco.valorAcimaLimiar ?? ''}
                  onChange={(e) => setRegraNum('valorAcimaLimiar', e.target.value)} className="input tabular" placeholder="480.56" />
              </Field>
            </div>
            <p className="text-2xs text-cc-muted">
              O faturamento do mês é informado na tela de lançamento. O boleto usa o valor
              conforme o faturamento estiver abaixo ou a partir do limite.
            </p>
          </>
        ) : (
          <>
            <Field label="Valor fixo mensal (R$)">
              <input type="number" min={0} step={0.01} value={regraPreco.valorFixo ?? ''}
                onChange={(e) => setRegraNum('valorFixo', e.target.value)} className="input tabular" placeholder="0.00" />
            </Field>
            <p className="text-2xs text-cc-muted">
              Reajustado uma vez por ano (manual). Edite este valor com o motivo do reajuste; o
              histórico fica registrado.
            </p>
          </>
        )}

        {!regraOk && (
          <p className="text-xs text-cc-danger" role="alert">
            Preencha todos os campos da regra de cálculo.
          </p>
        )}
      </div>

      {/* Adicional periódico (ex.: semestral) */}
      <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-cc-ink">Adicional periódico avulso</p>
          <CheckField
            name="adicionalAtivo"
            checked={form.adicionalAtivo}
            onChange={(v) => set('adicionalAtivo', v)}
            label="Cliente tem"
          />
        </div>

        {form.adicionalAtivo && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Valor do adicional (R$)">
                <input type="number" min={0} step={0.01} value={form.adicionalValor ?? ''}
                  onChange={(e) => set('adicionalValor', e.target.value === '' ? null : Number(e.target.value))}
                  className="input tabular" placeholder="15000.00" />
              </Field>
              <Field label="Intervalo (meses)">
                <input type="number" min={1} step={1} value={form.adicionalIntervaloMeses ?? ''}
                  onChange={(e) => set('adicionalIntervaloMeses', e.target.value === '' ? null : Number(e.target.value))}
                  className="input tabular" placeholder="6" />
              </Field>
              <Field label="Competência base (1º ciclo)">
                <input type="month" value={form.adicionalCompetenciaBase ?? ''}
                  onChange={(e) => set('adicionalCompetenciaBase', e.target.value || null)}
                  className="input" />
              </Field>
            </div>
            <p className="text-2xs text-cc-muted">
              Boleto avulso separado do mensal (ex.: Vital Soluções, R$15.000 a cada 6 meses).
              Geração entra na Story 11.4.
            </p>
            {!adicionalOk && (
              <p className="text-xs text-cc-danger" role="alert">
                Preencha valor, intervalo e competência base do adicional.
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
              <input type="email" value={cobranca.email} onChange={(e) => setCob('email', e.target.value)} className="input" placeholder="contato@cliente.com" />
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
                <option value="">Selecione…</option>
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
            Preencha todos os campos obrigatórios para habilitar a emissão de boleto deste cliente.
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
          Condições do boleto <span className="font-normal text-cc-muted">(override: vazio herda o padrão global)</span>
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
          {salvando ? 'Salvando...' : 'Salvar cliente'}
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

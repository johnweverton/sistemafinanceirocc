'use client';
import { useMemo, useState } from 'react';
import type { Medico, DadosCobranca, PagadorTipo, CondicoesCobranca, ContaEmissora, RegraPreco, RegraPrecoForma } from '@cobranca/shared';
import { tipoDoMedico, combinacaoClasseValida, CONTAS_EMISSORAS_VALIDAS, CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import type { NovoMedicoPayload } from '@/services/medicos';
import { buscarEnderecoPorCep } from '@/lib/viacep';

// contaEmissora admite '' no ESTADO (novo médico começa sem escolha — decisão consciente,
// Story 7.3); o submit só habilita com empresa selecionada, e o payload sai tipado.
type FormState = Omit<NovoMedicoPayload, 'contaEmissora'> & { contaEmissora: ContaEmissora | '' };

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
  whatsapp: '',
};

const VAZIO: FormState = {
  cpf: '',
  nome: '',
  especialidade: null,
  statusHapvida: 'credenciado',
  fazOutrosHospitais: false,
  fazImobilizacoes: false,
  modoMudancaData: 'nao',
  modoCobranca: 'faixa_guias',
  percentualProducao: null,
  regraPreco: null,
  contaEmissora: '', // escolha explícita obrigatória em médicos novos (Story 7.3)
  colaboradorResponsavel: null,
  ativo: true,
};

const REGRA_PRECO_VAZIA: RegraPreco = {
  forma: 'por_guia',
  base: null,
  limiar: null,
  taxa: null,
  valorFixo: null,
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
  inicial?: Medico;
  exigeMotivo?: boolean;
  // Recebe o payload já fechado (contaEmissora garantida) — o '' é só estado interno.
  onSubmit: (dados: NovoMedicoPayload, motivo: string) => Promise<void> | void;
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
          modoCobranca: inicial.modoCobranca,
          percentualProducao: inicial.percentualProducao,
          regraPreco: inicial.regraPreco,
          contaEmissora: inicial.contaEmissora, // existentes exibem o backfill ('mc')
          colaboradorResponsavel: inicial.colaboradorResponsavel,
          ativo: inicial.ativo,
        }
      : VAZIO,
  );
  const [motivo, setMotivo] = useState('');
  const [cobranca, setCobranca] = useState<DadosCobranca>(inicial?.cobranca ?? COBRANCA_VAZIA);
  const [condicoes, setCondicoes] = useState<CondicoesCobranca>(inicial?.condicoes ?? CONDICOES_VAZIAS);
  const [cepBuscando, setCepBuscando] = useState(false);

  const combinacaoValida = useMemo(() => combinacaoClasseValida(form), [form]);
  const tipo = useMemo(() => (combinacaoValida ? tipoDoMedico(form) : null), [combinacaoValida, form]);
  const motivoOk = !exigeMotivo || motivo.trim().length > 0;
  // CPF opcional: se tem tamanho, tem que ser 11, se não, é válido.
  const cpfOk = form.cpf.length === 0 || form.cpf.length === 11;
  // Modo percentual exige percentual > 0 (Story 6.2 — espelho da CHECK 0018).
  const percentualOk =
    form.modoCobranca !== 'percentual_producao' ||
    (form.percentualProducao != null && form.percentualProducao > 0);
  // Modo preço próprio exige a regra coerente com a forma (Story 10.1 — espelho das CHECKs 0025/0027).
  const regraPrecoOk =
    form.modoCobranca !== 'preco_proprio' ||
    (form.regraPreco != null &&
      (form.regraPreco.forma === 'por_guia'
        ? form.regraPreco.taxa != null
        : form.regraPreco.forma === 'base_excedente'
          ? form.regraPreco.base != null && form.regraPreco.limiar != null && form.regraPreco.taxa != null
          : form.regraPreco.valorFixo != null));
  // Empresa emissora é obrigatória (Story 7.3): boleto pela empresa errada = contestação.
  const contaOk = form.contaEmissora !== '';
  const podeSalvar =
    combinacaoValida && motivoOk && cpfOk && percentualOk && regraPrecoOk && contaOk && form.nome.trim().length > 0;

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function setRegra<K extends keyof RegraPreco>(campo: K, valor: RegraPreco[K]) {
    setForm((f) => ({ ...f, regraPreco: { ...(f.regraPreco ?? REGRA_PRECO_VAZIA), [campo]: valor } }));
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

  const isPediatra = form.especialidade?.toLowerCase().includes('pediat') ?? false;

  function handleSubmit() {
    const payload: NovoMedicoPayload = {
      ...form,
      // Garantido por podeSalvar (contaOk) — aqui nunca é ''.
      contaEmissora: form.contaEmissora as ContaEmissora,
      modoMudancaData: isPediatra ? form.modoMudancaData : 'nao',
      cobranca: temAlgumaCobranca(cobranca) ? cobranca : null,
      condicoes: temAlgumaCondicao(condicoes) ? condicoes : null,
    };
    // O servidor sempre exige motivo não-vazio (histórico é requisito não-opcional);
    // quando o campo não é exibido (1ª configuração), manda um motivo padrão em vez de ''.
    void onSubmit(payload, exigeMotivo ? motivo : 'Configuração inicial do médico');
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
              Escolha a empresa que emitirá os boletos deste médico.
            </p>
          )}
        </Field>

        <Field label="Modo de cobrança">
          <select
            name="modoCobranca"
            value={form.modoCobranca}
            onChange={(e) => set('modoCobranca', e.target.value as FormState['modoCobranca'])}
            className="input"
          >
            <option value="faixa_guias">Tabela de faixas (padrão)</option>
            <option value="percentual_producao">Percentual da produção (auxiliar)</option>
            <option value="preco_proprio">Preço próprio (fora de faixa)</option>
          </select>
        </Field>

        {form.modoCobranca === 'percentual_producao' && (
          <Field label="Percentual da produção (%)">
            <input
              name="percentualProducao"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={form.percentualProducao ?? ''}
              onChange={(e) =>
                set('percentualProducao', e.target.value === '' ? null : Number(e.target.value))
              }
              className="input tabular"
              placeholder="5.00"
              aria-invalid={!percentualOk}
            />
            {!percentualOk && (
              <p className="mt-1 text-xs text-cc-danger" role="alert">
                Informe um percentual maior que zero.
              </p>
            )}
          </Field>
        )}
      </div>

      {form.modoCobranca === 'preco_proprio' && (
        <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4 space-y-4">
          <p className="text-sm font-semibold text-cc-ink">Regra de preço própria</p>

          <Field label="Forma da regra">
            <select
              value={form.regraPreco?.forma ?? 'por_guia'}
              onChange={(e) => setRegra('forma', e.target.value as RegraPrecoForma)}
              className="input"
            >
              <option value="por_guia">Por guia linear (ex.: Dr. Ezequiel)</option>
              <option value="base_excedente">Base + excedente com limiar (ex.: Dr. Jansen)</option>
              <option value="fixo">Valor fixo mensal (ex.: Nelson, Carlos Batista, Jefferson)</option>
            </select>
          </Field>

          {(form.regraPreco?.forma ?? 'por_guia') === 'por_guia' ? (
            <Field label="Taxa por guia (R$)">
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.regraPreco?.taxa ?? ''}
                onChange={(e) => setRegraNum('taxa', e.target.value)}
                className="input tabular"
                placeholder="4.00"
              />
            </Field>
          ) : form.regraPreco?.forma === 'base_excedente' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Base (R$)">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.regraPreco?.base ?? ''}
                  onChange={(e) => setRegraNum('base', e.target.value)}
                  className="input tabular"
                  placeholder="935.62"
                />
              </Field>
              <Field label="Limiar (guias)">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.regraPreco?.limiar ?? ''}
                  onChange={(e) => setRegraNum('limiar', e.target.value)}
                  className="input tabular"
                  placeholder="144"
                />
              </Field>
              <Field label="Taxa por guia excedente (R$)">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.regraPreco?.taxa ?? ''}
                  onChange={(e) => setRegraNum('taxa', e.target.value)}
                  className="input tabular"
                  placeholder="6.50"
                />
              </Field>
            </div>
          ) : (
            <Field label="Valor fixo mensal (R$)">
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.regraPreco?.valorFixo ?? ''}
                onChange={(e) => setRegraNum('valorFixo', e.target.value)}
                className="input tabular"
                placeholder="591.22"
              />
            </Field>
          )}

          {!regraPrecoOk && (
            <p className="text-xs text-cc-danger" role="alert">
              Preencha todos os campos da regra de preço própria.
            </p>
          )}
        </div>
      )}

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

            <Field label="E-mail" optional>
              <input type="email" value={cobranca.email} onChange={(e) => setCob('email', e.target.value)} className="input" placeholder="pagador@exemplo.com" />
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
            Preencha todos os campos obrigatórios para habilitar a emissão de boleto deste médico.
            O endereço é preenchido automaticamente pelo CEP.
          </p>
        </div>
      </details>

      {/* Condições comerciais individuais (override do padrão global de Configurações) */}
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
              <input
                type="number"
                min={0}
                max={365}
                value={condicoes.diasVencimento ?? ''}
                onChange={(e) => setCond('diasVencimento', e.target.value)}
                className="input"
                placeholder="Padrão global"
              />
            </Field>

            <Field label="Multa (%)" optional>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={condicoes.multaPercent ?? ''}
                onChange={(e) => setCond('multaPercent', e.target.value)}
                className="input"
                placeholder="Padrão global"
              />
            </Field>

            <Field label="Juros ao mês (%)" optional>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={condicoes.jurosMesPercent ?? ''}
                onChange={(e) => setCond('jurosMesPercent', e.target.value)}
                className="input"
                placeholder="Padrão global"
              />
            </Field>

            <Field label="Desconto (%)" optional>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={condicoes.descontoPercent ?? ''}
                onChange={(e) => setCond('descontoPercent', e.target.value)}
                className="input"
                placeholder="Padrão global"
              />
            </Field>

            <Field label="Desconto até (dias)" optional>
              <input
                type="number"
                min={0}
                max={365}
                value={condicoes.descontoDias ?? ''}
                onChange={(e) => setCond('descontoDias', e.target.value)}
                className="input"
                placeholder="Padrão global"
              />
            </Field>
          </div>
          <p className="text-2xs text-cc-muted">
            Deixe em branco para herdar o padrão de Configurações. Preencha apenas o que este
            médico tem de diferente — ex.: vencimento em 45 dias em vez do padrão.
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

'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigCobranca } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import { configCobrancaService, configCobrancaQueryKeys } from '@/services/config-cobranca';
import { useToast } from '@/components/ui/Toast';

const VAZIO: ConfigCobranca = {
  diasVencimento: 30,
  multaPercent: null,
  jurosMesPercent: null,
  descontoPercent: null,
  descontoDias: null,
};

/** Formulário dos defaults comerciais globais (config_cobranca). */
export function ConfigCobrancaForm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ConfigCobranca>(VAZIO);

  const { data, isLoading } = useQuery({
    queryKey: configCobrancaQueryKeys.config(),
    queryFn: () => configCobrancaService.ler(),
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const salvar = useMutation({
    mutationFn: (c: ConfigCobranca) => configCobrancaService.atualizar(c),
    onSuccess: (c) => {
      qc.setQueryData(configCobrancaQueryKeys.config(), c);
      toast('Configurações de cobrança salvas', 'success');
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao salvar', 'error'),
  });

  function setNum(campo: keyof ConfigCobranca, valor: string, obrigatorio = false) {
    const n = valor === '' ? (obrigatorio ? 0 : null) : Number(valor);
    setForm((f) => ({ ...f, [campo]: n }));
  }

  if (isLoading) {
    return <div className="card p-8 text-center text-sm text-cc-muted">Carregando…</div>;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate(form);
      }}
      className="card max-w-lg space-y-4 p-6"
    >
      <p className="text-sm text-cc-ink-2">
        Valores padrão aplicados na emissão de boletos. Cada médico pode sobrescrever individualmente.
      </p>

      <Campo label="Dias para vencimento" hint="Ex.: 30">
        <input
          type="number"
          min={0}
          max={365}
          value={form.diasVencimento}
          onChange={(e) => setNum('diasVencimento', e.target.value, true)}
          className="input font-mono"
        />
      </Campo>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo label="Multa (%)" optional>
          <input type="number" min={0} max={100} step="0.01" value={form.multaPercent ?? ''}
            onChange={(e) => setNum('multaPercent', e.target.value)} className="input font-mono" placeholder="—" />
        </Campo>
        <Campo label="Juros ao mês (%)" optional>
          <input type="number" min={0} max={100} step="0.01" value={form.jurosMesPercent ?? ''}
            onChange={(e) => setNum('jurosMesPercent', e.target.value)} className="input font-mono" placeholder="—" />
        </Campo>
        <Campo label="Desconto (%)" optional>
          <input type="number" min={0} max={100} step="0.01" value={form.descontoPercent ?? ''}
            onChange={(e) => setNum('descontoPercent', e.target.value)} className="input font-mono" placeholder="—" />
        </Campo>
        <Campo label="Desconto até (dias)" optional>
          <input type="number" min={0} max={365} value={form.descontoDias ?? ''}
            onChange={(e) => setNum('descontoDias', e.target.value)} className="input font-mono" placeholder="—" />
        </Campo>
      </div>

      <button type="submit" disabled={salvar.isPending} className="btn-primary">
        {salvar.isPending ? 'Salvando…' : 'Salvar configurações'}
      </button>
    </form>
  );
}

function Campo({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
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
      {hint && <span className="mt-1 block text-2xs text-cc-muted">{hint}</span>}
    </label>
  );
}

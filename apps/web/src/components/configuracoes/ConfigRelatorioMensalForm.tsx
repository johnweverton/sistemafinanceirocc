'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigRelatorioMensal } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import { configRelatorioMensalService, configRelatorioMensalQueryKeys } from '@/services/config-relatorio-mensal';
import { useToast } from '@/components/ui/Toast';

const VAZIO: ConfigRelatorioMensal = { emails: '', diaEnvio: 1, habilitado: false };

/** Formulário do relatório mensal automático por e-mail (config_relatorio_mensal). */
export function ConfigRelatorioMensalForm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ConfigRelatorioMensal>(VAZIO);

  const { data, isLoading } = useQuery({
    queryKey: configRelatorioMensalQueryKeys.config(),
    queryFn: () => configRelatorioMensalService.ler(),
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const salvar = useMutation({
    mutationFn: (c: ConfigRelatorioMensal) => configRelatorioMensalService.atualizar(c),
    onSuccess: (c) => {
      qc.setQueryData(configRelatorioMensalQueryKeys.config(), c);
      toast('Configuração do relatório mensal salva', 'success');
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao salvar', 'error'),
  });

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
        Envia por e-mail, automaticamente, o PDF do fechamento do mês anterior — para a CEO acompanhar sem
        precisar abrir o sistema.
      </p>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={form.habilitado}
          onChange={(e) => setForm((f) => ({ ...f, habilitado: e.target.checked }))}
          className="h-4 w-4 rounded border-cc-hairline accent-cc-accent"
        />
        <span className="field-label">Envio automático habilitado</span>
      </label>

      <Campo label="Destinatários" hint="E-mails separados por vírgula (ex.: a CEO e o financeiro)">
        <input
          type="text"
          value={form.emails}
          onChange={(e) => setForm((f) => ({ ...f, emails: e.target.value }))}
          placeholder="ceo@empresa.com, financeiro@empresa.com"
          className="input"
        />
      </Campo>

      <Campo label="Dia do envio" hint="Dia do mês (1 a 28) em que o relatório é disparado">
        <input
          type="number"
          min={1}
          max={28}
          value={form.diaEnvio}
          onChange={(e) => setForm((f) => ({ ...f, diaEnvio: Number(e.target.value) }))}
          className="input font-mono"
        />
      </Campo>

      <button type="submit" disabled={salvar.isPending} className="btn-primary">
        {salvar.isPending ? 'Salvando…' : 'Salvar configurações'}
      </button>
    </form>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-cc-muted">{hint}</span>}
    </label>
  );
}

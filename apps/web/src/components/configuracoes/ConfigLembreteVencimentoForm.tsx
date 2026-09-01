'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigLembreteVencimento } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import { configLembreteVencimentoService, configLembreteVencimentoQueryKeys } from '@/services/config-lembrete-vencimento';
import { useToast } from '@/components/ui/Toast';

const VAZIO: ConfigLembreteVencimento = { habilitado: false };

/** Formulário do lembrete automático de vencimento D-1 (config_lembrete_vencimento, Épico 13). */
export function ConfigLembreteVencimentoForm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ConfigLembreteVencimento>(VAZIO);

  const { data, isLoading } = useQuery({
    queryKey: configLembreteVencimentoQueryKeys.config(),
    queryFn: () => configLembreteVencimentoService.ler(),
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const salvar = useMutation({
    mutationFn: (c: ConfigLembreteVencimento) => configLembreteVencimentoService.atualizar(c),
    onSuccess: (c) => {
      qc.setQueryData(configLembreteVencimentoQueryKeys.config(), c);
      toast('Configuração do lembrete de vencimento salva', 'success');
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
        Envia automaticamente um lembrete por WhatsApp/e-mail 1 dia antes do vencimento de
        qualquer boleto em aberto (cobrança médica e contabilidade) — sem precisar avisar
        manualmente cada pagador.
      </p>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={form.habilitado}
          onChange={(e) => setForm({ habilitado: e.target.checked })}
          className="h-4 w-4 rounded border-cc-hairline accent-cc-accent"
        />
        <span className="field-label">Lembrete automático habilitado</span>
      </label>

      <button type="submit" disabled={salvar.isPending} className="btn-primary">
        {salvar.isPending ? 'Salvando…' : 'Salvar configurações'}
      </button>
    </form>
  );
}

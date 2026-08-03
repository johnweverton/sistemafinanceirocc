'use client';
// Degradação por conta espelhando o GET /api/contas/saldo: conta sem credenciais →
// "não configurada"; consulta falhou → "indisponível"; NUNCA quebra o dashboard.
import { useQuery } from '@tanstack/react-query';
import { contasService, contasQueryKeys } from '@/services/contas';
import { Skeleton } from '@/components/ui/Skeleton';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function SaldoEmpresas() {
  const { data, isLoading, isError } = useQuery({
    queryKey: contasQueryKeys.saldos(),
    queryFn: () => contasService.saldos(),
    // A rota já cacheia 60s por conta; o staleTime evita refetch a cada foco de janela.
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  // Falha geral (rede/auth): dashboard segue funcionando sem os cards.
  if (isError || !data || data.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {data.map((s) => (
        <div key={s.conta} className="card p-4">
          <p className="font-mono text-2xs uppercase tracking-wider text-cc-muted">
            Saldo em conta · {s.nome}
          </p>
          {!s.configurada ? (
            <p className="mt-1 text-sm text-cc-muted">
              Conta não configurada. O saldo aparece aqui quando a integração bancária for
              ativada.
            </p>
          ) : s.saldo ? (
            <>
              <p
                className={`mt-1 tabular text-lg font-semibold ${
                  s.saldo.disponivel < 0 ? 'text-cc-danger' : 'text-cc-ink'
                }`}
              >
                {brl(s.saldo.disponivel)}
              </p>
              {s.saldo.disponivel < 0 && (
                <p className="mt-1 text-xs font-medium text-cc-danger" role="alert">
                  Saldo negativo: verificar lançamentos
                </p>
              )}
              <p className="text-2xs text-cc-muted">
                {s.saldo.bloqueado != null && s.saldo.bloqueado > 0
                  ? `Bloqueado: ${brl(s.saldo.bloqueado)} · `
                  : ''}
                consultado às {hora(s.saldo.consultadoEm)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-cc-warning" role="alert">
              Saldo indisponível no momento. Tente novamente em instantes.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

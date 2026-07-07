'use client';
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { execucoesService, execucaoQueryKeys, type ExecucaoSelecaoPayload } from '@/services/execucoes';
import { ProgressoExecucao } from './ProgressoExecucao';
import { RelatorioGrupos } from './RelatorioGrupos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';
import { useToast } from '@/components/ui/Toast';

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function NovaExecucao() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState('');
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  
  // Custom manual selections
  const [manualSelections, setManualSelections] = useState<Record<string, string>>({});

  const { data: apoio, isLoading: isApoioLoading } = useQuery({
    queryKey: execucaoQueryKeys.apoio(),
    queryFn: execucoesService.apoio,
  });

  const { medicos, producoes } = useMemo(() => {
    if (!apoio) return { medicos: [], producoes: [] };
    const prods = apoio.clientesOrigem.flatMap(c => 
      c.producoes.map(p => ({ ...p, clienteId: c.id, clienteNome: c.nome }))
    );
    return { medicos: apoio.medicos, producoes: prods };
  }, [apoio]);

  // Derived selections
  const selecoesInfo = useMemo(() => {
    const validMedicos = medicos.filter(m => m.ativo && !m.necessitaConfiguracao && m.externalId);
    const invalidMedicos = medicos.filter(m => !m.ativo || m.necessitaConfiguracao || !m.externalId);

    const matched: Array<{ medico: any; producao: any }> = [];
    const unmatched: Array<{ medico: any; producoesDisponiveis: any[] }> = [];
    const finalPayload: ExecucaoSelecaoPayload[] = [];

    const mesesNfd = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const compValida = /^\d{4}-\d{2}$/.test(competencia);
    const split = compValida ? competencia.split('-') : ['', ''];
    const ano = split[0] || '';
    const mes = split[1] || '';
    const mesIndex = compValida ? parseInt(mes, 10) - 1 : -1;
    const mesNome = mesIndex >= 0 ? (mesesNfd[mesIndex] || '') : '';

    for (const med of validMedicos) {
      const producoesDoMedico = producoes.filter(p => p.clienteId === med.externalId);
      const manualProdId = manualSelections[med.id];
      
      if (manualProdId === 'IGNORE') {
        unmatched.push({ medico: med, producoesDisponiveis: producoesDoMedico });
        continue;
      }

      let match = producoesDoMedico.find(p => p.id === manualProdId);
      
      // Auto-match
      if (!match && compValida) {
        match = producoesDoMedico.find(p => {
          const norm = normalizeName(p.nome);
          const hasData = norm.includes(`${ano}-${mes}`) || norm.includes(`${mes}/${ano}`) || norm.includes(`${mes}-${ano}`);
          const hasExtenso = norm.includes(mesNome) && norm.includes(ano);
          return hasData || hasExtenso;
        });
      }

      if (match) {
        matched.push({ medico: med, producao: match });
        finalPayload.push({
          medicoId: med.id,
          producaoExternaId: match.id,
          producaoNome: match.nome,
        });
      } else {
        unmatched.push({ medico: med, producoesDisponiveis: producoesDoMedico });
      }
    }

    return { matched, unmatched, invalidMedicos, finalPayload };
  }, [medicos, producoes, manualSelections, competencia]);

  const disparar = useMutation({
    mutationFn: (c: string) => execucoesService.disparar(c, selecoesInfo.finalPayload),
    onSuccess: ({ execucaoId }) => {
      setExecucaoId(execucaoId);
      setErro(null);
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucoes() });
      toast('Execução iniciada — acompanhe o progresso', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao disparar execução';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  if (execucaoId) {
    return <Acompanhamento execucaoId={execucaoId} onNova={() => setExecucaoId(null)} />;
  }

  const competenciaValida = /^\d{4}-\d{2}$/.test(competencia);
  const canDisparar = competenciaValida && selecoesInfo.finalPayload.length > 0 && !disparar.isPending;

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Nova execução</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canDisparar) disparar.mutate(competencia);
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="competencia" className="field-label mb-1.5">
                  Competência
                </label>
                <input
                  id="competencia"
                  name="competencia"
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                  placeholder="2026-06"
                  className="input font-mono"
                  maxLength={7}
                />
                <p className="mt-1.5 text-xs text-cc-muted">Formato: AAAA-MM (Ex: 2026-05)</p>
              </div>

              {erro && <p role="alert" className="alert-error">{erro}</p>}

              <button
                type="submit"
                disabled={!canDisparar}
                className="btn-primary w-full py-2.5"
              >
                {disparar.isPending ? 'Disparando...' : `Processar ${selecoesInfo.finalPayload.length} médicos`}
              </button>
            </form>
          </div>
          
          {!isApoioLoading && selecoesInfo.invalidMedicos.length > 0 && (
            <div className="card p-4 border-amber-200 bg-amber-50/50">
              <h3 className="font-medium text-amber-800 text-sm mb-2">
                Fora da Execução ({selecoesInfo.invalidMedicos.length})
              </h3>
              <p className="text-xs text-amber-700 mb-3">
                Completar cadastro ou vínculo destes médicos para poder executá-los.
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {selecoesInfo.invalidMedicos.map(m => (
                  <div key={m.id} className="text-xs text-amber-900 bg-amber-100/50 p-1.5 rounded flex justify-between items-center">
                    <span className="truncate mr-2">{m.nome}</span>
                    <span className="shrink-0 opacity-75">
                      {!m.ativo ? 'Inativo' : m.necessitaConfiguracao ? 'Pend. Config' : 'Sem Vínculo'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">Seleção de Médicos</h2>
            {isApoioLoading ? (
              <p className="text-cc-muted">Carregando dados de apoio...</p>
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="font-medium text-cc-ink mb-2">
                    ✅ Prontos para processar ({selecoesInfo.matched.length})
                  </h3>
                  {selecoesInfo.matched.length === 0 ? (
                    <p className="text-sm text-cc-muted italic">Nenhum médico pareado para esta competência.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                      {selecoesInfo.matched.map(({ medico, producao }) => (
                        <div key={medico.id} className="flex justify-between items-center text-sm p-2 bg-cc-surface rounded border border-cc-border">
                          <span className="font-medium">{medico.nome}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-cc-muted text-xs bg-cc-border/30 px-2 py-0.5 rounded truncate max-w-[200px]">
                              {producao.nome}
                            </span>
                            <button 
                              onClick={() => setManualSelections(prev => ({ ...prev, [medico.id]: 'IGNORE' }))}
                              className="text-red-500 hover:text-red-700 p-1"
                              title="Remover desta execução"
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selecoesInfo.unmatched.length > 0 && (
                  <div className="pt-4 border-t border-cc-border">
                    <h3 className="font-medium text-amber-600 mb-2">
                      ⚠️ Vínculo manual pendente ({selecoesInfo.unmatched.length})
                    </h3>
                    <p className="text-xs text-cc-muted mb-3">Estes médicos possuem vínculo com a origem, mas nenhuma produção correspondente foi auto-identificada.</p>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                      {selecoesInfo.unmatched.map(({ medico, producoesDisponiveis }) => (
                        <div key={medico.id} className="flex flex-col gap-2 p-2 bg-amber-50 rounded border border-amber-200">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-sm text-amber-900">{medico.nome}</span>
                          </div>
                          <select
                            className="input text-xs py-1 h-auto"
                            value={manualSelections[medico.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setManualSelections(prev => ({ ...prev, [medico.id]: val }));
                            }}
                          >
                            <option value="">-- Vincular manualmente --</option>
                            {producoesDisponiveis.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Acompanhamento({ execucaoId, onNova }: { execucaoId: string; onNova: () => void }) {
  const { execucao } = useExecucaoRealtime(execucaoId);
  const concluido = execucao?.status === 'concluido';

  return (
    <section className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Execução em andamento</h1>
          {execucao?.competencia && (
            <p className="mt-0.5 text-sm text-cc-ink-2 tabular font-mono">{execucao.competencia}</p>
          )}
        </div>
        <button onClick={onNova} className="btn-ghost btn btn-sm">
          Nova execução
        </button>
      </div>
      <ProgressoExecucao execucaoId={execucaoId} />
      {concluido && <RelatorioGrupos execucaoId={execucaoId} />}
    </section>
  );
}

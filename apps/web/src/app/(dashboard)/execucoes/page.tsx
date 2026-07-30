'use client';
import { useState } from 'react';
import Link from 'next/link';
import { HistoricoExecucoes } from '@/components/execucoes/HistoricoExecucoes';
import { HistoricoExecucoesPorMedico } from '@/components/execucoes/HistoricoExecucoesPorMedico';

type Modo = 'competencia' | 'medico';

export default function ExecucoesPage() {
  const [modo, setModo] = useState<Modo>('competencia');

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Emissão</h1>
        <Link href="/execucoes/nova" className="btn-primary btn-sm btn">
          Nova emissão
        </Link>
      </div>

      <div className="inline-flex rounded-lg border border-cc-hairline bg-cc-surface-2 p-1">
        <button
          type="button"
          onClick={() => setModo('competencia')}
          className={`btn btn-sm ${modo === 'competencia' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Por competência
        </button>
        <button
          type="button"
          onClick={() => setModo('medico')}
          className={`btn btn-sm ${modo === 'medico' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Por médico
        </button>
      </div>

      {modo === 'competencia' ? <HistoricoExecucoes /> : <HistoricoExecucoesPorMedico />}
    </section>
  );
}

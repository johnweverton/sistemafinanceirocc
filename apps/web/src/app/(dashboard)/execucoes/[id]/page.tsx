import Link from 'next/link';
import { ProgressoExecucao } from '@/components/execucoes/ProgressoExecucao';
import { RelatorioGrupos } from '@/components/execucoes/RelatorioGrupos';

// Reabre o relatório de qualquer execução (PRD §8.5). O estado já está persistido no banco.
export default function ExecucaoPage({ params }: { params: { id: string } }) {
  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Relatório da emissão</h1>
        <Link href="/execucoes" className="link-action">
          ← Voltar
        </Link>
      </div>
      <ProgressoExecucao execucaoId={params.id} />
      <RelatorioGrupos execucaoId={params.id} />
    </section>
  );
}

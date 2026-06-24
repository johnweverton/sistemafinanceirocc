import Link from 'next/link';
import { ProgressoExecucao } from '@/components/execucoes/ProgressoExecucao';
import { RelatorioGrupos } from '@/components/execucoes/RelatorioGrupos';

// Reabre o relatório de qualquer execução (PRD §8.5). O estado já está persistido no banco.
export default function ExecucaoPage({ params }: { params: { id: string } }) {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Relatório da execução</h1>
        <Link href="/execucoes" className="text-sm text-gray-600 underline">
          Voltar
        </Link>
      </div>
      <ProgressoExecucao execucaoId={params.id} />
      <RelatorioGrupos execucaoId={params.id} />
    </section>
  );
}

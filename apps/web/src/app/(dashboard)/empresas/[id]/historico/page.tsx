import Link from 'next/link';
import { HistoricoTimeline } from '@/components/empresas/HistoricoTimeline';

export default function HistoricoPage({ params }: { params: { id: string } }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Histórico de alterações</h1>
        <Link href="/empresas" className="text-sm text-gray-600 underline">
          Voltar
        </Link>
      </div>
      <HistoricoTimeline empresaId={params.id} />
    </section>
  );
}

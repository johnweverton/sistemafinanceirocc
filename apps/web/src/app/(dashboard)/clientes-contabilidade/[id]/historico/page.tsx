import Link from 'next/link';
import { HistoricoTimeline } from '@/components/clientes-contabilidade/HistoricoTimeline';

export default function HistoricoPage({ params }: { params: { id: string } }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Histórico de alterações</h1>
        <Link href="/clientes-contabilidade" className="text-sm text-gray-600 underline">
          Voltar
        </Link>
      </div>
      <HistoricoTimeline clienteId={params.id} />
    </section>
  );
}

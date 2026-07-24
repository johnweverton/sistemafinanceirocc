import { GerarExecucao } from '@/components/clientes-contabilidade/GerarExecucao';

export default function ExecucaoPage({ params }: { params: { id: string } }) {
  return <GerarExecucao clienteId={params.id} />;
}

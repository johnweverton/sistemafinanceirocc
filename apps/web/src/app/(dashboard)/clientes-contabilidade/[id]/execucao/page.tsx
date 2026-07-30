import { EmissaoCliente } from '@/components/clientes-contabilidade/EmissaoCliente';

export default function ExecucaoPage({ params }: { params: { id: string } }) {
  return <EmissaoCliente clienteId={params.id} />;
}

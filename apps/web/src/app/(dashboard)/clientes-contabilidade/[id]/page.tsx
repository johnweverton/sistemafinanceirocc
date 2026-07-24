import { DetalheCliente } from '@/components/clientes-contabilidade/DetalheCliente';

export default function DetalheClientePage({ params }: { params: { id: string } }) {
  return <DetalheCliente clienteId={params.id} />;
}

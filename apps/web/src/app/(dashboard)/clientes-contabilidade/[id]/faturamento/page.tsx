import { LancamentoFaturamento } from '@/components/clientes-contabilidade/LancamentoFaturamento';

export default function FaturamentoPage({ params }: { params: { id: string } }) {
  return <LancamentoFaturamento clienteId={params.id} />;
}

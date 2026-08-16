import { RelatorioPublicoManager } from '@/components/relatorios/RelatorioPublicoManager';

export default function RelatorioPublicoPage({ params }: { params: { token: string } }) {
  return <RelatorioPublicoManager token={params.token} />;
}

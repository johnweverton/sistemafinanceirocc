import Link from 'next/link';
import { HistoricoExecucoes } from '@/components/execucoes/HistoricoExecucoes';

// Histórico separado da tela de emitir (reorganização UX 2026-09-30): o menu "Emitir boletos" leva
// direto para /emissao e o histórico vive aqui. A visão "Por médico" saiu (pouco usada, decisão do
// dono) — o histórico de uma pessoa sai pela busca por nome ou pela ficha do médico.
export default function HistoricoEmissoesPage() {
  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Histórico de emissões</h1>
        <Link href="/emissao" className="btn-primary btn-sm btn">
          Emitir boletos
        </Link>
      </div>
      <HistoricoExecucoes />
    </section>
  );
}

import { ConfigCobrancaForm } from '@/components/configuracoes/ConfigCobrancaForm';

export default function ConfiguracoesPage() {
  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Configurações de cobrança</h1>
      </div>
      <ConfigCobrancaForm />
    </section>
  );
}

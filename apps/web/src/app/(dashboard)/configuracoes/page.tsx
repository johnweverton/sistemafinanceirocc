import { ConfigCobrancaForm } from '@/components/configuracoes/ConfigCobrancaForm';
import { ConfigRelatorioMensalForm } from '@/components/configuracoes/ConfigRelatorioMensalForm';

export default function ConfiguracoesPage() {
  return (
    <section className="space-y-8">
      <div>
        <div className="page-header">
          <h1 className="page-title">Configurações de cobrança</h1>
        </div>
        <ConfigCobrancaForm />
      </div>

      <div>
        <div className="page-header">
          <h1 className="page-title">Relatório mensal automático</h1>
        </div>
        <ConfigRelatorioMensalForm />
      </div>
    </section>
  );
}

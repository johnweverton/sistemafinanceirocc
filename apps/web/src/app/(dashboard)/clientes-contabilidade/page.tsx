import { Suspense } from 'react';
import { ClientesContabilidadeManager } from '@/components/clientes-contabilidade/ClientesContabilidadeManager';

// Story 13.4 (AC 12): o Manager lê `?lote=AAAA-MM` com `useSearchParams`, que no Next 14 exige
// um limite de Suspense para a página continuar pré-renderizável no build.
export default function ClientesContabilidadePage() {
  return (
    <Suspense fallback={null}>
      <ClientesContabilidadeManager />
    </Suspense>
  );
}

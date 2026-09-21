// Teste de componente — DisparoBadges (Épico 13): confirma que emissão e lembrete de vencimento
// do MESMO canal coexistem como badges separadas em vez de uma sobrescrever a outra (chave de
// agrupamento `canal:tipo`, não só `canal`).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DisparoBoleto } from '@cobranca/shared';
import { DisparoBadges } from '../../src/components/boletos/DisparoBadges';

function disparo(overrides: Partial<DisparoBoleto>): DisparoBoleto {
  return {
    canal: 'whatsapp',
    status: 'sucesso',
    mensagemErro: null,
    enviadoEm: '2026-09-01T12:00:00Z',
    tipo: 'emissao',
    ...overrides,
  };
}

describe('DisparoBadges', () => {
  it('sem disparos não renderiza nada', () => {
    const { container } = render(<DisparoBadges disparos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('emissão e lembrete de vencimento do mesmo canal coexistem como badges separadas', () => {
    render(
      <DisparoBadges
        disparos={[
          disparo({ canal: 'whatsapp', tipo: 'emissao', enviadoEm: '2026-08-01T10:00:00Z' }),
          disparo({ canal: 'whatsapp', tipo: 'lembrete_vencimento', enviadoEm: '2026-09-01T10:00:00Z' }),
        ]}
      />,
    );
    // Duas badges de WhatsApp (uma por tipo) — se a chave de agrupamento fosse só `canal`, a
    // segunda (lembrete) teria sobrescrito a primeira (emissão) e sobraria só uma.
    expect(screen.getAllByLabelText(/WhatsApp/)).toHaveLength(2);
    expect(screen.getByLabelText(/WhatsApp · enviado em/)).toBeInTheDocument();
    expect(screen.getByLabelText(/WhatsApp · Lembrete · enviado em/)).toBeInTheDocument();
  });

  it('mostra sempre o disparo mais recente de cada (canal, tipo)', () => {
    render(
      <DisparoBadges
        disparos={[
          disparo({ canal: 'email', tipo: 'emissao', status: 'falha', mensagemErro: 'SMTP fora do ar', enviadoEm: '2026-08-01T10:00:00Z' }),
          disparo({ canal: 'email', tipo: 'emissao', status: 'sucesso', enviadoEm: '2026-08-01T10:05:00Z' }),
        ]}
      />,
    );
    expect(screen.getAllByLabelText(/E-mail/)).toHaveLength(1);
    expect(screen.getByLabelText(/E-mail · enviado em/)).toBeInTheDocument();
  });
});

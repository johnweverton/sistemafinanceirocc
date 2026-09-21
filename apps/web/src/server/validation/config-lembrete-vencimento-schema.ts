// Validação Zod de config_lembrete_vencimento — toggle do lembrete automático de vencimento D-1
// (Épico 13), editável em Configurações.
import { z } from 'zod';

export const configLembreteVencimentoSchema = z.object({
  habilitado: z.boolean(),
});

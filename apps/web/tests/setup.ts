import '@testing-library/jest-dom/vitest';

// Variáveis de ambiente dummy para os testes: lib/env.ts valida publicEnv no import.
// Os testes de orchestrator/repository injetam deps ou mockam o client, então estes
// valores nunca são usados para falar com serviços reais — só satisfazem a validação Zod.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';

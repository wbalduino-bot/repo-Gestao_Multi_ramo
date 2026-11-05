
import { fileURLToPath } from 'node:url';
import { config as carregarVariaveis } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Carrega somente as variáveis do ambiente exclusivo dos testes E2E.
carregarVariaveis({
  path: fileURLToPath(new URL('./.env.e2e', import.meta.url)),
  override: true,
});

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',

    // Executa somente a suíte E2E oficial.
    // Evita que cópias em outras pastas sejam descobertas.
    include: ['test/**/*.e2e-spec.ts'],
  },
});

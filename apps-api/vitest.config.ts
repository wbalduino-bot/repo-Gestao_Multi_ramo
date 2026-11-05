import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Mantém as exclusões padrão e impede que cópias de segurança sejam executadas como testes.
    exclude: [
      ...configDefaults.exclude,
      // Ignora qualquer diretório de backup criado durante o desenvolvimento.
      '**/.backup-*/**',
      // Ignora também cópias de testes guardadas em pastas de backup.
      '**/backup-*/**',
    ],
  },
});

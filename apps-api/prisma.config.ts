
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Configurações utilizadas pelo Prisma CLI.
export default defineConfig({
  // Caminho do schema que define os modelos, enums e relacionamentos.
  schema: "prisma/schema.prisma",

  // Configuração de conexão com o PostgreSQL.
  datasource: {
    // Banco principal da aplicação Gestão Comercial.
    // A URL é lida da variável DATABASE_URL no arquivo .env.
    url: env("DATABASE_URL"),
  },

  // Ferramentas de desenvolvimento utilizadas pelo projeto.
  skills: {
    agents: ["claude", "cursor", "agents", "devin"],
  },
});

-- Fechamento comercial, distinto de conciliacao bancária e reembolso real.
-- O relatorio salvo e uma fotografia imutavel; a data usa calendario local da empresa.
CREATE TABLE "FechamentoCaixa" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "dataOperacional" DATE NOT NULL,
    "fusoHorario" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "resumo" JSONB NOT NULL,
    "observacao" VARCHAR(500),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FechamentoCaixa_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FechamentoCaixa_empresaId_dataOperacional_key"
ON "FechamentoCaixa"("empresaId", "dataOperacional");
CREATE INDEX "FechamentoCaixa_usuarioId_criadoEm_idx"
ON "FechamentoCaixa"("usuarioId", "criadoEm");
ALTER TABLE "FechamentoCaixa"
  ADD CONSTRAINT "FechamentoCaixa_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FechamentoCaixa"
  ADD CONSTRAINT "FechamentoCaixa_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FechamentoCaixa"
  ADD CONSTRAINT "FechamentoCaixa_resumo_object_chk"
  CHECK (jsonb_typeof("resumo") = 'object');

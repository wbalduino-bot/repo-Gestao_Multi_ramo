BEGIN;

CREATE TYPE "StatusArquivoNotaCompra" AS ENUM (
    'PENDENTE', 'AGUARDANDO_CONFERENCIA', 'PROCESSADO', 'FALHA'
);

CREATE TABLE "ArquivoNotaCompra" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "status" "StatusArquivoNotaCompra" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArquivoNotaCompra_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ArquivoNotaCompra_empresaId_fkey"
        FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ArquivoNotaCompra_empresaId_sha256_key"
    ON "ArquivoNotaCompra"("empresaId", "sha256");

CREATE INDEX "ArquivoNotaCompra_empresaId_status_criadoEm_idx"
    ON "ArquivoNotaCompra"("empresaId", "status", "criadoEm");

COMMIT;

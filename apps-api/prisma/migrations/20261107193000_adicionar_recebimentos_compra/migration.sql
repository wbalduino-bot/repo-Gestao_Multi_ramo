BEGIN;

-- CreateEnum
CREATE TYPE "OrigemRecebimentoCompra" AS ENUM ('MANUAL', 'AGENTE_GC');

-- CreateEnum
CREATE TYPE "StatusRecebimentoCompra" AS ENUM ('RASCUNHO', 'AGUARDANDO_CONFERENCIA', 'INCLUIDO');

-- CreateTable
CREATE TABLE "RecebimentoCompra" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "origem" "OrigemRecebimentoCompra" NOT NULL,
    "status" "StatusRecebimentoCompra" NOT NULL DEFAULT 'RASCUNHO',
    "fornecedorNome" TEXT,
    "fornecedorCnpj" TEXT,
    "numeroNota" TEXT,
    "serieNota" TEXT,
    "chaveNfe" TEXT,
    "emitidaEm" DATE,
    "compradaEm" DATE,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incluidoEm" TIMESTAMP(3),
    "incluidoPorOrigem" "OrigemRecebimentoCompra",
    "incluidoPorUsuarioId" UUID,
    "incluidoPorNome" TEXT,

    CONSTRAINT "RecebimentoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRecebimentoCompra" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "recebimentoId" UUID NOT NULL,
    "produtoId" UUID,
    "movimentacaoId" UUID,
    "descricaoNota" TEXT NOT NULL,
    "quantidadeRecebida" DECIMAL(14,3),
    "codigoLote" TEXT,
    "validadeEm" DATE,

    CONSTRAINT "ItemRecebimentoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecebimentoCompra_empresaId_status_criadoEm_idx" ON "RecebimentoCompra"("empresaId", "status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "RecebimentoCompra_empresaId_id_key" ON "RecebimentoCompra"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecebimentoCompra_empresaId_chaveNfe_key" ON "RecebimentoCompra"("empresaId", "chaveNfe");

-- CreateIndex
CREATE UNIQUE INDEX "RecebimentoCompra_empresaId_fornecedorCnpj_serieNota_numero_key" ON "RecebimentoCompra"("empresaId", "fornecedorCnpj", "serieNota", "numeroNota");

-- CreateIndex
CREATE INDEX "ItemRecebimentoCompra_empresaId_recebimentoId_idx" ON "ItemRecebimentoCompra"("empresaId", "recebimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRecebimentoCompra_empresaId_produtoId_movimentacaoId_key" ON "ItemRecebimentoCompra"("empresaId", "produtoId", "movimentacaoId");

-- AddForeignKey
ALTER TABLE "RecebimentoCompra" ADD CONSTRAINT "RecebimentoCompra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRecebimentoCompra" ADD CONSTRAINT "ItemRecebimentoCompra_empresaId_recebimentoId_fkey" FOREIGN KEY ("empresaId", "recebimentoId") REFERENCES "RecebimentoCompra"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRecebimentoCompra" ADD CONSTRAINT "ItemRecebimentoCompra_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRecebimentoCompra" ADD CONSTRAINT "ItemRecebimentoCompra_empresaId_produtoId_movimentacaoId_fkey" FOREIGN KEY ("empresaId", "produtoId", "movimentacaoId") REFERENCES "MovimentacaoEstoque"("empresaId", "produtoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

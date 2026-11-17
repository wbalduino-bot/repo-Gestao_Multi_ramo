-- Identificacao de operacao opcional para preservar vendas historicas.
-- Nao remove nem altera valores de vendas existentes.
BEGIN;
ALTER TABLE "Venda"
  ADD COLUMN "chaveOperacao" UUID,
  ADD COLUMN "hashRequisicao" CHAR(64);
CREATE UNIQUE INDEX "Venda_empresaId_chaveOperacao_key"
  ON "Venda"("empresaId", "chaveOperacao");
COMMIT;

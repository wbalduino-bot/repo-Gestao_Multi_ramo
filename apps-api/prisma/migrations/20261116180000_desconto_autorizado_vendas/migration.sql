-- Amplia vendas sem apagar registros anteriores.
ALTER TABLE "Venda"
  ADD COLUMN "subtotalOriginal" DECIMAL(14,2),
  ADD COLUMN "percentualDesconto" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "valorDesconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "autorizadorDescontoId" UUID;

-- Registros historicos sem desconto conservam o total original.
UPDATE "Venda" SET "subtotalOriginal" = "total";
ALTER TABLE "Venda" ALTER COLUMN "subtotalOriginal" SET NOT NULL;

CREATE INDEX "Venda_autorizadorDescontoId_idx" ON "Venda"("autorizadorDescontoId");
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_autorizadorDescontoId_fkey"
  FOREIGN KEY ("autorizadorDescontoId") REFERENCES "Usuario"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

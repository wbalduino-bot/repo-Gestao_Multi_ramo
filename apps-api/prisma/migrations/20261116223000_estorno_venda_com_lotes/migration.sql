-- Estornos operacionais: nunca remove a venda original.
-- Não há estorno financeiro automático; o valor histórico é registrado à parte.
CREATE TABLE "EstornoVenda" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "vendaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "chaveOperacao" UUID NOT NULL,
    "hashRequisicao" CHAR(64) NOT NULL,
    "justificativa" VARCHAR(500) NOT NULL,
    "totalEstornado" DECIMAL(14,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EstornoVenda_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemEstornoVenda" (
    "id" UUID NOT NULL,
    "estornoId" UUID NOT NULL,
    "itemVendaId" UUID NOT NULL,
    "movimentacaoEstoqueId" UUID NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valorEstornado" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "ItemEstornoVenda_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstornoVenda_empresaId_chaveOperacao_key" ON "EstornoVenda"("empresaId", "chaveOperacao");
CREATE INDEX "EstornoVenda_empresaId_vendaId_criadoEm_idx" ON "EstornoVenda"("empresaId", "vendaId", "criadoEm");
CREATE INDEX "EstornoVenda_usuarioId_criadoEm_idx" ON "EstornoVenda"("usuarioId", "criadoEm");
CREATE UNIQUE INDEX "ItemEstornoVenda_movimentacaoEstoqueId_key" ON "ItemEstornoVenda"("movimentacaoEstoqueId");
CREATE UNIQUE INDEX "ItemEstornoVenda_estornoId_itemVendaId_key" ON "ItemEstornoVenda"("estornoId", "itemVendaId");
CREATE INDEX "ItemEstornoVenda_itemVendaId_idx" ON "ItemEstornoVenda"("itemVendaId");

ALTER TABLE "EstornoVenda" ADD CONSTRAINT "EstornoVenda_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EstornoVenda" ADD CONSTRAINT "EstornoVenda_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EstornoVenda" ADD CONSTRAINT "EstornoVenda_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemEstornoVenda" ADD CONSTRAINT "ItemEstornoVenda_estornoId_fkey" FOREIGN KEY ("estornoId") REFERENCES "EstornoVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemEstornoVenda" ADD CONSTRAINT "ItemEstornoVenda_itemVendaId_fkey" FOREIGN KEY ("itemVendaId") REFERENCES "ItemVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemEstornoVenda" ADD CONSTRAINT "ItemEstornoVenda_movimentacaoEstoqueId_fkey" FOREIGN KEY ("movimentacaoEstoqueId") REFERENCES "MovimentacaoEstoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EstornoVenda" ADD CONSTRAINT "EstornoVenda_justificativa_min_chk" CHECK (char_length(btrim("justificativa")) >= 10);
ALTER TABLE "EstornoVenda" ADD CONSTRAINT "EstornoVenda_totalEstornado_nonnegative_chk" CHECK ("totalEstornado" >= 0);
ALTER TABLE "ItemEstornoVenda" ADD CONSTRAINT "ItemEstornoVenda_quantidade_positive_chk" CHECK ("quantidade" > 0);
ALTER TABLE "ItemEstornoVenda" ADD CONSTRAINT "ItemEstornoVenda_valor_nonnegative_chk" CHECK ("valorEstornado" >= 0);

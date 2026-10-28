-- Adiciona o custo histórico sem alterar os itens de vendas existentes.
ALTER TABLE "ItemVenda"
ADD COLUMN "custoUnitario" DECIMAL(12, 2);
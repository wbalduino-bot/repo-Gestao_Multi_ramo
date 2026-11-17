-- Adiciona o valor entregue pelo cliente nas vendas em dinheiro.
ALTER TABLE "Venda"
ADD COLUMN "valorRecebido" DECIMAL(14,2);

-- Armazena o troco calculado pelo backend.
ALTER TABLE "Venda"
ADD COLUMN "troco" DECIMAL(14,2);

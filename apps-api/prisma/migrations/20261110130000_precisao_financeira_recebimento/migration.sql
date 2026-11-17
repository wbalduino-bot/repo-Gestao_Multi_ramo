-- Preserva maior precisao nos custos internos.
ALTER TABLE "Produto"
ALTER COLUMN "custo" SET DATA TYPE DECIMAL(18,6);

-- Preserva a precisao historica do custo nas vendas.
ALTER TABLE "ItemVenda"
ALTER COLUMN "custoUnitario" SET DATA TYPE DECIMAL(18,6);

-- Armazena os dados fiscais originais do recebimento.
-- Campos opcionais preservam compatibilidade com registros antigos.
ALTER TABLE "ItemRecebimentoCompra"
ADD COLUMN "fatorEmbalagem" INTEGER,
ADD COLUMN "quantidadeNota" DECIMAL(14,3),
ADD COLUMN "unidadeNota" TEXT,
ADD COLUMN "valorTotalItemNota" DECIMAL(20,2),
ADD COLUMN "valorUnitarioNota" TEXT;

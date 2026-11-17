-- Preserva o custo unitario de aquisicao de cada lote.
-- Campo opcional para compatibilidade com lotes anteriores
-- e entradas sem custo de aquisicao conhecido.

ALTER TABLE "LoteEstoque"
ADD COLUMN "custoUnitarioAquisicao" DECIMAL(18,6);

ALTER TABLE "Categoria"
ADD COLUMN "percentualAcrescimo" DECIMAL(7,2),
ADD CONSTRAINT "Categoria_percentualAcrescimo_check"
CHECK ("percentualAcrescimo" BETWEEN 0 AND 10000);

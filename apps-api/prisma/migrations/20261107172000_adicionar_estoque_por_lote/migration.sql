BEGIN;

CREATE TABLE "LoteEstoque" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "produtoId" UUID NOT NULL,
    "codigoLote" TEXT,
    "entradaEm" TIMESTAMP(3),
    "validadeEm" DATE,
    "quantidadeInicial" DECIMAL(14,3) NOT NULL,
    "quantidadeRestante" DECIMAL(14,3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteEstoque_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoteEstoque_quantidades_check" CHECK (
        "quantidadeInicial" > 0
        AND "quantidadeRestante" >= 0
        AND "quantidadeRestante" <= "quantidadeInicial"
    )
);

CREATE TABLE "MovimentacaoLoteEstoque" (
    "empresaId" UUID NOT NULL,
    "produtoId" UUID NOT NULL,
    "movimentacaoId" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "MovimentacaoLoteEstoque_pkey"
        PRIMARY KEY ("movimentacaoId", "loteId"),
    CONSTRAINT "MovimentacaoLoteEstoque_quantidade_check"
        CHECK ("quantidade" > 0)
);

CREATE UNIQUE INDEX "MovimentacaoEstoque_empresaId_produtoId_id_key"
    ON "MovimentacaoEstoque"("empresaId", "produtoId", "id");

CREATE UNIQUE INDEX "LoteEstoque_empresaId_produtoId_id_key"
    ON "LoteEstoque"("empresaId", "produtoId", "id");

CREATE INDEX "LoteEstoque_empresaId_produtoId_validadeEm_entradaEm_idx"
    ON "LoteEstoque"("empresaId", "produtoId", "validadeEm", "entradaEm");

CREATE INDEX "MovimentacaoLoteEstoque_loteId_idx"
    ON "MovimentacaoLoteEstoque"("loteId");

ALTER TABLE "LoteEstoque"
    ADD CONSTRAINT "LoteEstoque_empresaId_produtoId_fkey"
    FOREIGN KEY ("empresaId", "produtoId")
    REFERENCES "Produto"("empresaId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MovimentacaoLoteEstoque"
    ADD CONSTRAINT "MovimentacaoLoteEstoque_empresaId_produtoId_movimentacaoId_fkey"
    FOREIGN KEY ("empresaId", "produtoId", "movimentacaoId")
    REFERENCES "MovimentacaoEstoque"("empresaId", "produtoId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MovimentacaoLoteEstoque"
    ADD CONSTRAINT "MovimentacaoLoteEstoque_empresaId_produtoId_loteId_fkey"
    FOREIGN KEY ("empresaId", "produtoId", "loteId")
    REFERENCES "LoteEstoque"("empresaId", "produtoId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "SaldoEstoque" WHERE "quantidadeDisponivel" < 0
    ) THEN
        RAISE EXCEPTION 'Há saldo disponível negativo. Revise o estoque antes de migrar.';
    END IF;
END;
$$;

-- Reusa o UUID do saldo como identificador do lote de saldo anterior.
INSERT INTO "LoteEstoque" (
    "id", "empresaId", "produtoId", "quantidadeInicial", "quantidadeRestante"
)
SELECT
    "id", "empresaId", "produtoId", "quantidadeDisponivel", "quantidadeDisponivel"
FROM "SaldoEstoque"
WHERE "quantidadeDisponivel" > 0;

COMMIT;

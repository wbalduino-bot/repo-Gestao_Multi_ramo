-- Empresas existentes permanecem DEFINITIVO. O provisionamento inicia novos trials.
BEGIN;
CREATE TYPE "ModalidadeAcessoEmpresa" AS ENUM ('TRIAL', 'DEFINITIVO');
ALTER TABLE "Empresa"
  ADD COLUMN "modalidadeAcesso" "ModalidadeAcessoEmpresa" NOT NULL DEFAULT 'DEFINITIVO',
  ADD COLUMN "trialIniciadoEm" TIMESTAMPTZ(3),
  ADD COLUMN "trialTerminaEm" TIMESTAMPTZ(3),
  ADD COLUMN "versaoAcesso" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_trial_datas_check" CHECK (
  "modalidadeAcesso" <> 'TRIAL' OR
  ("trialIniciadoEm" IS NOT NULL AND "trialTerminaEm" IS NOT NULL AND "trialTerminaEm" > "trialIniciadoEm")
);
COMMIT;

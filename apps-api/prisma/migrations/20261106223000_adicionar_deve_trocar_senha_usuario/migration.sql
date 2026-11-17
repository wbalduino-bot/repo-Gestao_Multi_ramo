-- Registra a pendência de troca de senha. Contas existentes começam sem pendência.
ALTER TABLE "Usuario" ADD COLUMN "deveTrocarSenha" BOOLEAN NOT NULL DEFAULT false;

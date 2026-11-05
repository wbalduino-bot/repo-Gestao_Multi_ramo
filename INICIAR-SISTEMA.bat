@echo off
title Gestao Comercial Multi-Ramo

set "ROOT=%~dp0"

echo ==========================================
echo   GESTAO COMERCIAL MULTI-RAMO
echo ==========================================
echo.
echo Iniciando os servicos...
echo.

if not exist "%ROOT%apps-api\package.json" (
    echo ERRO: Pasta da API nao encontrada.
    pause
    exit /b 1
)

if not exist "%ROOT%apps-web\package.json" (
    echo ERRO: Pasta do frontend nao encontrada.
    pause
    exit /b 1
)

start "Gestao Comercial - API" cmd.exe /k "cd /d ""%ROOT%apps-api"" && npm run start:dev"

start "Gestao Comercial - Frontend" cmd.exe /k "cd /d ""%ROOT%apps-web"" && npm run dev"

echo.
echo Os dois terminais foram abertos.
echo Aguarde a inicializacao dos servicos.
echo.
echo Frontend: http://localhost:3000
echo.
pause

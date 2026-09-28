@echo off
rem Atalho do agente de faturamento ISS Fortaleza (Story 13.4, AC 15 - Epico 13).
rem Duplo clique: entra na pasta do sistema e roda "npm run iss:faturamento" no modo assistente
rem (pergunta a competencia, confirma e no fim oferece abrir o dialogo de lote no sistema).
rem
rem ATENCAO: este arquivo e propositalmente so ASCII (sem acentos). O cmd le o .cmd em pedacos
rem de bytes na pagina de codigo do console; acento em UTF-8 desalinha a leitura e quebra os
rem comandos. Os textos com acento ficam no proprio agente (Node escreve UTF-8 certo no console).
rem
rem Onde fica o sistema? Nesta ordem:
rem   1. a pasta onde este arquivo esta (scripts\agente-iss\ dentro do repositorio, ou um atalho
rem      .lnk apontando para ele);
rem   2. a variavel de ambiente AGENTE_ISS_REPO;
rem   3. o caminho memorizado em %USERPROFILE%\agente-iss\repositorio.txt (gravado sempre que
rem      este arquivo roda de dentro do repositorio) - e o que faz uma COPIA na Area de Trabalho
rem      funcionar.
setlocal
title Buscar faturamento ISS

set "REPO="
if exist "%~dp0..\..\apps\agente-iss\package.json" for %%I in ("%~dp0..\..") do set "REPO=%%~fI"
if not defined REPO if defined AGENTE_ISS_REPO if exist "%AGENTE_ISS_REPO%\apps\agente-iss\package.json" set "REPO=%AGENTE_ISS_REPO%"
if not defined REPO if exist "%USERPROFILE%\agente-iss\repositorio.txt" set /p REPO=<"%USERPROFILE%\agente-iss\repositorio.txt"
if not defined REPO goto sem_repo
if not exist "%REPO%\apps\agente-iss\package.json" goto sem_repo

rem Memoriza a pasta para que uma copia deste arquivo em outro lugar tambem funcione.
if not exist "%~dp0..\..\apps\agente-iss\package.json" goto rodar
if not exist "%USERPROFILE%\agente-iss" mkdir "%USERPROFILE%\agente-iss"
>"%USERPROFILE%\agente-iss\repositorio.txt" echo %REPO%

:rodar
cd /d "%REPO%"
call npm run iss:faturamento
set "CODIGO=%ERRORLEVEL%"
echo.
if "%CODIGO%"=="0" echo Pronto. Pode fechar esta janela.
if not "%CODIGO%"=="0" echo Terminou com problema (codigo %CODIGO%). Leia as mensagens acima; se nao entender, chame o responsavel pelo sistema.
echo.
pause
endlocal & exit /b %CODIGO%

:sem_repo
echo Nao encontrei a pasta do sistema.
echo Rode este arquivo uma vez de dentro da pasta scripts\agente-iss do sistema (ele memoriza o caminho)
echo ou chame o responsavel pelo sistema.
echo.
pause
endlocal & exit /b 1

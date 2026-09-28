@echo off
rem Instala a tarefa agendada do agente ISS (Story 13.5, AC 17 - Epico 13, Fase 2).
rem
rem O que faz: compila o agente UMA vez, grava um roteiro curto em
rem     %USERPROFILE%\agente-iss\tarefa-agendada.cmd
rem (fora do OneDrive) e registra no Agendador de Tarefas do Windows uma tarefa que, A CADA
rem MINUTO, roda esse roteiro (= node apps\agente-iss\dist\cli.mjs --uma-vez na pasta do sistema,
rem sem recompilar nada a cada minuto). Cada rodada pergunta ao sistema se alguem clicou em "Buscar no ISS"
rem (dialogo de lote dos clientes contabeis). Se sim, le o ISS e manda os valores; se nao, termina
rem na hora. Basta rodar este arquivo UMA vez neste computador.
rem
rem Se ja houver uma rodada em andamento quando o minuto seguinte chegar, o Windows nao abre outra
rem (padrao do Agendador), e o sistema tambem nao entrega o mesmo pedido duas vezes.
rem
rem Alternativa sem tarefa agendada: deixar uma janela aberta com
rem     npm run iss:faturamento -- --vigiar
rem (fica consultando a cada 60 s ate a janela ser fechada).
rem
rem Uso:
rem   instalar-tarefa-agendada.cmd            instala; roda so com voce logado no Windows (uma
rem                                           janela preta pode piscar por alguns segundos a
rem                                           cada minuto)
rem   instalar-tarefa-agendada.cmd /oculta    instala SEM janela: o Windows pede a senha desta
rem                                           conta e a tarefa roda mesmo sem ninguem logado
rem   instalar-tarefa-agendada.cmd /remover   remove a tarefa
rem
rem A senha do ISS NAO passa por aqui: continua so em %USERPROFILE%\agente-iss\.env (rode
rem "npm run iss:configurar" antes, se ainda nao rodou).
rem
rem Atualizou o sistema (git pull)? Rode este arquivo de novo para recompilar o agente.
rem
rem ATENCAO: este arquivo e propositalmente so ASCII (sem acentos) - ver o comentario em
rem "Buscar faturamento ISS.cmd".
setlocal
set "TAREFA=Agente ISS - pedidos do sistema"

if /i "%~1"=="/remover" goto remover

set "REPO="
if exist "%~dp0..\..\apps\agente-iss\package.json" for %%I in ("%~dp0..\..") do set "REPO=%%~fI"
if not defined REPO goto sem_repo

rem 1. Compila o agente uma vez (a tarefa so executa o dist\cli.mjs pronto).
where node >nul 2>nul
if errorlevel 1 goto sem_node
pushd "%REPO%"
call npm run build --workspace apps/agente-iss
set "ERRO_BUILD=%errorlevel%"
popd
if not "%ERRO_BUILD%"=="0" goto falhou_build
if not exist "%REPO%\apps\agente-iss\dist\cli.mjs" goto falhou_build

rem 2. Roteiro da tarefa fora do OneDrive. Assim o /tr e so um caminho entre aspas: funciona
rem mesmo com espaco no caminho do sistema ou do usuario (o "cmd /c cd && npm" antigo quebrava).
set "PASTA=%USERPROFILE%\agente-iss"
if not exist "%PASTA%" mkdir "%PASTA%"
set "ROTEIRO=%PASTA%\tarefa-agendada.cmd"
> "%ROTEIRO%" echo @echo off
>> "%ROTEIRO%" echo rem Gerado por scripts\agente-iss\instalar-tarefa-agendada.cmd - nao editar.
>> "%ROTEIRO%" echo cd /d "%REPO%"
>> "%ROTEIRO%" echo node "apps\agente-iss\dist\cli.mjs" --uma-vez
set "COMANDO=\"%ROTEIRO%\""

if /i "%~1"=="/oculta" goto oculta

schtasks /create /tn "%TAREFA%" /sc minute /mo 1 /tr "%COMANDO%" /it /f
if errorlevel 1 goto falhou
goto instalada

:oculta
echo O Windows vai pedir a senha da conta %USERDOMAIN%\%USERNAME% (a do Windows, NAO a do ISS).
schtasks /create /tn "%TAREFA%" /sc minute /mo 1 /tr "%COMANDO%" /ru "%USERDOMAIN%\%USERNAME%" /rp * /f
if errorlevel 1 goto falhou
goto instalada

:instalada
echo.
echo Tarefa "%TAREFA%" instalada: a cada minuto o agente confere se ha pedido do sistema.
echo Agora use o botao "Buscar no ISS" no dialogo de lote dos clientes contabeis.
echo O registro do que o agente fez fica em %USERPROFILE%\agente-iss\vigiar.log
echo.
pause
endlocal & exit /b 0

:remover
schtasks /delete /tn "%TAREFA%" /f
if errorlevel 1 goto falhou
if exist "%USERPROFILE%\agente-iss\tarefa-agendada.cmd" del "%USERPROFILE%\agente-iss\tarefa-agendada.cmd"
echo Tarefa "%TAREFA%" removida.
echo.
pause
endlocal & exit /b 0

:falhou
echo.
echo Nao consegui mexer na tarefa agendada (veja a mensagem acima). Chame o responsavel pelo sistema.
echo.
pause
endlocal & exit /b 1

:sem_node
echo Nao encontrei o Node.js neste computador. Instale o Node.js 20 ou mais novo e rode de novo.
echo.
pause
endlocal & exit /b 1

:falhou_build
echo.
echo Nao consegui compilar o agente (veja a mensagem acima). Rode "npm install" na pasta do
echo sistema e tente de novo. Se continuar, chame o responsavel pelo sistema.
echo.
pause
endlocal & exit /b 1

:sem_repo
echo Nao encontrei a pasta do sistema.
echo Rode este arquivo de dentro da pasta scripts\agente-iss do sistema.
echo.
pause
endlocal & exit /b 1

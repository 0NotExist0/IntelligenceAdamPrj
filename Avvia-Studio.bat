@echo off
setlocal
title NotExist Intelligience Studio
cd /d "%~dp0"

echo =========================================================
echo    NotExist Intelligience Studio
echo    di 0Not_Exist0
echo    Interfaccia grafica per Claude Code
echo =========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRORE] Node.js non e' installato o non e' nel PATH.
    echo Scaricalo da https://nodejs.org e riprova.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installazione dipendenze in corso...
    call npm install
    if errorlevel 1 (
        echo [ERRORE] npm install non e' riuscito.
        pause
        exit /b 1
    )
)

REM Chiude un server gia' in ascolto: senza questo resterebbe attiva la versione
REM vecchia del codice e gli aggiornamenti sembrerebbero non essere stati applicati.
echo Chiusura di eventuali sessioni precedenti...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>nul
)

echo Avvio del server...
start "NotExist Studio Server" /MIN cmd /c "node server.js > studio.log 2>&1"

REM Attende che la porta risponda davvero, invece di sperare in un ritardo fisso.
set /a TRIES=0
:waitloop
set /a TRIES+=1
ping -n 2 127.0.0.1 >nul
netstat -an | findstr ":3456 " | findstr "LISTENING" >nul
if errorlevel 1 (
    if %TRIES% LSS 15 goto waitloop
    echo.
    echo [ERRORE] Il server non si e' avviato entro il tempo previsto.
    echo Dettagli in studio.log:
    echo ---------------------------------------------------
    if exist studio.log type studio.log
    echo ---------------------------------------------------
    pause
    exit /b 1
)

echo Server attivo su http://localhost:3456
echo.

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE%" (
    start "" "%EDGE%" --app=http://localhost:3456 --window-size=1400,900
) else (
    start "" http://localhost:3456
)

echo Interfaccia aperta. Puoi chiudere questa finestra.
ping -n 3 127.0.0.1 >nul
exit /b 0

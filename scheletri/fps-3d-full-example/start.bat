@echo off
title Low-Poly Adventure - Avvio Gioco
cd /d "%~dp0"

echo ===================================================
echo     NOT EXIST GAME PRODUCTIONS presenta:
echo         LOW-POLY ADVENTURE by 0Not_Exist0
echo ===================================================
echo.

:: 1. Verifica installazione di Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRORE] Node.js non e' stato trovato nel sistema!
    echo Per avviare il gioco e' necessario avere Node.js installato.
    echo Puoi scaricarlo gratuitamente da: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 2. Verifica se le dipendenze esistono, altrimenti esegue npm install
if not exist "node_modules\" (
    echo [INFO] Prima esecuzione: installazione pacchetti in corso...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRORE] Si e' verificato un problema durante l'installazione delle dipendenze.
        pause
        exit /b 1
    )
)

echo [OK] Ambiente e dipendenze verificati con successo.
echo [INFO] Avvio del server di gioco e apertura del browser...
echo.
echo ===================================================
echo   COMANDI PC:
echo   - W, A, S, D       : Movimento
echo   - Click Sx / Tasto F: Spara con la Pistola 🔫
echo   - Tasto R          : Ricarica Caricatore (12 colpi)
echo   - Tasto E          : Pugno corpo a corpo 🥊
echo   - SPAZIO           : Salto
echo   - SHIFT            : Scatto / Corsa veloce
echo   - Tasto V          : Alterna 1a / 3a Persona
echo   - Tasto X / I      : Inverti asse X / Y Mouse
echo   - MOUSE            : Ruota telecamera
echo.
echo   CONTROLLI SMARTPHONE (Touch Screen):
echo   - Joystick (in basso a sinistra) : Movimento
echo   - Swipe (meta' destra schermo)   : Ruota telecamera
echo   - Pulsante SPARA 🔫: Fuoco a distanza
echo   - Pulsante PUGNO 🥊: Attacco corpo a corpo
echo   - Tocco su Munizioni: Ricarica arma
echo   - Pulsante SALTA   : Salto
echo   - Pulsante CORSA   : Attiva/disattiva scatto
echo   - Badge Visuale    : Tocca per alternare 1a/3a persona
echo ===================================================
echo.
echo Premi CTRL+C o chiudi questa finestra per terminare il server.
echo.

:: 3. Avvia il server Vite aprendo automaticamente il browser web
call npm run dev -- --open

pause

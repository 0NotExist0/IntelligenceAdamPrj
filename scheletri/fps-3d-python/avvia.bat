@echo off
rem Avvia il server della partita e il gioco. Chiudi le finestre per fermare tutto.
cd /d "%~dp0"
start "Server del gioco" cmd /k python server.py
timeout /t 1 >nul
python main.py
pause

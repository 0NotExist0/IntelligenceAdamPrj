@echo off
rem Avvia il gioco in localhost e apre il browser. Chiudi questa finestra per fermare il server.
cd /d "%~dp0"
start "" http://localhost:8000
node server.js
pause

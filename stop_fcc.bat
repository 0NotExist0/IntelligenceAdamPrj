taskkill /F /FI "WINDOWTITLE eq *fcc-server*" /T
taskkill /F /IM node.exe /FI "MODULES eq *fcc-server*"
powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force"
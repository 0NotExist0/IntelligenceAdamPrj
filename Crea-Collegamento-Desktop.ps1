$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "NotExist Intelligience Studio.lnk"
$TargetBat = Join-Path $PSScriptRoot "Avvia-Studio.bat"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetBat
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "NotExist Intelligience Studio di 0Not_Exist0 - interfaccia grafica per Claude Code"
$Shortcut.IconLocation = "shell32.dll,220" # Icona elegante stile terminale/schermo
$Shortcut.Save()

Write-Host "Collegamento creato sul Desktop: $ShortcutPath"

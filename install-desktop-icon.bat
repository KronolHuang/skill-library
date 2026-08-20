@echo off
chcp 65001 >nul
rem Create a desktop shortcut for Skill Library on Windows
set "SCRIPT_DIR=%~dp0"
set "PS_CMD=$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = $ws.CreateShortcut((Join-Path $desktop 'Skill Library.lnk')); $lnk.TargetPath = '%SCRIPT_DIR%start.bat'; $lnk.WorkingDirectory = '%SCRIPT_DIR%'; $lnk.Save()"
powershell -NoProfile -ExecutionPolicy Bypass -Command "%PS_CMD%"
echo.
echo Done. A shortcut named "Skill Library" is now on your Desktop.
pause

@echo off
setlocal EnableExtensions
rem DSH-Superagent guard installer (run by double-click, or from a terminal).
rem Writes a hidden-window VBS starter into THIS user's Startup folder so the guard loop
rem (start the backend at logon + one watchdog tick every 15 minutes) runs on every sign-in.
rem No admin, no Task Scheduler (this environment refuses it), no registry machine keys.
rem Uninstall: delete the VBS from the Startup folder, or drop a "disabled" file in
rem   %APPDATA%\Superagent\watchdog  (the running loop exits at its next tick).
rem Optional: CLI unattended path only. The in-app plugin path does not need this; the app starts its own host.
set "REPO=%~dp0"
set "REPO=%REPO:~0,-1%"
set "GUARD=%REPO%\scripts\dsh-superagent-guard.ps1"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%GUARD%" ( echo ERROR: guard script not found at "%GUARD%" & pause & exit /b 1 )
if not exist "%PWSH%" ( echo ERROR: PowerShell 7 not found at "%PWSH%" & pause & exit /b 1 )
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\DSH-Superagent-Guard.vbs"
(
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.Run """"%PWSH%"" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%GUARD%""", 0, False
) > "%VBS%"
if not exist "%VBS%" ( echo ERROR: could not write "%VBS%" & pause & exit /b 1 )
echo Installed guard starter: "%VBS%"
echo It runs on your next sign-in. To start now without signing out, double-click it.
echo Uninstall later by deleting that file, or by creating a "disabled" marker in
echo   "%APPDATA%\Superagent\watchdog".
pause
exit /b 0

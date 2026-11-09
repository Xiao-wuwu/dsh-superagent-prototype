@echo off
rem Written by dsh-superagent: Windows entry point for scripts\dsh-superagent, the service manager that POSIX runs
rem directly. It only locates a working Python 3 and hands over; keep it free of PowerShell, whose execution policy
rem may block .ps1 files. Usage: dsh-superagent.cmd <start|stop|restart|status> [--profile <name>] [--url <url>] ...
setlocal EnableExtensions
set "SCRIPT=%~dp0dsh-superagent"
set "INTERP="
if defined DSH_SUPERAGENT_PYTHON (
  "%DSH_SUPERAGENT_PYTHON%" -c "import sys" >nul 2>nul
  if not errorlevel 1 set "INTERP=%DSH_SUPERAGENT_PYTHON%"
)
if not defined INTERP (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -c "import sys" >nul 2>nul
    if not errorlevel 1 set "INTERP=py -3"
  )
)
if not defined INTERP (
  for %%c in (python.exe python3.exe) do (
    if not defined INTERP (
      where %%c >nul 2>nul
      if not errorlevel 1 (
        "%%c" -c "import sys" >nul 2>nul
        if not errorlevel 1 set "INTERP=%%c"
      )
    )
  )
)
if not defined INTERP (
  echo dsh-superagent needs Python 3.8 or later on PATH; install it, or set DSH_SUPERAGENT_PYTHON to python.exe. 1>&2
  exit /b 1
)
%INTERP% "%SCRIPT%" %*
exit /b %ERRORLEVEL%

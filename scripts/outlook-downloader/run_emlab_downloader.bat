@echo off
setlocal
cd /d "%~dp0"
set "EMLAB_OUTLOOK_CONFIG=%APPDATA%\EMLAB\outlook-downloader\config.json"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download_emlab_attachments.ps1" -Config "%EMLAB_OUTLOOK_CONFIG%"
if %errorlevel% neq 9009 exit /b %errorlevel%
py -3 download_emlab_attachments.py --config "%EMLAB_OUTLOOK_CONFIG%"
if %errorlevel% neq 9009 exit /b %errorlevel%
python download_emlab_attachments.py --config "%EMLAB_OUTLOOK_CONFIG%"
exit /b %errorlevel%

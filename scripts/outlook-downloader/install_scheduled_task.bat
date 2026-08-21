@echo off
setlocal
cd /d "%~dp0"
set "TASK_NAME=EMLAB Outlook Attachment Downloader"
set "RUNNER=%~dp0run_emlab_downloader.bat"

call "%RUNNER%"
if errorlevel 1 exit /b %errorlevel%

schtasks /Create /TN "%TASK_NAME%" /SC MINUTE /MO 5 /TR "\"%RUNNER%\"" /F
exit /b %errorlevel%

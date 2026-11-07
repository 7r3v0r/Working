@echo off
rem Launches Squares of the Dead: starts a local web server and opens the game in your browser.
rem Keep this window open while playing; close it to stop the server.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8123 -Open
if errorlevel 1 pause

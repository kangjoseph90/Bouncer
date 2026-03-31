@echo off
title Bouncer AI Proxy - Quick Start
setlocal enabledelayedexpansion

echo ============================================================
echo   Bouncer AI Proxy - One-Click Start Script
echo ============================================================
echo.

:: 1. .env Check
if exist ".env" goto check_models

echo [!] .env file not found. Creating from .env.example...
copy .env.example .env >nul
echo Please open .env in Notepad and configure your ADMIN_PASSWORD and API Keys.
notepad .env
echo.
echo Press any key when you are done configuring the .env file...
pause >nul

:check_models
:: 2. models.json Check
echo [?] Do you want to configure your AI Models (models.json) now?
echo (If you already did, just type N and press Enter)
set /p MODEL_EDIT="Open models.json? (Y/N): "
if /i not "!MODEL_EDIT!"=="Y" goto check_bun

echo.
echo Opening models.json in Notepad...
notepad models.json
echo Press any key when you are done configuring models...
pause >nul

:check_bun
:: 3. Bun Check and Auto-Install
where bun >nul 2>nul
if %errorlevel% equ 0 goto install_deps

echo [Info] Bun runtime is not installed. Installing automatically...
echo (This may take a minute)
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (iwr bun.sh/install.ps1)"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

where bun >nul 2>nul
if %errorlevel% equ 0 goto install_deps

echo [Error] Failed to install Bun automatically. 
echo Please install from https://bun.sh manually and run this script again.
pause
exit

:install_deps
:: 4. Install dependencies
echo.
echo [Info] Installing required packages (bun install)...
call bun install

:: 5. Execution mode selection
echo.
echo ============================================================
echo [Select Run Mode]
echo 1: Local Mode (Internal network only)
echo 2: Public Mode (Cloudflare Tunnel - Shared with the world)
echo ============================================================
set RUN_MODE=1
set /p RUN_MODE="Enter mode number (1/2) - Default is 1: "

if "%RUN_MODE%"=="2" goto run_public
goto run_local

:run_public
:: Download cloudflared if not present
if exist "cloudflared.exe" goto start_tunnel_process

echo [Info] Downloading Cloudflare Tunnel (cloudflared.exe)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
echo [Success] Download complete.

:start_tunnel_process
echo.
echo ============================================================
echo [IMPORTANT] The URL ending with "trycloudflare.com" below
echo is your PUBLIC server address. Share this with users.
echo ============================================================
echo.

:: Start server in background
start "Bouncer_Server" bun run start
timeout /t 3 >nul

:: Start Cloudflare tunnel
cloudflared.exe tunnel --url http://127.0.0.1:3000
goto end

:run_local
echo.
echo [Info] Starting Local Server...
echo Access at: http://127.0.0.1:3000
echo (Press Ctrl + C to stop)
echo ============================================================
call bun run start

:end
pause

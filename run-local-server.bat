@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 or newer, then try again.
  pause
  exit /b 1
)

for /f "delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 24 (
  echo This platform requires Node.js 24 or newer. Current major version: %NODE_MAJOR%.
  pause
  exit /b 1
)

set "PORT=3001"
set "HOST=127.0.0.1"
set "NODE_ENV=development"
set "AMEEN_DATA_DIR=%~dp0data"
set "AMEEN_UPLOAD_DIR=%~dp0uploads"
set "SESSION_SECRET=local-preview-session-secret-2026-only"
set "ADMIN_EMAIL=admin@ameen.local"
set "ADMIN_PASSWORD=mkopmkop"

echo.
echo Starting Ameen Learning Platform at http://127.0.0.1:3001
echo Keep this window open while using the platform.
echo.
node server.js

echo.
echo The server stopped. Read the error above, then restart this file.
pause


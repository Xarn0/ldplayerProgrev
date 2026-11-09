@echo off
title LDPlayer Warmup Engine

echo ========================================================
echo    LDPLAYER WARMUP ENGINE ^& DASHBOARD
echo ========================================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not found in PATH!
    pause
    exit /b 1
)

netstat -ano | findstr :8099 | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo [OK] Server is already running on http://localhost:8099
    echo Opening dashboard in your browser...
    start "" http://localhost:8099
    exit /b 0
)

echo Starting LDPlayer Warmup Server on http://localhost:8099...
start "" http://localhost:8099
python server.py
if errorlevel 1 (
    echo [ERROR] Failed to start server. Port 8099 might be in use.
    pause
)
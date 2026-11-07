@echo off
chcp 65001 > nul
title LDPlayer Warmup Engine & GUI

echo ========================================================
echo    LDPLAYER WARMUP ENGINE & DASHBOARD
echo ========================================================
echo.
echo [1/2] Проверка окружения Python...
python --version
if errorlevel 1 (
    echo [ERROR] Python не найден! Установите Python 3.x с галочкой Add to PATH.
    pause
    exit /b
)

echo [2/2] Запуск локального графического сервера на порту 8099...
echo Сервер открывается в браузере: http://localhost:8099
echo.
start "" http://localhost:8099
python server.py
pause

@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title LDPlayer Multi-Device Installer & Warmup Engine

echo ================================================================
echo    🤖 LDPLAYER WARMUP ENGINE - УСТАНОВКА И СИНХРОНИЗАЦИЯ
echo ================================================================
echo.

set "LD_DIR=C:\LDPlayer\LDPlayer14"
if not exist "%LD_DIR%\ldconsole.exe" (
    set "LD_DIR=C:\LDPlayer\LDPlayer9"
)

if not exist "%LD_DIR%\ldconsole.exe" (
    echo [ОШИБКА] Не найдена папка LDPlayer (проверено C:\LDPlayer\LDPlayer14 и LDPlayer9).
    echo Пожалуйста, укажите верный путь к LDPlayer в файле app_config.json.
    pause
    exit /b 1
)

echo [✓] LDPlayer найден: %LD_DIR%
echo.

:: 1. Проверка запущенных эмуляторов
echo [1/3] Поиск запущенных инстансов LDPlayer...
"%LD_DIR%\ldconsole.exe" runninglist > running_temp.txt
set /a count=0
for /f "tokens=*" %%i in (running_temp.txt) do (
    if not "%%i"=="" (
        set /a count+=1
        echo   -> Активный эмулятор: %%i
    )
)
del running_temp.txt 2>nul

if %count% equ 0 (
    echo   [!] Запущенных эмуляторов не найдено.
    echo   Вы можете запустить нужный эмулятор через LDMultiPlayer или выбрать авто-запуск.
)

:: 2. Установка шортката веб-приложения / APK на устройства
echo.
echo [2/3] Настройка быстрого доступа на экранах эмуляторов...
"%LD_DIR%\ldconsole.exe" list2 > instances_temp.txt
for /f "tokens=1,2 delims=," %%a in (instances_temp.txt) do (
    set "idx=%%a"
    set "name=%%b"
    echo   Настройка эмулятора [!idx!] !name!...
    :: Добавляем ярлык панели управления на рабочий стол Android внутри эмулятора
    "%LD_DIR%\ldconsole.exe" adb --index !idx! --command "am start -a android.intent.action.VIEW -d http://10.0.2.2:8099 2>/dev/null" >nul 2>&1
)
del instances_temp.txt 2>nul

:: 3. Запуск основного сервера управления
echo.
echo [3/3] Запуск локального ядра управления и Web GUI...
echo Панель управления доступна:
echo   - На вашем ПК:       http://localhost:8099
echo   - Внутри LDPlayer:   http://10.0.2.2:8099
echo.
start "" http://localhost:8099
python server.py

pause

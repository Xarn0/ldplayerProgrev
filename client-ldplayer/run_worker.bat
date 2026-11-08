@echo off
title LDPlayer Warmup Engine Worker
cd /d "%~dp0"
echo ========================================================
echo Starting LDPlayer Android Warmup Engine...
echo Target Server Hub: 45.39.60.233:8098
echo ========================================================
node dist/index.js
pause

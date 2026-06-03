@echo off
chcp 65001 >nul
cls
echo.
echo ════════════════════════════════════════════════════════════════
echo          ChainlessChain v0.26.2 - Auto Test Launcher
echo ════════════════════════════════════════════════════════════════
echo.
echo Opening test page...
echo.

start "" "%~dp0RUN_TEST_NOW.html"

timeout /t 2 /nobreak >nul

echo [OK] Test page opened!
echo.
echo Next steps:
echo   1. Click "Start Auto Test" button in the opened page
echo   2. Wait for test completion (about 45 seconds)
echo   3. View test results
echo.
echo Or visit the visual console directly:
echo   http://127.0.0.1:5173/test-console.html
echo.
echo Press any key to exit...
pause >nul

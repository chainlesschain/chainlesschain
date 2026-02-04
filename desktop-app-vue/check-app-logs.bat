@echo off
echo ========================================
echo Checking Recent App Logs
echo ========================================
echo.

REM Find the most recent log file
for /f "delims=" %%i in ('dir /b /od "%APPDATA%\chainlesschain-desktop-vue\logs\*.log" 2^>nul') do set LATEST_LOG=%%i

if "%LATEST_LOG%"=="" (
    echo No log files found in %APPDATA%\chainlesschain-desktop-vue\logs\
    echo.
    echo Checking if app is running...
    tasklist | findstr /i electron.exe
    echo.
    pause
    exit /b 1
)

echo Latest log file: %LATEST_LOG%
echo.
echo Checking for database errors...
echo ----------------------------------------
findstr /i /c:"database" /c:"owner_did" /c:"is_folder" /c:"ERROR" /c:"初始化失败" "%APPDATA%\chainlesschain-desktop-vue\logs\%LATEST_LOG%" | findstr /v "DEBUG"
echo.
echo ----------------------------------------
echo.
pause

@echo off
REM Setup Ollama connection for Android app
REM This script sets up ADB reverse port forwarding so the Android app can access PC's Ollama

echo Checking ADB connection...
adb devices

echo.
echo Setting up port forwarding for Ollama (localhost:11434)...
adb reverse tcp:11434 tcp:11434

if %ERRORLEVEL% == 0 (
    echo.
    echo ✓ Port forwarding active!
    echo   Android app can now access Ollama at localhost:11434
    echo.
    echo Available models on your PC:
    curl -s http://localhost:11434/api/tags | findstr "name"
    echo.
    echo NOTE: This forwarding is temporary and will be lost when:
    echo   - Device disconnects from ADB
    echo   - PC reboots
    echo   - ADB server restarts
    echo.
    echo To re-enable, run this script again.
) else (
    echo.
    echo ✗ Failed to set up port forwarding
    echo   Make sure your device is connected via ADB
)

pause

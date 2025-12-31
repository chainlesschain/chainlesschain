@echo off
REM ChainlessChain Windows Installer Build Script
REM Requires Inno Setup 6.x to be installed

echo ========================================
echo ChainlessChain Installer Builder
echo ========================================
echo.

REM Check if Inno Setup is installed
where iscc >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Inno Setup compiler (iscc.exe) not found in PATH
    echo.
    echo Please install Inno Setup from: https://jrsoftware.org/isdl.php
    echo After installation, add the Inno Setup installation directory to your PATH
    echo Example: C:\Program Files (x86)\Inno Setup 6
    echo.
    echo Or run this script with the full path to iscc.exe:
    echo   "C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer.iss
    echo.
    pause
    exit /b 1
)

REM Check if packaged app exists
if not exist "out\ChainlessChain-win32-x64\chainlesschain.exe" (
    echo ERROR: Packaged application not found
    echo Please run 'npm run package' first to create the packaged app
    echo.
    pause
    exit /b 1
)

REM Create output directory for installer
if not exist "out\installer" mkdir "out\installer"

echo Building installer...
echo.

REM Compile the installer script
iscc installer.iss

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo SUCCESS! Installer created successfully
    echo ========================================
    echo.
    echo Output location:
    dir /b "out\installer\ChainlessChain-Setup-*.exe"
    echo.
    echo Full path:
    cd
    echo \out\installer\
    echo.
) else (
    echo.
    echo ========================================
    echo ERROR: Installer build failed
    echo ========================================
    echo.
    echo Please check the error messages above
    echo.
)

pause

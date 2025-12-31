@echo off
echo Attempting to clean out directory...

REM Kill any running Electron or Node processes that might be locking files
echo Checking for Electron and Node processes...
tasklist | findstr /i "electron.exe" && (
    echo Found Electron processes, attempting to kill...
    taskkill /F /IM electron.exe 2>nul
    timeout /t 2 /nobreak >nul
)

tasklist | findstr /i "ChainlessChain.exe" && (
    echo Found ChainlessChain processes, attempting to kill...
    taskkill /F /IM ChainlessChain.exe 2>nul
    timeout /t 2 /nobreak >nul
)

REM Wait a bit for file handles to release
echo Waiting for file handles to release...
timeout /t 3 /nobreak >nul

REM Try to remove the out directory
echo Attempting to remove out directory...
if exist "out" (
    rmdir /S /Q "out" 2>nul
    if exist "out" (
        echo Failed to remove out directory - it may still be locked
        echo Please close any File Explorer windows showing this directory
        echo and any programs that might be using files in the out folder
        exit /b 1
    ) else (
        echo Successfully removed out directory
        exit /b 0
    )
) else (
    echo out directory does not exist
    exit /b 0
)

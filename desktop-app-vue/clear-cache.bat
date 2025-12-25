@echo off
echo ========================================
echo Clearing Electron Cache
echo ========================================

REM Clear Windows Electron cache
echo Clearing Windows Electron cache...
rmdir /s /q "%APPDATA%\chainlesschain-desktop-vue" 2>nul
rmdir /s /q "%LOCALAPPDATA%\chainlesschain-desktop-vue" 2>nul
rmdir /s /q "%USERPROFILE%\AppData\Local\chainlesschain-desktop-vue" 2>nul
rmdir /s /q "%USERPROFILE%\AppData\Roaming\chainlesschain-desktop-vue" 2>nul

REM Clear dist folder
echo Clearing dist folder...
rmdir /s /q dist 2>nul

REM Rebuild
echo Rebuilding main process...
call npm run build:main

echo.
echo ========================================
echo Cache cleared successfully!
echo Please restart the application.
echo ========================================
pause

@echo off
setlocal
chcp 65001 >nul

REM 动态读取产品版本（来源：仓库根 package.json.productVersion，单一真值）
for /f %%i in ('node -e "console.log(require('../package.json').productVersion)" 2^>nul') do set "PRODUCT_VERSION=%%i"
if "%PRODUCT_VERSION%"=="" (
    echo ERROR: Cannot read productVersion from ..\package.json. Ensure Node.js is available.
    exit /b 1
)

echo.
echo ========================================
echo   Docs Site Packager %PRODUCT_VERSION%
echo ========================================
echo.

echo [1/5] Check environment...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found
    exit /b 1
)
echo OK: Node.js detected

echo.
echo [2/5] Check dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed
        exit /b 1
    )
) else (
    echo OK: dependencies already installed
)

echo.
echo [3/5] Clean previous build...
if exist "docs\.vitepress\dist" rmdir /s /q "docs\.vitepress\dist"
if exist "docs\.vitepress\cache" rmdir /s /q "docs\.vitepress\cache"
echo OK: previous build cleaned

echo.
echo [4/5] Build production site...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: site build failed
    exit /b 1
)
echo OK: site build succeeded

echo.
echo [5/5] Package site...
set "DIST_DIR=docs\.vitepress\dist"
set "PACKAGE_NAME=chainlesschain-docs-%PRODUCT_VERSION%-%date:~0,4%%date:~5,2%%date:~8,2%.zip"
if exist "%PACKAGE_NAME%" del "%PACKAGE_NAME%"

powershell -Command "Compress-Archive -Path 'docs/.vitepress/dist/*' -DestinationPath '%PACKAGE_NAME%' -Force"
if %errorlevel% neq 0 (
    echo ERROR: archive packaging failed
    exit /b 1
)

if not exist "%PACKAGE_NAME%" (
    echo ERROR: package file not created
    exit /b 1
)

echo OK: package created
echo.
echo Package: %PACKAGE_NAME%
echo Build dir: %CD%\%DIST_DIR%
echo Output: %CD%\%PACKAGE_NAME%
echo.
echo Run "npm run preview" to inspect the site locally.
exit /b 0

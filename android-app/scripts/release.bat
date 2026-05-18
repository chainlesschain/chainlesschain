@echo off
REM Android App Release Automation Script for Windows
REM Usage: release.bat [patch|minor|major]

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..

REM Get bump type (default: patch)
set BUMP_TYPE=%1
if "%BUMP_TYPE%"=="" set BUMP_TYPE=patch

echo [INFO] Starting Android release process...

REM Check if git is installed
where git >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] git is not installed
    exit /b 1
)

REM Check if GitHub CLI is installed
where gh >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARN] GitHub CLI (gh) is not installed. GitHub release will be skipped.
    set SKIP_GITHUB_RELEASE=true
)

REM Parse current version
cd /d "%ROOT_DIR%"
for /f "tokens=2 delims==" %%a in ('findstr "VERSION_NAME=" version.properties') do set CURRENT_VERSION=%%a
for /f "tokens=2 delims==" %%a in ('findstr "VERSION_CODE=" version.properties') do set CURRENT_CODE=%%a

echo [INFO] Current version: %CURRENT_VERSION% (%CURRENT_CODE%)

REM Bump version using PowerShell
powershell -Command "& {$version = '%CURRENT_VERSION%'; $parts = $version.Split('.'); $major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]; if ('%BUMP_TYPE%' -eq 'major') { $major++; $minor=0; $patch=0 } elseif ('%BUMP_TYPE%' -eq 'minor') { $minor++; $patch=0 } else { $patch++ }; $newVersion = \"$major.$minor.$patch\"; Write-Host $newVersion }" > temp_version.txt
set /p NEW_VERSION=<temp_version.txt
del temp_version.txt

set /a NEW_CODE=%CURRENT_CODE%+1

echo [INFO] New version: %NEW_VERSION% (%NEW_CODE%)

REM Confirm
echo.
echo [WARN] About to release version %NEW_VERSION% (%NEW_CODE%)
set /p CONFIRM="Continue? (y/n) "
if /i not "%CONFIRM%"=="y" (
    echo [INFO] Release cancelled
    exit /b 0
)

REM Update version.properties
powershell -Command "(Get-Content version.properties) -replace 'VERSION_NAME=.*', 'VERSION_NAME=%NEW_VERSION%' | Set-Content version.properties"
powershell -Command "(Get-Content version.properties) -replace 'VERSION_CODE=.*', 'VERSION_CODE=%NEW_CODE%' | Set-Content version.properties"

REM Run tests
echo [INFO] Running tests...
call gradlew.bat lint test
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Tests failed
    exit /b 1
)

REM Build release
echo [INFO] Building release...
call gradlew.bat assembleRelease bundleRelease
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed
    exit /b 1
)

echo [INFO] Build completed
echo [INFO] APK location: %ROOT_DIR%\app\build\outputs\apk\release
echo [INFO] Bundle location: %ROOT_DIR%\app\build\outputs\bundle\release

REM Create git tag
echo [INFO] Creating git tag...
set TAG=v%NEW_VERSION%

git add version.properties
git commit -m "chore: bump version to %NEW_VERSION%"
git tag -a "%TAG%" -m "Release %NEW_VERSION%"

echo [INFO] Git tag %TAG% created

REM Push to remote
echo [INFO] Pushing to remote...
git push origin main
git push origin %TAG%

echo [INFO] Pushed to remote

REM Create GitHub release
if not "%SKIP_GITHUB_RELEASE%"=="true" (
    echo [INFO] Creating GitHub release...

    REM Find APK file
    for %%f in (app\build\outputs\apk\release\*.apk) do set APK_FILE=%%f

    if not exist "!APK_FILE!" (
        echo [ERROR] APK file not found
        exit /b 1
    )

    gh release create "%TAG%" "!APK_FILE!" --title "Release %NEW_VERSION%" --notes "Release %NEW_VERSION%"

    echo [INFO] GitHub release created
)

echo [INFO] Release completed successfully! 🎉
echo [INFO] Version %NEW_VERSION% is now available

endlocal

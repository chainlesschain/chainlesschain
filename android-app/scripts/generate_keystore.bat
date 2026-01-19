@echo off
REM Android Release Keystore Generator for Windows
REM This script generates a release keystore for signing Android APK/AAB files

setlocal enabledelayedexpansion

echo ============================================================
echo Android Release Keystore Generator
echo ============================================================
echo.

REM Check if keytool is available
where keytool >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] keytool not found. Please install Java JDK.
    echo.
    echo Download from: https://adoptium.net/
    pause
    exit /b 1
)

echo [INFO] keytool found
echo.

REM Set keystore parameters
set KEYSTORE_NAME=chainlesschain-release.jks
set KEY_ALIAS=chainlesschain
set KEY_ALG=RSA
set KEY_SIZE=2048
set VALIDITY=10000

echo Configuration:
echo   Keystore file: %KEYSTORE_NAME%
echo   Key alias: %KEY_ALIAS%
echo   Algorithm: %KEY_ALG%
echo   Key size: %KEY_SIZE% bits
echo   Validity: %VALIDITY% days (~27 years)
echo.

REM Check if keystore already exists
if exist "%KEYSTORE_NAME%" (
    echo [WARNING] Keystore already exists: %KEYSTORE_NAME%
    echo.
    set /p OVERWRITE="Do you want to overwrite it? (yes/no): "
    if /i not "!OVERWRITE!"=="yes" (
        echo [INFO] Cancelled by user
        pause
        exit /b 0
    )
    echo.
    echo [INFO] Removing existing keystore...
    del "%KEYSTORE_NAME%"
)

echo ============================================================
echo Generating keystore...
echo ============================================================
echo.
echo You will be prompted for:
echo   1. Keystore password (store securely!)
echo   2. Your name / organization details
echo   3. Key password (can be same as keystore password)
echo.
echo IMPORTANT: Save these passwords in a password manager!
echo If you lose them, you cannot update your app in Play Store.
echo.
pause

echo.
echo Generating keystore...
echo.

keytool -genkey -v ^
  -keystore "%KEYSTORE_NAME%" ^
  -alias "%KEY_ALIAS%" ^
  -keyalg %KEY_ALG% ^
  -keysize %KEY_SIZE% ^
  -validity %VALIDITY% ^
  -storetype JKS

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Failed to generate keystore
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Keystore generated successfully!
echo ============================================================
echo.
echo File: %CD%\%KEYSTORE_NAME%
echo.

REM Verify keystore
echo Verifying keystore...
keytool -list -v -keystore "%KEYSTORE_NAME%" -alias "%KEY_ALIAS%"

echo.
echo ============================================================
echo Next Steps:
echo ============================================================
echo.
echo 1. Backup keystore to secure location(s):
echo    - Password manager (1Password, LastPass, etc.)
echo    - Encrypted cloud storage (Google Drive, Dropbox)
echo    - Hardware encrypted USB drive
echo.
echo 2. Encode keystore to Base64 for GitHub Secrets:
echo    PowerShell command:
echo    [Convert]::ToBase64String([IO.File]::ReadAllBytes("%KEYSTORE_NAME%")) ^| Out-File keystore.base64
echo.
echo 3. Add GitHub Secrets:
echo    - KEYSTORE_BASE64 (content of keystore.base64)
echo    - KEYSTORE_PASSWORD (your keystore password)
echo    - KEY_ALIAS (chainlesschain)
echo    - KEY_PASSWORD (your key password)
echo.
echo 4. See detailed guide:
echo    android-app\docs\ANDROID_SIGNING_SETUP.md
echo.
echo SECURITY WARNING:
echo - NEVER commit keystore to git
echo - NEVER share keystore via email/chat
echo - ALWAYS keep secure backups
echo.

pause

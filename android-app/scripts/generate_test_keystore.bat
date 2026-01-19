@echo off
REM Quick Test Keystore Generator (for testing only)
REM This generates a keystore automatically with preset values

echo ============================================================
echo Quick Test Keystore Generator
echo ============================================================
echo.
echo This script will generate a TEST keystore with:
echo   Keystore: chainlesschain-test.jks
echo   Password: chainlesschain2024
echo   Alias: chainlesschain
echo   Validity: 10000 days
echo.
echo WARNING: This is for TESTING ONLY!
echo For production, use generate_keystore.bat with secure passwords.
echo.
pause

set KEYSTORE_NAME=chainlesschain-test.jks
set KEY_ALIAS=chainlesschain
set STORE_PASS=chainlesschain2024
set KEY_PASS=chainlesschain2024

REM Check if keytool is available
where keytool >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] keytool not found. Please install Java JDK.
    pause
    exit /b 1
)

REM Remove existing test keystore
if exist "%KEYSTORE_NAME%" (
    echo Removing existing test keystore...
    del "%KEYSTORE_NAME%"
)

echo.
echo Generating test keystore...
echo.

keytool -genkey -v ^
  -keystore "%KEYSTORE_NAME%" ^
  -alias "%KEY_ALIAS%" ^
  -keyalg RSA ^
  -keysize 2048 ^
  -validity 10000 ^
  -storetype JKS ^
  -storepass "%STORE_PASS%" ^
  -keypass "%KEY_PASS%" ^
  -dname "CN=ChainlessChain Test, OU=Development, O=ChainlessChain, L=Beijing, ST=Beijing, C=CN"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Failed to generate keystore
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Test Keystore Generated!
echo ============================================================
echo.
echo File: %CD%\%KEYSTORE_NAME%
echo Password: %STORE_PASS%
echo Alias: %KEY_ALIAS%
echo Key Password: %KEY_PASS%
echo.
echo Verifying keystore...
keytool -list -v -keystore "%KEYSTORE_NAME%" -storepass "%STORE_PASS%"

echo.
echo ============================================================
echo Next Steps for GitHub Actions Testing:
echo ============================================================
echo.
echo 1. Encode to Base64:
powershell -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('%KEYSTORE_NAME%')) | Out-File keystore-test.base64"
echo    Done! Created keystore-test.base64
echo.
echo 2. Add to GitHub Secrets (for testing):
echo    KEYSTORE_BASE64 = (content of keystore-test.base64)
echo    KEYSTORE_PASSWORD = chainlesschain2024
echo    KEY_ALIAS = chainlesschain
echo    KEY_PASSWORD = chainlesschain2024
echo.
echo 3. Push a test commit to trigger workflow
echo.
echo WARNING: This is a TEST keystore with a weak password.
echo For PRODUCTION releases, generate a secure keystore using:
echo   generate_keystore.bat
echo.

pause

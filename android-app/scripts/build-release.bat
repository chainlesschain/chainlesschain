@echo off
REM Android v0.32.0 Release Build Script
REM Builds production APK with size verification

echo ========================================
echo   ChainlessChain Android v0.32.0
echo   Release Build
echo ========================================
echo.

set TARGET_SIZE_MB=40

echo [1/4] Cleaning previous builds...
echo ----------------------------------------
call gradlew clean --no-daemon --console=plain
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Clean failed
    exit /b %ERRORLEVEL%
)
echo [SUCCESS] Clean complete
echo.

echo [2/4] Building Release APK...
echo ----------------------------------------
echo This may take several minutes...
echo.
call gradlew assembleRelease --no-daemon --console=plain
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed with exit code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Build complete!
echo.

echo [3/4] Analyzing APK sizes...
echo ----------------------------------------
echo.

set OUTPUT_DIR=app\build\outputs\apk\release
if not exist "%OUTPUT_DIR%" (
    echo [ERROR] Output directory not found: %OUTPUT_DIR%
    exit /b 1
)

echo Found APK files:
echo.

set TOTAL_SIZE=0
for %%F in (%OUTPUT_DIR%\*.apk) do (
    set "APK_FILE=%%~nxF"
    set /a "SIZE_BYTES=%%~zF"
    set /a "SIZE_MB=!SIZE_BYTES! / 1024 / 1024"

    echo   %%~nxF
    echo   Size: !SIZE_MB!MB

    if !SIZE_MB! LEQ %TARGET_SIZE_MB% (
        echo   Status: [PASS] ^(target: ^<%TARGET_SIZE_MB%MB^)
    ) else (
        echo   Status: [FAIL] ^(exceeds target^)
    )
    echo.
)

echo [4/4] Build artifacts location:
echo ----------------------------------------
echo %OUTPUT_DIR%
echo.

echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Verify APK sizes meet target (^<%TARGET_SIZE_MB%MB)
echo   2. Test installation on devices
echo   3. Run performance validation
echo   4. Create git tag: git tag v0.32.0
echo   5. Push release: git push origin main --tags
echo.

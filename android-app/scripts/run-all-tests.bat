@echo off
REM Android v0.32.0 Complete Test Suite
REM Runs unit tests and E2E tests for release validation

echo ========================================
echo   ChainlessChain Android v0.32.0
echo   Complete Test Suite
echo ========================================
echo.

echo [1/3] Running Unit Tests...
echo ----------------------------------------
call gradlew test --no-daemon --console=plain
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Unit tests failed with exit code %ERRORLEVEL%
    echo Please fix failing tests before release.
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Unit tests passed!
echo.

echo [2/3] Running Lint Checks...
echo ----------------------------------------
call gradlew lint --no-daemon --console=plain
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] Lint checks found issues.
    echo Review lint report before release.
)
echo.

echo [3/3] E2E Tests (requires device/emulator)
echo ----------------------------------------
echo.
choice /C YN /M "Run E2E tests (requires connected device)"
if %ERRORLEVEL% EQU 1 (
    call gradlew connectedAndroidTest --no-daemon --console=plain
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] E2E tests failed with exit code %ERRORLEVEL%
        exit /b %ERRORLEVEL%
    )
    echo.
    echo [SUCCESS] E2E tests passed!
) else (
    echo Skipping E2E tests.
)

echo.
echo ========================================
echo   Test Suite Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Build Release APK: gradlew assembleRelease
echo   2. Verify APK size ^<40MB
echo   3. Test on real devices
echo.

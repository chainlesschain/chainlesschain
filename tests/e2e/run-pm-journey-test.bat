@echo off
REM ============================================================================
REM Project Management Journey E2E Test Runner (Windows)
REM
REM This script runs the comprehensive project management lifecycle test
REM with proper setup and reporting.
REM ============================================================================

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\..\"

echo.
echo ============================================================================
echo    Project Management Journey E2E Test
echo ============================================================================
echo.

REM Check Node.js version
echo [*] Checking Node.js version...
node -v
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js.
    exit /b 1
)

REM Step 1: Build main process
echo.
echo [*] Step 1/4: Building Electron main process...
cd /d "%PROJECT_ROOT%desktop-app-vue"

if not exist "package.json" (
    echo [ERROR] desktop-app-vue/package.json not found
    exit /b 1
)

call npm run build:main
if errorlevel 1 (
    echo [ERROR] Failed to build main process
    exit /b 1
)
echo [OK] Main process built successfully

REM Step 2: Install Playwright browsers
echo.
echo [*] Step 2/4: Checking Playwright browsers...
cd /d "%PROJECT_ROOT%"

echo     Installing Playwright browsers (if not already installed)...
call npx playwright install chromium --with-deps >nul 2>&1
echo [OK] Playwright browsers ready

REM Step 3: Determine test mode
set "TEST_MODE=%~1"
if "%TEST_MODE%"=="" set "TEST_MODE=normal"

echo.
echo [*] Step 3/4: Running E2E test...
echo     Test file: tests/e2e/project-management-journey.e2e.test.ts
echo     Coverage: 33 tests across 8 phases
echo.

REM Run test based on mode
if "%TEST_MODE%"=="ui" (
    echo     Mode: UI (Interactive)
    call npx playwright test tests/e2e/project-management-journey.e2e.test.ts --ui
) else if "%TEST_MODE%"=="headed" (
    echo     Mode: Headed (Visible browser)
    call npx playwright test tests/e2e/project-management-journey.e2e.test.ts --headed
) else if "%TEST_MODE%"=="debug" (
    echo     Mode: Debug (Step-by-step)
    call npx playwright test tests/e2e/project-management-journey.e2e.test.ts --debug
) else if "%TEST_MODE%"=="report" (
    echo     Mode: Normal + HTML Report
    call npx playwright test tests/e2e/project-management-journey.e2e.test.ts --reporter=html
) else (
    echo     Mode: Normal (Headless)
    call npx playwright test tests/e2e/project-management-journey.e2e.test.ts
)

set "TEST_EXIT_CODE=%errorlevel%"

REM Step 4: Generate report
if "%TEST_MODE%" NEQ "report" if %TEST_EXIT_CODE% EQU 0 (
    echo.
    echo [*] Step 4/4: Test report generated
    echo     Report available at: playwright-report/index.html
    echo     To view: npx playwright show-report
)

REM Display results
echo.
echo ============================================================================

if %TEST_EXIT_CODE% EQU 0 (
    echo [SUCCESS] Test completed successfully!
    echo.
    echo   Test Coverage Summary:
    echo   * Phase 1: Organization ^& Team Setup (4 tests)
    echo   * Phase 2: Project Creation (3 tests)
    echo   * Phase 3: Task Board Creation (3 tests)
    echo   * Phase 4: Task Management (6 tests)
    echo   * Phase 5: Sprint Management (6 tests)
    echo   * Phase 6: Reports ^& Analytics (3 tests)
    echo   * Phase 7: Project Delivery (5 tests)
    echo   * Phase 8: Cleanup ^& Verification (3 tests)
    echo   Total: 33 tests
) else (
    echo [ERROR] Test failed with exit code: %TEST_EXIT_CODE%
    echo.
    echo   Troubleshooting tips:
    echo   1. Check if Electron app built correctly:
    echo      cd desktop-app-vue ^&^& npm run build:main
    echo   2. Verify database is initialized: npm run init:db
    echo   3. Check IPC handlers are registered in src/main/index.js
    echo   4. Review test logs above for specific errors
    echo   5. Run in debug mode: run-pm-journey-test.bat debug
)

echo ============================================================================

REM Show usage help
if "%~1"=="--help" (
    goto :show_help
)
if "%~1"=="-h" (
    goto :show_help
)
if "%~1"=="/?" (
    goto :show_help
)

goto :end

:show_help
echo.
echo Usage:
echo   run-pm-journey-test.bat [mode]
echo.
echo Modes:
echo   normal  - Run in headless mode (default)
echo   ui      - Run in interactive UI mode
echo   headed  - Run with visible browser
echo   debug   - Run in debug mode (step-by-step)
echo   report  - Run and generate HTML report
echo.
echo Examples:
echo   run-pm-journey-test.bat
echo   run-pm-journey-test.bat ui
echo   run-pm-journey-test.bat debug
echo.

:end
exit /b %TEST_EXIT_CODE%

@echo off
REM ============================================================================
REM Run All Project Management E2E Tests (Windows)
REM
REM Test Suites:
REM 1. Project Management Journey (33 tests)
REM 2. Approval Workflow Journey (20+ tests)
REM 3. Error Scenarios (30+ tests)
REM 4. Performance & Stress Tests (15+ tests)
REM ============================================================================

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\..\"

echo ============================================================================
echo        Project Management E2E Test Suite Runner
echo ============================================================================
echo.

REM Test results tracking
set /a total_tests=0
set /a passed_tests=0
set /a failed_tests=0
set "test_results="

REM Build main process
echo [*] Preparing environment...
cd /d "%PROJECT_ROOT%desktop-app-vue"

call npm run build:main >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to build main process
    exit /b 1
)
echo [OK] Main process built

REM Install Playwright browsers
cd /d "%PROJECT_ROOT%"
echo [*] Installing Playwright browsers...
call npx playwright install chromium --with-deps >nul 2>&1

echo.
echo ============================================================================
echo                   Starting Test Execution
echo ============================================================================
echo.

REM Function to run test suite (Windows doesn't have functions, so we use labels)

REM Test 1: Project Management Journey
echo.
echo ========================================
echo Running: 1. Project Management Journey
echo ========================================
set /a total_tests+=1
call npx playwright test tests/e2e/project-management-journey.e2e.test.ts --reporter=line
if errorlevel 1 (
    echo [FAIL] Project Management Journey
    set /a failed_tests+=1
    set "test_results=!test_results!  X Project Management Journey\n"
) else (
    echo [PASS] Project Management Journey
    set /a passed_tests+=1
    set "test_results=!test_results!  √ Project Management Journey\n"
)

REM Test 2: Approval Workflow Journey
echo.
echo ========================================
echo Running: 2. Approval Workflow Journey
echo ========================================
set /a total_tests+=1
call npx playwright test tests/e2e/approval-workflow-journey.e2e.test.ts --reporter=line
if errorlevel 1 (
    echo [FAIL] Approval Workflow Journey
    set /a failed_tests+=1
    set "test_results=!test_results!  X Approval Workflow Journey\n"
) else (
    echo [PASS] Approval Workflow Journey
    set /a passed_tests+=1
    set "test_results=!test_results!  √ Approval Workflow Journey\n"
)

REM Test 3: Error Scenarios
echo.
echo ========================================
echo Running: 3. Error Scenarios
echo ========================================
set /a total_tests+=1
call npx playwright test tests/e2e/error-scenarios.e2e.test.ts --reporter=line
if errorlevel 1 (
    echo [FAIL] Error Scenarios
    set /a failed_tests+=1
    set "test_results=!test_results!  X Error Scenarios\n"
) else (
    echo [PASS] Error Scenarios
    set /a passed_tests+=1
    set "test_results=!test_results!  √ Error Scenarios\n"
)

REM Test 4: Performance & Stress Tests
echo.
echo ========================================
echo Running: 4. Performance ^& Stress Tests
echo ========================================
set /a total_tests+=1
call npx playwright test tests/e2e/performance-stress.e2e.test.ts --reporter=line
if errorlevel 1 (
    echo [FAIL] Performance ^& Stress Tests
    set /a failed_tests+=1
    set "test_results=!test_results!  X Performance & Stress Tests\n"
) else (
    echo [PASS] Performance ^& Stress Tests
    set /a passed_tests+=1
    set "test_results=!test_results!  √ Performance & Stress Tests\n"
)

REM Display results
echo.
echo ============================================================================
echo                      Test Results Summary
echo ============================================================================
echo.

echo %test_results%

echo.
echo ============================================================================

if %failed_tests% EQU 0 (
    echo [SUCCESS] All tests passed!
) else (
    echo [WARNING] Some tests failed
)

echo.
echo   Total Suites: %total_tests%
echo   Passed: %passed_tests%
echo   Failed: %failed_tests%

echo ============================================================================
echo.

echo Test Suite Breakdown:
echo   * Project Management Journey:  33 tests (Full lifecycle)
echo   * Approval Workflow Journey:   20+ tests (Sequential, Parallel, Any-One)
echo   * Error Scenarios:             30+ tests (Edge cases, validation)
echo   * Performance ^& Stress:        15+ tests (Bulk ops, concurrency)
echo   Total: ~98+ individual test cases
echo.

if exist "playwright-report\index.html" (
    echo HTML Report: playwright-report\index.html
    echo   View with: npx playwright show-report
    echo.
)

REM Show usage help
if "%~1"=="--help" goto :show_help
if "%~1"=="-h" goto :show_help
if "%~1"=="/?" goto :show_help

goto :end

:show_help
echo Usage:
echo   run-all-pm-tests.bat
echo.
echo This script runs all project management E2E test suites in sequence.
echo.

:end
if %failed_tests% EQU 0 (
    exit /b 0
) else (
    exit /b 1
)

@echo off
echo =====================================================
echo   ChainlessChain Enterprise Features Test Runner
echo =====================================================
echo.
echo This script will run the enterprise features tests.
echo Please ensure the application is running first.
echo.
pause

echo.
echo Starting tests...
echo.

:: Run the test script through Node.js
node test-organization-features.js

echo.
echo =====================================================
echo   Tests Completed
echo =====================================================
echo.
pause

@echo off
echo ======================================
echo Restarting Project Service with Fix
echo ======================================

echo.
echo Step 1: Stopping any running project-service instances...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq project-service*" 2>nul
if %errorlevel% equ 0 (
    echo Successfully stopped existing service
    timeout /t 2 >nul
) else (
    echo No existing service found
)

echo.
echo Step 2: Navigating to project-service directory...
cd /d "%~dp0backend\project-service"

echo.
echo Step 3: Checking Maven installation...
where mvn >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Maven not found in PATH!
    echo Please install Maven or add it to your PATH
    echo.
    echo Maven download: https://maven.apache.org/download.cgi
    pause
    exit /b 1
)

echo.
echo Step 4: Compiling project (this may take a minute)...
call mvn clean compile -DskipTests
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Compilation failed!
    echo Please check the error messages above
    pause
    exit /b 1
)

echo.
echo Step 5: Starting project-service...
echo The service will start in a new window
echo.
start "project-service" cmd /k "mvn spring-boot:run"

echo.
echo ======================================
echo Service is starting...
echo ======================================
echo.
echo The service should be available at: http://localhost:9090
echo Check the new window for startup logs
echo.
echo Press any key to check service health...
pause >nul

echo.
echo Waiting 10 seconds for service to start...
timeout /t 10 >nul

echo.
echo Checking service health...
curl -s http://localhost:9090/api/sync/health
echo.
echo.
echo If you see a "status: UP" message above, the service is ready!
echo.
pause

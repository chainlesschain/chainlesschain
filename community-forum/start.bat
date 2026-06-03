@echo off
echo ==========================================
echo   ChainlessChain Community Forum
echo   Starting all services...
echo ==========================================
echo.

echo Checking Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not running.
    echo Please install Docker Desktop first.
    echo Download: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo.
echo Starting Docker Compose...
docker-compose up -d

echo.
echo Waiting for services to be ready...
timeout /t 30 /nobreak >nul

echo.
echo ==========================================
echo   Services started successfully!
echo ==========================================
echo.
echo   Frontend: http://localhost:8081
echo   Backend API: http://localhost:8082/api
echo   Swagger: http://localhost:8082/api/swagger-ui.html
echo.
echo   MySQL: localhost:3306
echo   Redis: localhost:6379
echo   Elasticsearch: localhost:9200
echo.
echo ==========================================
echo.
echo Checking service status...
docker-compose ps

echo.
echo Press any key to view logs (Ctrl+C to exit)...
pause >nul
docker-compose logs -f

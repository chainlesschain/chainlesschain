@echo off
setlocal enabledelayedexpansion

REM ChainlessChain 后端服务启动脚本
REM 适用于 Windows

echo =========================================
echo  ChainlessChain Backend Services
echo =========================================
echo.

REM 检查 Docker 是否运行
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [31m Error: Docker is not running[0m
    echo Please start Docker Desktop and try again
    echo.
    pause
    exit /b 1
)

echo [32m Docker is running[0m
echo.

REM 获取脚本目录
set "SCRIPT_DIR=%~dp0"
set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.production.yml"

REM 检查配置文件
if not exist "%COMPOSE_FILE%" (
    echo [31m Error: docker-compose.production.yml not found[0m
    echo Expected location: %COMPOSE_FILE%
    pause
    exit /b 1
)

REM 启动服务
echo [33m Starting services...[0m
echo.

cd /d "%SCRIPT_DIR%"
docker-compose -f docker-compose.production.yml up -d

if %errorlevel% equ 0 (
    echo.
    echo =========================================
    echo [32m Services started successfully![0m
    echo =========================================
    echo.
    echo Services:
    echo   - PostgreSQL:  localhost:5432
    echo   - Redis:       localhost:6379
    echo   - Qdrant:      localhost:6333
    echo   - Ollama:      http://localhost:11434
    echo.
    echo Management commands:
    echo   Stop services:   docker-compose -f docker-compose.production.yml down
    echo   View logs:       docker-compose -f docker-compose.production.yml logs -f
    echo   Check status:    docker-compose -f docker-compose.production.yml ps
    echo   Restart service: docker-compose -f docker-compose.production.yml restart [service]
    echo.
    echo First-time setup:
    echo   1. Wait ~30 seconds for all services to start
    echo   2. Pull Ollama model: docker exec -it chainlesschain-ollama ollama pull qwen2:7b
    echo   3. Launch ChainlessChain desktop app
    echo.
    echo =========================================
) else (
    echo.
    echo [31m Error: Failed to start services[0m
    echo Please check the error messages above
)

echo.
pause

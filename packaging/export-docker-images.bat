@echo off
setlocal enabledelayedexpansion

REM ChainlessChain Docker 镜像导出脚本
REM 用于创建离线安装包

set "SCRIPT_DIR=%~dp0"
set "IMAGES_DIR=%SCRIPT_DIR%docker-images"

echo =========================================
echo  ChainlessChain Docker 镜像导出
echo =========================================
echo.

REM 检查 Docker 是否运行
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [31m 错误: Docker 未运行[0m
    echo 请先启动 Docker Desktop 后再试
    pause
    exit /b 1
)

echo [32m Docker 正在运行[0m
echo.

REM 创建导出目录
if not exist "%IMAGES_DIR%" mkdir "%IMAGES_DIR%"

echo [33m 开始导出镜像...[0m
echo.

REM 导出 PostgreSQL
echo [1/4] PostgreSQL 16 Alpine
echo   拉取镜像...
docker pull postgres:16-alpine
echo   导出镜像...
docker save -o "%IMAGES_DIR%\postgres-16-alpine.tar" postgres:16-alpine
echo   [32m 完成！[0m
echo.

REM 导出 Redis
echo [2/4] Redis 7 Alpine
echo   拉取镜像...
docker pull redis:7-alpine
echo   导出镜像...
docker save -o "%IMAGES_DIR%\redis-7-alpine.tar" redis:7-alpine
echo   [32m 完成！[0m
echo.

REM 导出 Qdrant
echo [3/4] Qdrant v1.12.5
echo   拉取镜像...
docker pull qdrant/qdrant:v1.12.5
echo   导出镜像...
docker save -o "%IMAGES_DIR%\qdrant-qdrant-v1.12.5.tar" qdrant/qdrant:v1.12.5
echo   [32m 完成！[0m
echo.

REM 询问是否导出 Ollama (大文件)
echo [4/4] Ollama (可选)
echo   警告: Ollama 镜像约 500MB，导出后约 500MB
choice /C YN /M "是否导出 Ollama 镜像"
if errorlevel 2 goto :skip_ollama
if errorlevel 1 (
    echo   拉取镜像...
    docker pull ollama/ollama:latest
    echo   导出镜像...
    docker save -o "%IMAGES_DIR%\ollama-ollama-latest.tar" ollama/ollama:latest
    echo   [32m 完成！[0m
    echo.
)

:skip_ollama

REM 创建清单文件
echo # ChainlessChain Docker 镜像清单 > "%IMAGES_DIR%\images-manifest.txt"
echo # 生成时间: %date% %time% >> "%IMAGES_DIR%\images-manifest.txt"
echo. >> "%IMAGES_DIR%\images-manifest.txt"
echo postgres-16-alpine.tar^|postgres:16-alpine >> "%IMAGES_DIR%\images-manifest.txt"
echo redis-7-alpine.tar^|redis:7-alpine >> "%IMAGES_DIR%\images-manifest.txt"
echo qdrant-qdrant-v1.12.5.tar^|qdrant/qdrant:v1.12.5 >> "%IMAGES_DIR%\images-manifest.txt"

if exist "%IMAGES_DIR%\ollama-ollama-latest.tar" (
    echo ollama-ollama-latest.tar^|ollama/ollama:latest >> "%IMAGES_DIR%\images-manifest.txt"
)

echo =========================================
echo [32m 所有镜像导出完成！[0m
echo =========================================
echo.
echo 导出位置: %IMAGES_DIR%
echo.
echo 文件列表:
dir "%IMAGES_DIR%\*.tar" /s
echo.
echo 下一步:
echo   1. 检查 docker-images 目录
echo   2. 运行 npm run make:win 打包应用
echo   3. docker-images 会自动包含在安装包中
echo.
pause

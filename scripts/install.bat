@echo off
REM ChainlessChain 一键安装脚本 (Windows)

echo ============================================
echo ChainlessChain 开发环境一键安装
echo ============================================
echo.

echo [1/4] 检查环境...

REM 检查Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo × Node.js 未安装,请先安装 Node.js 18+
    echo   下载地址: https://nodejs.org/
    pause
    exit /b 1
) else (
    echo √ Node.js 已安装
)

REM 检查Docker
docker info >nul 2>&1
if errorlevel 1 (
    echo × Docker 未运行,请先启动 Docker Desktop
    echo   下载地址: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
) else (
    echo √ Docker 已就绪
)

echo.
echo [2/4] 安装项目依赖...
call npm install
if errorlevel 1 (
    echo × 依赖安装失败
    pause
    exit /b 1
)

echo.
echo 安装PC端依赖...
cd desktop-app
call npm install
if errorlevel 1 (
    echo × PC端依赖安装失败
    pause
    exit /b 1
)
cd ..

echo.
echo [3/4] 启动AI服务...
cd backend\docker
call setup.bat
cd ..\..

echo.
echo [4/4] 初始化完成!
echo.
echo ============================================
echo 环境搭建成功!
echo ============================================
echo.
echo 下一步:
echo   1. 启动开发服务器: npm run dev:desktop
echo   2. 查看文档: docs\DEVELOPMENT.md
echo   3. 测试Ollama: curl http://localhost:11434/api/tags
echo.
echo 常用命令:
echo   npm run dev:desktop    - 启动PC端开发
echo   npm run docker:up      - 启动AI服务
echo   npm run docker:down    - 停止AI服务
echo   npm run docker:logs    - 查看服务日志
echo.
pause

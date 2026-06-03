@echo off
chcp 65001 >nul
:: 切换到项目根目录
cd /d "%~dp0..\.."
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo �?  ChainlessChain 官网本地预览启动�?v0.33.0              �?
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 🚀 正在启动本地服务�?..
echo.

:: 检查Python是否安装
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo �?使用 Python HTTP Server
    echo 📍 访问地址�?
    echo    - 主页：http://localhost:8000
    echo    - 二维码生成器：http://localhost:8000/generate-qr-code.html
    echo    - 预览页面：http://localhost:8000/PREVIEW_v0.33.0.html
    echo.
    echo 💡 �?Ctrl+C 停止服务�?
    echo.
    timeout /t 2 >nul
    start http://localhost:8000
    python -m http.server 8000
    goto :end
)

:: 检查Node.js是否安装
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo �?使用 Node.js HTTP Server
    echo 📦 正在安装 http-server...
    call npm install -g http-server
    echo.
    echo 📍 访问地址�?
    echo    - 主页：http://localhost:8000
    echo    - 二维码生成器：http://localhost:8000/generate-qr-code.html
    echo    - 预览页面：http://localhost:8000/PREVIEW_v0.33.0.html
    echo.
    echo 💡 �?Ctrl+C 停止服务�?
    echo.
    timeout /t 2 >nul
    start http://localhost:8000
    npx http-server -p 8000
    goto :end
)

:: 都没有安�?
echo �?未检测到 Python �?Node.js
echo.
echo 请先安装以下任一工具�?
echo   1. Python 3.x - https://www.python.org/downloads/
echo   2. Node.js - https://nodejs.org/
echo.
echo 或者直接在浏览器中打开 index.html 文件
echo.
pause

:end

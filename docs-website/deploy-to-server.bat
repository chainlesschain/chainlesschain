@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo �?     ChainlessChain 官网服务器部署工�?v0.33.0         �?
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: 配置变量（请根据实际情况修改�?
set SERVER_USER=root
set SERVER_HOST=your-server.com
set SERVER_PATH=/var/www/chainlesschain.com
set LOCAL_DIST=dist

:: 检�?dist 目录是否存在
if not exist "%LOCAL_DIST%" (
    echo �?dist 目录不存在，请先运行构建脚本
    echo.
    echo 运行命令: node build.js
    echo.
    pause
    exit /b 1
)

echo 📋 部署配置:
echo    - 服务�? %SERVER_USER%@%SERVER_HOST%
echo    - 目标路径: %SERVER_PATH%
echo    - 本地目录: %LOCAL_DIST%
echo.

echo ⚠️  请先修改此脚本中的服务器配置信息�?
echo.
echo 需要修改的变量:
echo    - SERVER_USER (服务器用户名)
echo    - SERVER_HOST (服务器地址)
echo    - SERVER_PATH (服务器目标路�?
echo.

choice /C YN /M "配置已修改，确认部署"
if errorlevel 2 goto :cancel

echo.
echo 🚀 开始部�?..
echo.

:: 检查是否安装了 scp �?rsync
where scp >nul 2>&1
if %errorlevel% == 0 (
    echo �?使用 SCP 上传文件...
    scp -r %LOCAL_DIST%/* %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
    goto :check_result
)

where rsync >nul 2>&1
if %errorlevel% == 0 (
    echo �?使用 Rsync 同步文件...
    rsync -avz --delete %LOCAL_DIST%/ %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
    goto :check_result
)

echo �?未找�?scp �?rsync 工具
echo.
echo 请安装以下任一工具:
echo    1. Git for Windows (包含 scp)
echo    2. WSL (Windows Subsystem for Linux)
echo    3. Cygwin
echo.
echo 或者手动上�?dist 目录到服务器
echo.
pause
exit /b 1

:check_result
if %errorlevel% == 0 (
    echo.
    echo �?部署成功�?
    echo.
    echo 📝 后续操作:
    echo    1. SSH 登录服务器检查文�?
    echo    2. 配置 Nginx/Apache（如果还未配置）
    echo    3. 重启 Web 服务器（如需要）
    echo    4. 访问网站测试
    echo.
) else (
    echo.
    echo �?部署失败�?
    echo.
    echo 可能的原�?
    echo    1. SSH 连接失败
    echo    2. 权限不足
    echo    3. 目标路径不存�?
    echo.
)

pause
exit /b 0

:cancel
echo.
echo �?已取消部�?
echo.
pause
exit /b 0

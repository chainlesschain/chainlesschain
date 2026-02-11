@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo �?  ChainlessChain 官网一键打包部署工�?v0.33.0          �?
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: 检�?Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo �?未检测到 Node.js
    echo.
    echo 请先安装 Node.js: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo �?Node.js 已安�?
node --version
echo.

:: 显示菜单
:menu
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo 📋 请选择操作:
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.
echo   1. 构建打包（生�?dist 目录�?
echo   2. 本地预览（启动测试服务器�?
echo   3. 部署到服务器
echo   4. 创建压缩包（用于手动上传�?
echo   5. 查看部署指南
echo   0. 退�?
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.

set /p choice="请输入选项 (0-5): "

if "%choice%"=="1" goto :build
if "%choice%"=="2" goto :preview
if "%choice%"=="3" goto :deploy
if "%choice%"=="4" goto :pack
if "%choice%"=="5" goto :guide
if "%choice%"=="0" goto :exit
echo.
echo �?无效选项，请重新选择
echo.
goto :menu

:build
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo 📦 开始构�?..
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.
node build.js
if %errorlevel% == 0 (
    echo.
    echo �?构建成功�?
    echo.
    echo 📁 输出目录: dist\
    echo.
) else (
    echo.
    echo �?构建失败�?
    echo.
)
pause
goto :menu

:preview
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo 🌐 启动本地预览...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.

if not exist "dist" (
    echo ⚠️  dist 目录不存在，请先构建
    echo.
    set /p build_now="是否现在构建? (Y/N): "
    if /i "%build_now%"=="Y" (
        node build.js
    ) else (
        goto :menu
    )
)

echo.
echo 📍 访问地址: http://localhost:8000
echo.
echo 💡 �?Ctrl+C 停止服务�?
echo.
timeout /t 2 >nul

cd dist
start http://localhost:8000

python --version >nul 2>&1
if %errorlevel% == 0 (
    python -m http.server 8000
) else (
    npx http-server -p 8000
)

cd ..
goto :menu

:deploy
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo 🚀 部署到服务器
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.

if not exist "dist" (
    echo ⚠️  dist 目录不存在，请先构建
    echo.
    pause
    goto :menu
)

echo 请先�?deploy-to-server.bat 中配置服务器信息
echo.
pause
call deploy-to-server.bat
goto :menu

:pack
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo 📦 创建压缩�?
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.

if not exist "dist" (
    echo ⚠️  dist 目录不存在，请先构建
    echo.
    set /p build_now="是否现在构建? (Y/N): "
    if /i "%build_now%"=="Y" (
        node build.js
    ) else (
        goto :menu
    )
)

set archive_name=chainlesschain-website-v0.33.0-%date:~0,4%%date:~5,2%%date:~8,2%.zip

echo 正在创建压缩�? %archive_name%
echo.

:: 检查是否有 7z
where 7z >nul 2>&1
if %errorlevel% == 0 (
    7z a %archive_name% .\dist\*
    goto :pack_success
)

:: 检查是否有 powershell
powershell -Command "Compress-Archive -Path dist\* -DestinationPath %archive_name% -Force"
if %errorlevel% == 0 (
    goto :pack_success
)

echo.
echo �?创建压缩包失�?
echo.
echo 请安装以下任一工具:
echo   1. 7-Zip - https://www.7-zip.org/
echo   2. PowerShell 5.0+
echo.
echo 或者手动压�?dist 目录
echo.
pause
goto :menu

:pack_success
echo.
echo �?压缩包创建成功！
echo.
echo 📦 文件: %archive_name%
echo.
echo 可以上传�?
echo   - 服务�?(FTP/SFTP)
echo   - 云存�?(OSS/COS/S3)
echo   - 网盘分享
echo.
pause
goto :menu

:guide
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo 📖 部署指南
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━�?
echo.
echo 详细部署指南请查�? DEPLOY_GUIDE.md
echo.
echo 快速参�?
echo.
echo 1️⃣  服务器部�?
echo    - 修改 deploy-to-server.bat 中的服务器配�?
echo    - 运行部署脚本
echo.
echo 2️⃣  GitHub Pages
echo    - 运行 deploy-to-github.sh
echo    - 在仓库设置中启用 Pages
echo.
echo 3️⃣  Netlify/Vercel
echo    - 拖拽 dist 目录到部署页�?
echo    - 或使�?CLI 工具
echo.
echo 4️⃣  云存�?OSS
echo    - 上传 dist 目录到云存储
echo    - 配置静态网站托�?
echo.
pause
goto :menu

:exit
echo.
echo 👋 感谢使用 ChainlessChain 官网打包部署工具�?
echo.
echo 📞 技术支�? 400-1068-687
echo 💬 企业微信: https://work.weixin.qq.com/ca/cawcde653996f7ecb2
echo.
exit /b 0

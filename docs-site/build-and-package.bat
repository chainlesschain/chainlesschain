@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   文档网站打包脚本 v0.27.0
echo ========================================
echo.

:: 检查 Node.js
echo [1/5] 检查环境...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未检测到 Node.js
    pause
    exit /b 1
)
echo ✅ Node.js 已安装

:: 检查依赖
echo.
echo [2/5] 检查依赖...
if not exist "node_modules" (
    echo 📦 安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo ✅ 依赖已存在
)

:: 清理旧构建
echo.
echo [3/5] 清理旧构建...
if exist "docs\.vitepress\dist" (
    rmdir /s /q "docs\.vitepress\dist"
    echo ✅ 已清理旧构建
)
if exist "docs\.vitepress\cache" (
    rmdir /s /q "docs\.vitepress\cache"
    echo ✅ 已清理缓存
)

:: 构建
echo.
echo [4/5] 构建生产版本...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ 构建失败
    pause
    exit /b 1
)
echo ✅ 构建成功

:: 打包
echo.
echo [5/5] 打包文件...
set DIST_DIR=docs\.vitepress\dist
set PACKAGE_NAME=chainlesschain-docs-v0.27.0-%date:~0,4%%date:~5,2%%date:~8,2%.zip

if exist "%PACKAGE_NAME%" (
    del "%PACKAGE_NAME%"
)

:: 使用 PowerShell 压缩
powershell -command "Compress-Archive -Path '%DIST_DIR%\*' -DestinationPath '%PACKAGE_NAME%' -Force"

if exist "%PACKAGE_NAME%" (
    echo ✅ 打包成功
    echo.
    echo ========================================
    echo   打包完成！
    echo ========================================
    echo.
    echo 📦 文件: %PACKAGE_NAME%

    :: 获取文件大小
    for %%A in ("%PACKAGE_NAME%") do (
        set size=%%~zA
    )
    echo 📊 大小: %size% 字节

    echo 📁 位置: %cd%\%PACKAGE_NAME%
    echo.
    echo 📄 构建目录: %DIST_DIR%
    dir /s "%DIST_DIR%" | findstr "个文件"
    echo.
    echo 下一步:
    echo   1. 解压 %PACKAGE_NAME%
    echo   2. 上传到服务器
    echo   3. 或运行 'npm run preview' 本地预览
    echo.
) else (
    echo ❌ 打包失败
    pause
    exit /b 1
)

echo 按任意键退出...
pause >nul

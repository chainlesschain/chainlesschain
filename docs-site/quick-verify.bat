@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   文档网站更新验证 v0.27.0
echo ========================================
echo.

echo [1/4] 检查 Node.js 环境...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)
echo ✅ Node.js 版本:
node --version

echo.
echo [2/4] 检查依赖安装...
if not exist "node_modules" (
    echo 📦 正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo ✅ 依赖已安装
)

echo.
echo [3/4] 检查关键文件...
set missing=0

if not exist "docs\index.md" (
    echo ❌ 缺少文件: docs\index.md
    set missing=1
)

if not exist "docs\changelog.md" (
    echo ❌ 缺少文件: docs\changelog.md
    set missing=1
)

if not exist "docs\chainlesschain\cowork.md" (
    echo ❌ 缺少文件: docs\chainlesschain\cowork.md
    set missing=1
)

if not exist "docs\.vitepress\config.js" (
    echo ❌ 缺少文件: docs\.vitepress\config.js
    set missing=1
)

if %missing% equ 0 (
    echo ✅ 所有关键文件存在
) else (
    echo ❌ 部分文件缺失
    pause
    exit /b 1
)

echo.
echo [4/4] 验证版本信息...
findstr /C:"v0.27.0" docs\index.md >nul
if %errorlevel% equ 0 (
    echo ✅ 首页版本号已更新
) else (
    echo ⚠️  警告: 首页可能未更新到 v0.27.0
)

findstr /C:"Cowork" docs\index.md >nul
if %errorlevel% equ 0 (
    echo ✅ Cowork 特性已添加
) else (
    echo ⚠️  警告: 首页可能缺少 Cowork 内容
)

echo.
echo ========================================
echo   验证完成！
echo ========================================
echo.
echo 下一步:
echo   1. 运行 'npm run dev' 启动开发服务器
echo   2. 访问 http://localhost:5173
echo   3. 检查页面内容和导航
echo.
echo 按任意键退出...
pause >nul

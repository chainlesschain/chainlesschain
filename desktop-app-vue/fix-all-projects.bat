@echo off
chcp 65001 >nul
echo ============================================================
echo 一键修复所有项目路径问题
echo ============================================================
echo.
echo 此脚本将：
echo 1. 检查系统配置
echo 2. 修复所有没有 root_path 的项目
echo 3. 创建项目目录并写入文件
echo.
echo 按任意键开始，或关闭窗口取消...
pause >nul

cd /d "%~dp0"

echo.
echo [1/2] 检查 Node.js 环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)
echo ✓ Node.js 已安装

echo.
echo [2/2] 执行修复脚本...
node scripts\fix-project-paths.js

echo.
echo ============================================================
echo 修复完成！
echo ============================================================
echo.
echo 下一步：
echo 1. 重启桌面应用
echo 2. 打开项目详情页
echo 3. 检查文件系统监听是否启动
echo.
pause
